#!/usr/bin/env node
// 다른 계열 모델을 읽기 전용 전문가로 부른다(v2 3단계). 파일은 고치지 않고 결과를 JSON으로만 돌려받는다.
//
//   review  변경을 다른 계열 모델에게 리뷰받는다. 작성자의 요약·주장은 주지 않고 diff, 바뀐 파일, 검사 결과만 준다.
//   write   글(대사, 로어, 서술)을 작가 모델(기본 Gemini Argon)에게 맡긴다. 결과 글은 리드가 파일로 쓴다.
//   dispose 리뷰 지적마다 리드의 처분(act, consider, noted, dismissed, contract_misread)과 이유를 남긴다.
//   stats   리뷰어별로 쓸모 있는 지적 비율을 본다.
//
// 사용법:
//   node scripts/consult.mjs review --base <ref> [--repo DIR] [--reviewer codex|agy|grok] [--author claude|codex|agy|grok]
//        [--criteria "AC1: ..."]... [--criteria-file F] [--check "<명령>"]... [--model M] [--effort E]
//   node scripts/consult.mjs write <write-brief.json> [--repo DIR] [--writer agy|codex|grok] [--model M] [--effort E]
//   node scripts/consult.mjs dispose <report.json> F1=act "F2=dismissed:이유" ...
//   node scripts/consult.mjs stats
// 보고서는 HFGS_HOME(기본 ~/.hf-game-studio)/reviews/에 남는다. 게임 저장소 안에 쓰지 않는다.
// 종료 코드: review는 pass면 0, 아니면 1. 사용법 오류·실행 실패는 2.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {ADAPTERS} from './lib/adapters/index.mjs';
import {invoke as invokeCli,readOnlyOrders} from './lib/cli.mjs';
import {loadKinds,docDirectives} from './brief.mjs';

function fail(m){throw Object.assign(Error(m),{usage:true});}
const str=v=>typeof v==='string'&&v.trim().length>0;

// 리뷰 독립성은 모델을 만든 회사(계열)로 판단한다. agy는 Claude 모델도 돌릴 수 있어 모델 이름으로 다시 본다.
const FAMILY={claude:'anthropic',codex:'openai',agy:'google',grok:'xai'};
export function familyOf(who,model){
 if(/^claude-/.test(model??''))return 'anthropic';
 if(/^gpt-|^o\d/.test(model??''))return 'openai';
 if(/^gemini-/.test(model??''))return 'google';
 if(/^grok-/.test(model??''))return 'xai';
 return FAMILY[who]??null;
}

// 전문가가 저장소를 바꾸지 않았는지 전후로 비교한다. 각 CLI의 읽기 전용 모드는 보증이 아니다(agy --sandbox는 쓰기 도구를 못 막는다).
export function snapshot(repo,{git=gitOut}={}){
 const head=git(repo,['rev-parse','HEAD']).trim();
 const status=git(repo,['status','--porcelain=v1','-uall']);
 const diff=git(repo,['diff','--binary','HEAD']);
 return crypto.createHash('sha256').update(head+'\0'+status+'\0'+diff).digest('hex');
}
function gitOut(repo,args){
 const r=spawnSync('git',['-C',repo,...args],{encoding:'utf8',maxBuffer:256*1024*1024,windowsHide:true});
 if(r.status!==0)fail(`git ${args.join(' ')} 실패: ${String(r.stderr).trim()}`);
 return r.stdout;
}

// 검사는 이 스크립트가 직접 돌린다. 리뷰어는 작성자의 "테스트 통과" 주장 대신 이 결과를 본다.
export function runChecks(repo,commands,{spawn=spawnSync,timeoutMs=10*60*1000}={}){
 return commands.map(command=>{
  const r=spawn(command,{cwd:repo,shell:true,encoding:'utf8',timeout:timeoutMs,maxBuffer:64*1024*1024,windowsHide:true});
  const out=`${r.stdout??''}${r.stderr?'\n'+r.stderr:''}`.trim();
  return {command,exit_code:r.error?.code==='ETIMEDOUT'?'timeout':r.status,output_tail:out.slice(-2000)};
 });
}

const finding={type:'object',properties:{file:{type:'string'},line:{type:'integer',minimum:0},severity:{type:'string',enum:['blocker','major','minor','nit']},issue:{type:'string'},suggestion:{type:'string'}},required:['file','line','severity','issue','suggestion'],additionalProperties:false};
export const REVIEW_SCHEMA={type:'object',properties:{summary:{type:'string'},verdict:{type:'string',enum:['pass','redo','decision']},blocking_criteria:{type:'array',items:{type:'string'}},findings:{type:'array',items:finding},confidence:{type:'string',enum:['low','medium','high']}},required:['summary','verdict','blocking_criteria','findings','confidence'],additionalProperties:false};
const REVIEW_ORDERS=[
 'You are an independent reviewer from a different model family than the author. Find what is wrong or missing in this change against the success criteria.',
 'You get no summary, test claims or risk notes from the author on purpose. Judge only from the diff, the files you read yourself and the check results the controller ran.',
 'Open every changed file before you judge it. Untracked new files are listed by path and are not in the diff: read them directly.',
 'verdict: pass only if every success criterion is met by code you read and nothing in scope regresses; redo when the change must be fixed; decision only when requirements are ambiguous and a human must choose.',
 'For anything but pass, blocking_criteria lists each unmet criterion id (e.g. AC2) or a short concrete defect. Every finding needs a repository-relative file and a 1-based line (0 only when not tied to a line).',
 'severity: blocker breaks a success criterion, major is a real bug or risk, minor is worth fixing, nit is style. A redo counts only with at least one blocker or major finding at a real line.',
 'Report only what you verified by reading. When evidence is thin, say so in summary and lower confidence.',
 'Your FINAL message must be only the JSON object matching result_schema. Write summary, issue and suggestion in Korean.'
];
// agy는 프롬프트를 명령줄로만 받아(Windows 32,767자) diff를 작게 넣는다. 나머지는 파일을 직접 읽게 한다.
const DIFF_MAX={codex:200000,grok:200000,agy:12000};

export function reviewPrompt({criteria,base,diff,untracked,changed,checks,reviewer}){
 const max=DIFF_MAX[reviewer]??50000,cut=diff.length>max;
 return JSON.stringify({task:'review',success_criteria:criteria,base_ref:base,changed_files:changed,untracked_new_files:untracked,
  diff:cut?diff.slice(0,max):diff,...(cut?{diff_truncated:`diff is ${diff.length} chars; only the first ${max} are shown. Read the changed files directly for the rest.`}:{}),
  controller_checks:checks,result_schema:REVIEW_SCHEMA,instructions:[...REVIEW_ORDERS,...readOnlyOrders(ADAPTERS[reviewer].reader)]});
}

// 반려 근거가 없는 redo는 권고로만 본다. 줄 번호 있는 blocker·major 지적이 있어야 고칠 대상이 분명하다.
export function judge(result){
 const grounded=result.findings.some(f=>['blocker','major'].includes(f.severity)&&f.line>=1);
 return {verdict:result.verdict,advisory:result.verdict==='redo'&&!grounded};
}

function changes(repo,base,git){
 const diff=git(repo,['diff','--no-color',base]);
 const changed=git(repo,['diff','--name-only',base]).split(/\r?\n/).filter(Boolean);
 const untracked=git(repo,['ls-files','--others','--exclude-standard']).split(/\r?\n/).filter(Boolean);
 return {diff,changed,untracked};
}

export const reportsDir=(env=process.env)=>path.join(env.HFGS_HOME??path.join(os.homedir(),'.hf-game-studio'),'reviews');
function saveReport(report,dir=reportsDir()){
 fs.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,`${report.created_at.replace(/[:.]/g,'-')}-${report.kind}-${report.adapter}.json`);
 fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
 return file;
}

// 전문가 호출을 작업 트리 비교로 감싼다. 바뀌었으면 답을 버리고 실패시킨다.
function guarded(repo,run,{git=gitOut}={}){
 const before=snapshot(repo,{git});
 const out=run();
 if(snapshot(repo,{git})!==before)fail('전문가가 실행되는 동안 저장소가 바뀜: 답을 버림. git status로 바뀐 내용을 확인하고 되돌릴 것');
 return out;
}

export function review({repo,base,reviewer='codex',author='claude',criteria=[],checks:commands=[],model,effort},{invoke=invokeCli,git=gitOut,spawn=spawnSync,dir}={}){
 const adapter=ADAPTERS[reviewer];
 if(!adapter)fail(`알 수 없는 리뷰어: ${reviewer} (가능: ${Object.keys(ADAPTERS).join(', ')})`);
 if(!criteria.length)fail('성공 기준이 필요함: --criteria "AC1: ..." 또는 --criteria-file');
 const noId=criteria.find(c=>!/^AC\d+:/.test(c));
 if(noId)fail(`성공 기준은 "AC1: ..."처럼 ID로 시작해야 함: ${noId}`);
 const options={...(model?{model}:{}),...(effort?{reasoning_effort:effort}:{})};
 const reviewerModel=model??adapter.DEFAULT_MODEL??null;
 if(familyOf(author)===familyOf(reviewer,reviewerModel))fail(`리뷰어(${reviewer}${reviewerModel?' '+reviewerModel:''})가 작성자(${author})와 같은 계열: 다른 계열을 고를 것`);
 const {diff,changed,untracked}=changes(repo,base,git);
 if(!diff.trim()&&!untracked.length)fail(`${base} 이후 바뀐 것이 없음`);
 const checks=runChecks(repo,commands,{spawn});
 const prompt=reviewPrompt({criteria,base,diff,untracked,changed,checks,reviewer});
 const r=guarded(repo,()=>invoke(adapter,{repo,prompt,schema:REVIEW_SCHEMA,options}),{git});
 const {verdict,advisory}=judge(r.result);
 const report={kind:'review',created_at:new Date().toISOString(),repo,base,head:git(repo,['rev-parse','HEAD']).trim(),adapter:reviewer,model:reviewerModel,author,
  criteria,checks,verdict,advisory,summary:r.result.summary,confidence:r.result.confidence,blocking_criteria:r.result.blocking_criteria,
  findings:r.result.findings.map((f,i)=>({id:`F${i+1}`,...f})),session_id:r.session_id??null,redacted:r.redacted};
 return {report,file:saveReport(report,dir)};
}

export const WRITE_SCHEMA={type:'object',properties:{content:{type:'string'},new_terms:{type:'array',items:{type:'object',properties:{term:{type:'string'},definition:{type:'string'}},required:['term','definition'],additionalProperties:false}},notes:{type:'string'}},required:['content','new_terms','notes'],additionalProperties:false};
const WRITE_ORDERS=[
 'You are the writer for this game. Write the piece described in task, in the language given in language, with vivid, natural prose that fits the world and characters in the design docs.',
 'Use only names, places and terms defined in the glossary and world docs. If the piece needs a new proper noun, use it and list it in new_terms with a one-line definition; never invent one silently.',
 'Put the complete text in content, ready to save as-is: no summary, no outline, no commentary around it. When format is json, content must be a JSON document as a string that follows the given structure.',
 'Use notes for anything the lead should know: assumptions, conflicts with the design docs, open questions. Write notes in Korean.',
 'Your FINAL message must be only the JSON object matching result_schema.'
];

export function checkWriteBrief(b){
 if(!b||typeof b!=='object')fail('write brief가 객체가 아님');
 if(!str(b.task))fail('write brief에 task 필요');
 if(b.format!==undefined&&!['markdown','json'].includes(b.format))fail('format은 markdown 또는 json');
 if(b.context_sections!==undefined&&(typeof b.context_sections!=='object'||Array.isArray(b.context_sections)))fail('context_sections는 {"문서 경로": ["섹션 제목", ...]} 형식');
}

export function write(brief,{repo,writer='agy',model,effort},{invoke=invokeCli,git=gitOut,dir,root,warn=()=>{}}={}){
 checkWriteBrief(brief);
 const adapter=ADAPTERS[writer];
 if(!adapter)fail(`알 수 없는 작가: ${writer} (가능: ${Object.keys(ADAPTERS).join(', ')})`);
 const picked=brief.context_sections??{};
 const docs=[...new Set([...(brief.context_docs??loadKinds(root).context_docs),...Object.keys(picked)])].filter(d=>{
  const ok=fs.existsSync(path.join(repo,d));
  if(!ok)warn(`문서 없음(건너뜀): ${d}`);
  return ok;
 });
 const reading=docs.length?docDirectives(docs,picked,{repo,warn}):[];
 const prompt=JSON.stringify({task:'write',brief:{task:brief.task,kind:brief.kind??'prose',language:brief.language??'ko',format:brief.format??'markdown',
  ...(brief.length?{length:brief.length}:{}),...(brief.style?{style:brief.style}:{}),...(brief.structure?{structure:brief.structure}:{})},
  design_docs:reading,result_schema:WRITE_SCHEMA,instructions:[...WRITE_ORDERS,...readOnlyOrders(adapter.reader)]});
 const options={...(model?{model}:{}),...(effort?{reasoning_effort:effort}:{}),timeout_ms:30*60*1000};
 const r=guarded(repo,()=>invoke(adapter,{repo,prompt,schema:WRITE_SCHEMA,options,timeoutMs:options.timeout_ms}),{git});
 if((brief.format??'markdown')==='json'){try{JSON.parse(r.result.content);}catch(e){fail(`작가가 낸 content가 JSON이 아님: ${e.message}`);}}
 const report={kind:'write',created_at:new Date().toISOString(),repo,adapter:writer,model:model??adapter.DEFAULT_MODEL??null,brief,...r.result,session_id:r.session_id??null,redacted:r.redacted};
 return {report,file:saveReport(report,dir)};
}

// 리드가 지적마다 처분을 남긴다. 기각과 계약 오독에는 이유가 필요하다.
export const DISPOSITIONS=['act','consider','noted','dismissed','contract_misread'];
export function dispose(report,entries){
 if(report.kind!=='review')fail('리뷰 보고서가 아님');
 const byId=new Map(report.findings.map(f=>[f.id,f]));
 for(const entry of entries){
  const m=/^(F\d+)=([a-z_]+)(?::(.*))?$/s.exec(entry);
  if(!m)fail(`처분은 F1=act 또는 "F2=dismissed:이유" 형식: ${entry}`);
  const [,id,disposition,reason]=m,f=byId.get(id);
  if(!f)fail(`보고서에 없는 지적: ${id}`);
  if(!DISPOSITIONS.includes(disposition))fail(`처분은 ${DISPOSITIONS.join(', ')} 중 하나: ${disposition}`);
  if(['dismissed','contract_misread'].includes(disposition)&&!str(reason))fail(`${id}: ${disposition}에는 이유가 필요함`);
  f.disposition=disposition;
  if(str(reason))f.reason=reason.trim();
 }
 return report;
}

// 리뷰어(어댑터·모델)별: 보고서 수, 지적 수, 처분한 지적 중 act·consider 비율.
export function stats(reports){
 const rows=new Map();
 for(const r of reports.filter(r=>r.kind==='review')){
  const key=`${r.adapter} ${r.model??'(기본)'}`;
  const row=rows.get(key)??{reviewer:key,reports:0,findings:0,disposed:0,actionable:0};
  row.reports++;row.findings+=r.findings.length;
  for(const f of r.findings){if(!f.disposition)continue;row.disposed++;if(['act','consider'].includes(f.disposition))row.actionable++;}
  rows.set(key,row);
 }
 return [...rows.values()].map(r=>({...r,actionable_rate:r.disposed?Math.round(r.actionable/r.disposed*100)/100:null}));
}

function print(report,file){
 if(report.kind==='review'){
  console.log(`판정: ${report.verdict}${report.advisory?' (근거 있는 blocker·major 지적이 없어 권고로만 봄)':''}, 확신: ${report.confidence}`);
  console.log(report.summary);
  for(const f of report.findings)console.log(`${f.id} [${f.severity}] ${f.file}:${f.line} ${f.issue}\n   → ${f.suggestion}`);
 }else{
  console.log(report.content);
  if(report.new_terms.length)console.error('새 용어: '+report.new_terms.map(t=>`${t.term}(${t.definition})`).join(', '));
  if(str(report.notes))console.error('작가 메모: '+report.notes);
 }
 console.error(`보고서: ${file}`);
}

function parseArgs(args){
 const out={_:[],criteria:[],check:[]};
 for(let i=0;i<args.length;i++){
  const a=args[i];
  if(!a.startsWith('--')){out._.push(a);continue;}
  const k=a.slice(2).replace(/-/g,'_'),v=args[++i];
  if(v===undefined)fail(`${a}에 값이 필요함`);
  if(k==='criteria'||k==='check')out[k].push(v);else out[k]=v;
 }
 return out;
}

async function main(){
 const [cmd,...rest]=process.argv.slice(2),a=parseArgs(rest),repo=path.resolve(a.repo??process.cwd());
 if(cmd==='review'){
  if(!a.base)fail('--base <ref> 필요(예: main)');
  const criteria=[...a.criteria,...(a.criteria_file?fs.readFileSync(a.criteria_file,'utf8').split(/\r?\n/).filter(l=>/^AC\d+:/.test(l.trim())).map(l=>l.trim()):[])];
  const {report,file}=review({repo,base:a.base,reviewer:a.reviewer,author:a.author,criteria,checks:a.check,model:a.model,effort:a.effort});
  print(report,file);
  return report.verdict==='pass'?0:1;
 }
 if(cmd==='write'){
  if(!a._[0])fail('사용법: consult.mjs write <write-brief.json>');
  const {report,file}=write(JSON.parse(fs.readFileSync(a._[0],'utf8')),{repo,writer:a.writer,model:a.model,effort:a.effort},{warn:m=>console.error('경고: '+m)});
  print(report,file);
  return 0;
 }
 if(cmd==='dispose'){
  const [file,...entries]=a._;
  if(!file||!entries.length)fail('사용법: consult.mjs dispose <report.json> F1=act "F2=dismissed:이유" ...');
  const report=dispose(JSON.parse(fs.readFileSync(file,'utf8')),entries);
  fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
  console.log(`처분 기록: ${entries.length}건 (${file})`);
  return 0;
 }
 if(cmd==='stats'){
  const dir=reportsDir();
  const reports=fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'))):[];
  console.table(stats(reports));
  return 0;
 }
 fail('사용법: consult.mjs review|write|dispose|stats ...');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
 main().then(code=>process.exit(code),e=>{console.error('오류: '+e.message);process.exit(2);});
