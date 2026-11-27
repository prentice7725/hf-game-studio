#!/usr/bin/env node
// 다른 계열 모델을 읽기 전용 전문가로 부른다(v2 3단계). 파일은 고치지 않고 결과를 JSON으로만 돌려받는다.
//
//   review  변경을 다른 계열 모델에게 리뷰받는다. 작성자의 요약·주장은 주지 않고 diff, 바뀐 파일, 검사 결과만 준다.
//   write   글(대사, 로어, 서술)을 작가 모델(기본 Gemini Argon)에게 맡긴다. 결과 글은 리드가 파일로 쓴다.
//   dispose 리뷰 지적마다 리드의 처분(act, consider, noted, dismissed, contract_misread)과 이유를 남긴다.
//           사람이 확인할 수용 기준은 사용자의 확인(AC5=confirmed, "AC5=rejected:이유")을 남긴다.
//   stats   리뷰어별로 쓸모 있는 지적 비율을 본다.
//
// 사용법:
//   공통: [--host claude|codex|agy|gemini] 리드 호스트(없으면 HFGS_HOST, Claude Code는 자동 감지).
//        리뷰의 작성자 기본값과 리뷰어 기본값(작성자와 다른 계열), 글을 따로 맡길지가 여기서 정해진다.
//   node scripts/consult.mjs review --task <task_id> [--reviewer ...] [--author ...] [--model M] [--effort E]
//        task.mjs verify를 통과한 작업 기록에서 저장소·기준 커밋·수용 기준·수용 검사를 읽는다(verify가 이 명령을 출력한다).
//   node scripts/consult.mjs review --base <ref> [--repo DIR] [--reviewer codex|claude|agy|grok] [--author claude|codex|agy|gemini|grok] [--author-model M]
//        [--criteria "AC1: ..."]... [--criteria-file F] [--check "<명령>"]... [--model M] [--effort E]
//   node scripts/consult.mjs write <write-brief.json> [--repo DIR] [--writer agy|claude|codex|grok|vertex] [--model M] [--effort E]
//        vertex는 agy를 거치지 않고 Vertex AI를 직접 부른다(서비스 계정 키, --model 필수, 글쓰기 전용).
//   node scripts/consult.mjs dispose <report.json> F1=act "F2=dismissed:이유" "AC5=confirmed:확인 내용" ...
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
import {runChecks} from './lib/checks.mjs';
export {runChecks};
import {invoke as invokeCli,readOnlyOrders} from './lib/cli.mjs';
import {loadKinds,docDirectives,docContents,stateFile} from './task.mjs';
import {familyOf,hostFamily,pickReviewer,resolveHost,hostWarning,HOST_MODEL_ENV,HOSTS} from './lib/host.mjs';
export {familyOf};

function fail(m){throw Object.assign(Error(m),{usage:true});}
const str=v=>typeof v==='string'&&v.trim().length>0;

// 리뷰 독립성은 모델을 만든 회사(계열)로 판단한다(lib/host.mjs의 familyOf).

// 전문가가 저장소를 바꾸지 않았는지 전후로 비교한다. 각 CLI의 읽기 전용 모드는 보증이 아니다(agy --sandbox는 쓰기 도구를 못 막는다).
// git diff는 추적되지 않은 파일의 내용을 담지 않으므로, 이미 있던 새 파일을 고쳐도 status·diff가 같다. 그 파일들은 내용까지 해시한다.
export function snapshot(repo,{git=gitOut,read=f=>fs.readFileSync(f)}={}){
 const hash=crypto.createHash('sha256');
 hash.update(git(repo,['rev-parse','HEAD']).trim()+'\0'+git(repo,['status','--porcelain=v1','-uall'])+'\0'+git(repo,['diff','--binary','HEAD']));
 for(const f of untrackedFiles(repo,git)){
  let body;
  try{body=read(path.join(repo,f));}catch(e){fail(`작업 트리 비교 중 새 파일을 읽지 못함: ${f} (${e.code??e.message})`);}
  hash.update('\0'+f+'\0').update(body);
 }
 return hash.digest('hex');
}
// -z로 받는다. 기본 설정(core.quotePath)은 한글 같은 비ASCII 파일명을 따옴표와 8진수 이스케이프로 내보내 실제 경로로 쓸 수 없다.
const nulList=text=>text.split('\0').filter(Boolean);
const untrackedFiles=(repo,git)=>nulList(git(repo,['ls-files','-z','--others','--exclude-standard']));
function gitOut(repo,args){
 const r=spawnSync('git',['-C',repo,...args],{encoding:'utf8',maxBuffer:256*1024*1024,windowsHide:true});
 if(r.status!==0)fail(`git ${args.join(' ')} 실패: ${String(r.stderr).trim()}`);
 return r.stdout;
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
 // hyperfusion 0.31.0·0.33.0에서 옮김: 리뷰어가 구현만 보고 테스트가 기준을 실제로 검사하는지는 보지 않았고, {text:null}과 키 없음의 차이도 놓쳤다.
 'Check the tests and checks this change adds or relies on against every success criterion: report a criterion no test exercises, an assertion that is always true, and a test that would still pass with a wrong implementation. A passing controller check proves only what that check asserts.',
 'Check the boundaries the change handles: null and undefined (a missing key versus null), empty strings, arrays and objects, zero, negative and limit numbers, every enum value and both booleans, repeated runs, and non-ASCII text. Skip kinds the change does not touch. Report an unhandled boundary that a success criterion depends on.',
 'Report only what you verified by reading. When evidence is thin, say so in summary and lower confidence.',
 'Your FINAL message must be only the JSON object matching result_schema. Write summary, issue and suggestion in Korean.'
];
// agy는 프롬프트를 명령줄로만 받아(Windows 32,767자) diff를 작게 넣는다. 나머지는 파일을 직접 읽게 한다.
const DIFF_MAX={codex:200000,grok:200000,agy:12000};

export function reviewPrompt({criteria,base,diff,untracked,changed,checks,notes=[],reviewer}){
 const max=DIFF_MAX[reviewer]??50000,cut=diff.length>max;
 return JSON.stringify({task:'review',success_criteria:criteria,base_ref:base,changed_files:changed,untracked_new_files:untracked,
  diff:cut?diff.slice(0,max):diff,...(cut?{diff_truncated:`diff is ${diff.length} chars; only the first ${max} are shown. Read the changed files directly for the rest.`}:{}),
  controller_checks:checks,...(notes.length?{controller_notes:notes}:{}),result_schema:REVIEW_SCHEMA,instructions:[...REVIEW_ORDERS,...readOnlyOrders(ADAPTERS[reviewer].reader)]});
}

// 반려 근거가 없는 redo는 권고로만 본다. 줄 번호 있는 blocker·major 지적이 있어야 고칠 대상이 분명하다.
export function judge(result){
 const grounded=result.findings.some(f=>['blocker','major'].includes(f.severity)&&f.line>=1);
 return {verdict:result.verdict,advisory:result.verdict==='redo'&&!grounded};
}

function changes(repo,base,git){
 const diff=git(repo,['diff','--no-color',base]);
 const changed=nulList(git(repo,['diff','-z','--name-only',base]));
 const untracked=untrackedFiles(repo,git);
 return {diff,changed,untracked};
}

export const reportsDir=(env=process.env)=>path.join(env.HFGS_HOME??path.join(os.homedir(),'.hf-game-studio'),'reviews');
function saveReport(report,dir=reportsDir()){
 fs.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,`${report.created_at.replace(/[:.]/g,'-')}-${report.kind}-${report.adapter}.json`);
 fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
 return file;
}

// 모델 쪽 일시 오류(용량 초과·과부하)는 한 번만 다시 부른다. 마일스톤 2에서 Codex가 'Selected model is at capacity'로
// 실패했고 바로 다시 돌리니 통과했다. 두 번째도 실패하면 다른 리뷰어·작가로 바꾸라고 알린다.
export const TRANSIENT=/at capacity|overloaded|rate limit/i;
// 사용량·요금 한도는 일시 오류가 아니다. 보통 몇 시간 단위로 풀리고 그사이 재시도는 같은 실패를 되풀이한다(hyperfusion 0.32.0에서 옮김).
export const USAGE_LIMIT=/usage[ _-]?limit|insufficient[ _-]?quota|exceeded (?:your|the) (?:current )?quota|quota (?:exceeded|exhausted)|resource[ _-]?exhausted|out of credits|credit balance is too low/i;
export function retrying(run,{log=console.error,other='다른 계열(--reviewer agy 등)'}={}){
 try{return run();}
 catch(e){
  if(USAGE_LIMIT.test(e.message)){e.message+=` (사용량 한도: 다시 불러도 같다. ${other}로 바꿀 것)`;throw e;}
  if(!TRANSIENT.test(e.message))throw e;
  log(`일시 오류라 한 번 다시 부름: ${e.message.slice(0,200)}`);
  try{return run();}
  catch(e2){if(TRANSIENT.test(e2.message))e2.message+=` (다시 불러도 일시 오류: 잠시 뒤에 하거나 ${other}로 바꿀 것)`;throw e2;}
 }
}

// 전문가 호출을 작업 트리 비교로 감싼다. 바뀌었으면 답을 버리고 실패시킨다.
function guarded(repo,run,{git=gitOut}={}){
 const before=snapshot(repo,{git});
 const out=run();
 if(snapshot(repo,{git})!==before)fail('전문가가 실행되는 동안 저장소가 바뀜: 답을 버림. git status로 바뀐 내용을 확인하고 되돌릴 것');
 return out;
}

// review --task: verify가 남긴 작업 기록에서 리뷰 입력을 읽는다. 수용 검사는 저장된 형태(문자열이나 인자 배열) 그대로 runChecks에 간다.
export function reviewInputFromTask(taskId,{env=process.env}={}){
 if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(taskId??''))fail(`task_id 형식이 아님: ${taskId}`);
 const file=stateFile(taskId,env);
 if(!fs.existsSync(file))fail(`작업 기록 없음: ${file} (task.mjs start·verify를 먼저)`);
 const state=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!state.verify?.ok)fail(`verify를 통과하지 않은 작업: ${taskId}. task.mjs verify가 통과한 뒤 리뷰할 것`);
 // 정적 검사(타입·구조) 결과도 넘겨 리뷰어가 타입 오류를 다시 찾지 않게 한다. 예전 기록에는 static_commands가 없다.
 const notes=[
  ...(state.plan.no_visual_check?[`No visual check was run for this task (the author's stated reason: ${state.plan.no_visual_check}). Judge whether the change really leaves the screen unchanged.`]:[]),
  ...(state.plan.static_off?[`Automatic static checks were turned off for this task (the author's stated reason: ${state.plan.static_off}).`]:[]),
  ...(state.verify.evidence?.length?[`Visual evidence saved by task.mjs verify (screenshots a human checks; open them if you can read images): ${state.verify.evidence.map(e=>e.file).join(', ')}`]:[])
 ];
 // 작성자는 그 작업을 시작한 리드다. 예전 기록에는 host가 없다.
 return {repo:state.repo,base:state.verify.base??state.head,criteria:state.plan.success_criteria,checks:[...(state.plan.static_commands??[]),...state.plan.acceptance_commands],notes,...(state.host?{author:state.host}:{})};
}

// 작성자 기본값은 리드 호스트, 리뷰어 기본값은 작성자와 계열이 다른 첫 전문가다(Claude 리드면 Codex, Codex 리드면 Claude).
export function review({repo,base,reviewer,author,authorModel,criteria=[],checks:commands=[],notes=[],model,effort,host},{invoke=invokeCli,git=gitOut,spawn=spawnSync,dir,env=process.env}={}){
 host??=resolveHost({env}).host;
 author??=host;
 if(author===host)authorModel??=env[HOST_MODEL_ENV];
 if(!reviewer){
  const family=familyOf(author,authorModel);
  reviewer=pickReviewer(family,Object.keys(ADAPTERS).filter(n=>ADAPTERS[n].reader!=='inline'));
  if(!reviewer)fail(`작성자(${author}${authorModel?' '+authorModel:''})와 계열이 다른 리뷰어를 고르지 못함: --reviewer로 정할 것`);
 }
 const adapter=ADAPTERS[reviewer];
 if(!adapter)fail(`알 수 없는 리뷰어: ${reviewer} (가능: ${Object.keys(ADAPTERS).join(', ')})`);
 // 리뷰어는 바뀐 파일을 직접 읽어야 한다. 파일을 읽지 못하는 작가(vertex)는 글쓰기 전용이다.
 if(adapter.reader==='inline')fail(`${reviewer}는 파일을 읽지 못해 리뷰를 맡길 수 없음(글쓰기 전용): codex, claude, grok, agy 중에서 고를 것`);
 if(!criteria.length)fail('성공 기준이 필요함: --criteria "AC1: ..." 또는 --criteria-file');
 const noId=criteria.find(c=>!/^AC\d+:/.test(c));
 if(noId)fail(`성공 기준은 "AC1: ..."처럼 ID로 시작해야 함: ${noId}`);
 const options={...(model?{model}:{}),...(effort?{reasoning_effort:effort}:{})};
 const reviewerModel=model??adapter.DEFAULT_MODEL??null;
 // agy는 Gemini도 Claude도 돌릴 수 있어 CLI 이름만으로는 작성자 계열을 알 수 없다.
 if(author==='agy'&&!authorModel)fail(`작성자가 agy면 작성한 모델을 적을 것(agy는 Gemini와 Claude를 모두 돌린다): --author-model <모델>${author===host?`, 리드가 agy면 ${HOST_MODEL_ENV}=<모델>을 환경에 둬도 됨`:''}`);
 const authorFamily=familyOf(author,authorModel);
 if(!authorFamily)fail(`작성자 계열을 알 수 없음: ${author}${authorModel?' '+authorModel:''}`);
 if(authorFamily===familyOf(reviewer,reviewerModel))fail(`리뷰어(${reviewer}${reviewerModel?' '+reviewerModel:''})가 작성자(${author}${authorModel?' '+authorModel:''})와 같은 계열: 다른 계열을 고를 것`);
 const before=changes(repo,base,git);
 if(!before.diff.trim()&&!before.untracked.length)fail(`${base} 이후 바뀐 것이 없음`);
 const checks=runChecks(repo,commands,{spawn});
 // 검사가 파일을 만들거나 고칠 수 있으므로 diff와 목록은 검사가 끝난 뒤의 상태로 다시 받는다. 리뷰어가 보는 것과 작업 트리 비교의 기준이 같아진다.
 const {diff,changed,untracked}=commands.length?changes(repo,base,git):before;
 const prompt=reviewPrompt({criteria,base,diff,untracked,changed,checks,notes,reviewer});
 const r=guarded(repo,()=>retrying(()=>invoke(adapter,{repo,prompt,schema:REVIEW_SCHEMA,options})),{git});
 const {verdict,advisory}=judge(r.result);
 const report={kind:'review',created_at:new Date().toISOString(),repo,base,head:git(repo,['rev-parse','HEAD']).trim(),adapter:reviewer,model:reviewerModel,author,author_model:authorModel??null,
  criteria,checks,verdict,advisory,summary:r.result.summary,confidence:r.result.confidence,blocking_criteria:r.result.blocking_criteria,
  findings:r.result.findings.map((f,i)=>({id:`F${i+1}`,...f})),session_id:r.session_id??null,redacted:r.redacted};
 return {report,file:saveReport(report,dir),warnings:r.warnings??[]};
}

export const WRITE_SCHEMA={type:'object',properties:{content:{type:'string'},new_terms:{type:'array',items:{type:'object',properties:{term:{type:'string'},definition:{type:'string'}},required:['term','definition'],additionalProperties:false}},notes:{type:'string'}},required:['content','new_terms','notes'],additionalProperties:false};
const WRITE_ORDERS=[
 'You are the writer for this game. Write the piece described in task, in the language given in language, with vivid, natural prose that fits the world and characters in the design docs.',
 'success_criteria are the acceptance criteria the lead will check your piece against (e.g. which choices or branches it must offer). Meet every one of them; if one cannot be met, say which and why in notes.',
 'Use only names, places and terms defined in the glossary and world docs. If the piece needs a new proper noun, use it and list it in new_terms with a one-line definition; never invent one silently.',
 'Put the complete text in content, ready to save as-is: no summary, no outline, no commentary around it. When format is json, content must be a JSON document as a string that follows the given structure.',
 'Use notes for anything the lead should know: assumptions, conflicts with the design docs, open questions. Write notes in Korean.',
 'Your FINAL message must be only the JSON object matching result_schema.'
];

export function checkWriteBrief(b){
 if(!b||typeof b!=='object')fail('write brief가 객체가 아님');
 if(!str(b.task))fail('write brief에 task 필요');
 if(b.format!==undefined&&!['markdown','json'].includes(b.format))fail('format은 markdown 또는 json');
 if(b.success_criteria!==undefined&&(!Array.isArray(b.success_criteria)||!b.success_criteria.every(str)))fail('success_criteria는 문자열 배열');
 if(b.context_sections!==undefined&&(typeof b.context_sections!=='object'||Array.isArray(b.context_sections)))fail('context_sections는 {"문서 경로": ["섹션 제목", ...]} 형식');
}

// 작가 기본값은 Gemini Argon(agy)이다. 리드가 이미 Google 계열이면 같은 모델을 한 번 더 부를 이유가 없으므로 리드가 직접 쓴다.
export function write(brief,{repo,writer,model,effort,host},{invoke=invokeCli,git=gitOut,dir,root,warn=()=>{},env=process.env}={}){
 checkWriteBrief(brief);
 host??=resolveHost({env}).host;
 if(!writer){
  if(hostFamily(host,env)==='google')fail(`리드(${HOSTS[host].label})가 Google 계열이라 글은 리드가 직접 씀. 다른 모델의 글이 필요하면 --writer claude|codex|grok으로 정할 것`);
  writer='agy';
 }
 const adapter=ADAPTERS[writer];
 if(!adapter)fail(`알 수 없는 작가: ${writer} (가능: ${Object.keys(ADAPTERS).join(', ')})`);
 const picked=brief.context_sections??{};
 const docs=[...new Set([...(brief.context_docs??loadKinds(root).context_docs),...Object.keys(picked)])].filter(d=>{
  const ok=fs.existsSync(path.join(repo,d));
  if(!ok)warn(`문서 없음(건너뜀): ${d}`);
  return ok;
 });
 // 파일을 읽는 작가에게는 읽을 곳을, 읽지 못하는 작가에게는 본문을 준다.
 const reading=!docs.length?[]:adapter.reader==='inline'?docContents(docs,picked,{repo}):docDirectives(docs,picked,{repo,warn});
 // 수용 기준을 작가에게도 보인다. 없으면 작가가 거절 분기 같은 필수 요소를 모르고 쓴다(마일스톤 1 실측).
 const prompt=JSON.stringify({task:'write',brief:{task:brief.task,...(brief.success_criteria?.length?{success_criteria:brief.success_criteria}:{}),kind:brief.kind??'prose',language:brief.language??'ko',format:brief.format??'markdown',
  ...(brief.length?{length:brief.length}:{}),...(brief.style?{style:brief.style}:{}),...(brief.structure?{structure:brief.structure}:{})},
  design_docs:reading,result_schema:WRITE_SCHEMA,instructions:[...WRITE_ORDERS,...readOnlyOrders(adapter.reader)]});
 const options={...(model?{model}:{}),...(effort?{reasoning_effort:effort}:{}),timeout_ms:30*60*1000};
 const r=guarded(repo,()=>retrying(()=>invoke(adapter,{repo,prompt,schema:WRITE_SCHEMA,options,timeoutMs:options.timeout_ms}),{other:'다른 작가(--writer codex 등)'}),{git});
 if((brief.format??'markdown')==='json'){try{JSON.parse(r.result.content);}catch(e){fail(`작가가 낸 content가 JSON이 아님: ${e.message}`);}}
 const report={kind:'write',created_at:new Date().toISOString(),repo,adapter:writer,model:model??adapter.DEFAULT_MODEL??process.env[adapter.MODEL_ENV??'']??null,brief,...r.result,session_id:r.session_id??null,redacted:r.redacted};
 return {report,file:saveReport(report,dir),warnings:r.warnings??[]};
}

// 리드가 지적마다 처분을 남긴다. 기각과 계약 오독에는 이유가 필요하다.
export const DISPOSITIONS=['act','consider','noted','dismissed','contract_misread'];
// 사람이 확인할 수용 기준(소리, 보이는 모양)은 리뷰어가 판정하지 못해 verdict가 decision으로 끝난다.
// 사용자가 확인한 결과는 "AC5=confirmed:들어 봄"이나 "AC5=rejected:이유"로 같은 보고서에 남긴다.
export const CONFIRMATIONS=['confirmed','rejected'];
export function dispose(report,entries,{now=()=>new Date().toISOString()}={}){
 if(report.kind!=='review')fail('리뷰 보고서가 아님');
 const byId=new Map(report.findings.map(f=>[f.id,f]));
 for(const entry of entries){
  const ac=/^(AC\d+)=([a-z_]+)(?::(.*))?$/s.exec(entry);
  if(ac){
   const [,id,status,note]=ac;
   if(!(report.criteria??[]).some(c=>c.startsWith(id+':')))fail(`보고서의 수용 기준에 없는 기준: ${id}`);
   if(!CONFIRMATIONS.includes(status))fail(`수용 기준의 사용자 확인은 ${CONFIRMATIONS.join(', ')} 중 하나: ${status}`);
   if(status==='rejected'&&!str(note))fail(`${id}: rejected에는 이유가 필요함`);
   report.confirmations={...(report.confirmations??{}),[id]:{status,by:'user',at:now(),...(str(note)?{note:note.trim()}:{})}};
   continue;
  }
  const m=/^(F\d+)=([a-z_]+)(?::(.*))?$/s.exec(entry);
  if(!m)fail(`처분은 F1=act, "F2=dismissed:이유", "AC5=confirmed:확인 내용" 형식: ${entry}`);
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

function print(report,file,warnings=[]){
 for(const w of warnings)console.error('경고: '+w);
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
 const resolved=resolveHost({flag:a.host}),host=resolved.host;
 if(hostWarning(resolved)&&(cmd==='review'||cmd==='write'))console.error('경고: '+hostWarning(resolved));
 if(cmd==='review'){
  let input;
  if(a.task!==undefined){
   if(a.base||a.repo||a.criteria.length||a.criteria_file||a.check.length)fail('--task는 저장소·기준 커밋·수용 기준·검사를 작업 기록에서 읽으므로 --repo·--base·--criteria·--check와 함께 쓰지 않음');
   input=reviewInputFromTask(a.task);
  }else{
   if(!a.base)fail('--task <task_id>나 --base <ref>가 필요(예: main)');
   const criteria=[...a.criteria,...(a.criteria_file?fs.readFileSync(a.criteria_file,'utf8').split(/\r?\n/).filter(l=>/^AC\d+:/.test(l.trim())).map(l=>l.trim()):[])];
   input={repo,base:a.base,criteria,checks:a.check};
  }
  const {report,file,warnings}=review({...input,reviewer:a.reviewer,author:a.author??input.author,authorModel:a.author_model,model:a.model,effort:a.effort,host});
  print(report,file,warnings);
  return report.verdict==='pass'?0:1;
 }
 if(cmd==='write'){
  if(!a._[0])fail('사용법: consult.mjs write <write-brief.json>');
  const {report,file,warnings}=write(JSON.parse(fs.readFileSync(a._[0],'utf8')),{repo,writer:a.writer,model:a.model,effort:a.effort,host},{warn:m=>console.error('경고: '+m)});
  print(report,file,warnings);
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

if(process.argv[1]&&import.meta.url===pathToFileURL(fs.realpathSync(process.argv[1])).href)
 main().then(code=>process.exit(code),e=>{console.error('오류: '+e.message);process.exit(2);});
