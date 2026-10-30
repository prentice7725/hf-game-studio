#!/usr/bin/env node
// 게임 brief → hyperfusion brief 컴파일러.
// hyperfusion의 task_kind는 6종(code, ui, image-asset, tests, refactor, docs)으로 고정이라
// 게임 작업 종류(gdd, narrative, balance-data ...)는 여기서 그 6종으로 내려 보내고,
// 역할 지시문·단일 원본 문서·게임용 수용 검사를 brief의 표준 필드(constraints, acceptance_commands)에 채운다.
// hyperfusion 코드는 건드리지 않는다.
//
// 사용법: node scripts/brief.mjs <게임-brief.json> [--repo <게임 저장소>] [--out <파일>]
// HF_SKILL이 설정되어 있으면 hyperfusion의 brief 검증(contracts.mjs)까지 통과하는지 확인한다.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
export const STUDIO_ROOT=path.resolve(HERE,'..');
// setup.mjs가 게임 저장소에 검사 도구를 복사하는 위치. 수용 명령은 저장소 기준 상대 경로로 돈다.
export const TOOLS_DIR='tools/hfgs';
// 게임 brief에서 hyperfusion brief로 그대로 넘기는 필드.
const PASSTHROUGH=['acceptance_timeout_ms','acceptance_artifacts','acceptance_baseline_green','verification','executor_bash_rules','prior_experience'];

export function loadKinds(root=STUDIO_ROOT){
 return JSON.parse(fs.readFileSync(path.join(root,'game-kinds.json'),'utf8'));
}

// 역할 파일에서 '- '로 시작하는 줄만 지시문으로 쓴다(머리말과 주석은 사람용).
export function roleDirectives(role,root=STUDIO_ROOT){
 const file=path.join(root,'roles',`${role}.md`);
 if(!fs.existsSync(file))throw Error(`역할 파일 없음: roles/${role}.md`);
 return fs.readFileSync(file,'utf8').split(/\r?\n/).filter(l=>l.startsWith('- ')).map(l=>l.slice(2).trim());
}

// 셸에서 한 단어로 읽히도록 감싼다. 공백·따옴표 없는 평범한 경로는 그대로 둔다.
export const quote=s=>/^[\w./:@=-]+$/.test(s)?s:JSON.stringify(s);

function fail(m){throw Error(m);}
const str=v=>typeof v==='string'&&v.trim().length>0;

export function autoAcceptance(input,kind){
 const out=[];
 const paths=input.scope.paths;
 if(kind.verify==='schema'&&input.schema){
  const files=input.data_files??paths.filter(p=>p.endsWith('.json'));
  if(!files.length)fail('schema 검사 대상 JSON이 없음: data_files를 적거나 scope.paths에 .json 파일을 넣을 것');
  out.push(['node',`${TOOLS_DIR}/validate-data.mjs`,input.schema,...files].map(quote).join(' '));
 }
 if(kind.verify==='assets'&&input.assets_manifest){
  const files=input.asset_files??paths.filter(p=>p.toLowerCase().endsWith('.png'));
  out.push(['node',`${TOOLS_DIR}/check-assets.mjs`,input.assets_manifest,...files.flatMap(f=>['--only',f])].map(quote).join(' '));
 }
 if(kind.verify==='screenshot'&&input.screenshot){
  const s=input.screenshot,args=['node',`${TOOLS_DIR}/screenshot.mjs`];
  const target=['url','file','electron'].filter(k=>s[k]!==undefined);
  if(target.length!==1)fail('screenshot에는 url, file, electron 중 하나만 적을 것');
  if(!str(s.selector))fail('screenshot.selector 필요');
  args.push(`--${target[0]}`,s[target[0]],'--selector',s.selector);
  if(s.expect_text)args.push('--expect-text',s.expect_text);
  args.push('--name',s.name??input.task_id);
  out.push(args.map(quote).join(' '));
 }
 return out;
}

export function compile(input,{repo=process.cwd(),root=STUDIO_ROOT,warn=()=>{}}={}){
 const table=loadKinds(root);
 if(!input||typeof input!=='object')fail('게임 brief가 객체가 아님');
 const kind=table.kinds[input.game_kind];
 if(!kind)fail(`알 수 없는 game_kind: ${input.game_kind} (가능: ${Object.keys(table.kinds).join(', ')})`);
 if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(input.task_id??''))fail('task_id는 영문·숫자·_-로 80자 이내');
 if(!str(input.objective))fail('objective 필요');
 if(!Array.isArray(input.scope?.paths)||!input.scope.paths.length)fail('scope.paths 필요');
 if(!Array.isArray(input.success_criteria)||!input.success_criteria.length)fail('success_criteria 필요');
 const noId=input.success_criteria.find(c=>!/^AC\d+:/.test(c));
 if(noId)fail(`수용 기준은 "AC1: ..."처럼 ID로 시작해야 함: ${noId}`);
 for(const k of kind.require??[])if(!str(input[k]))fail(`${input.game_kind} 작업에는 ${k}가 필요함`);
 // 검사 기준 파일을 일꾼 범위에 넣으면 일꾼이 검사를 약하게 고쳐 통과시킬 수 있다.
 for(const k of ['schema','assets_manifest'])
  if(input[k]&&input.scope.paths.includes(input[k]))fail(`${k}(${input[k]})가 scope.paths에 있음: 검사 기준은 일꾼이 고칠 수 없게 범위 밖에 둘 것`);

 const role=input.role===undefined?kind.role:input.role;
 const docs=(input.context_docs??table.context_docs).filter(d=>{
  const ok=fs.existsSync(path.join(repo,d));
  if(!ok)warn(`단일 원본 문서 없음(건너뜀): ${d}`);
  return ok;
 });
 const constraints=[
  ...kind.constraints,
  ...(role?roleDirectives(role,root):[]),
  ...(docs.length?[`Single source of truth: read ${docs.join(', ')} before editing and follow them. If they conflict with this brief, return needs_decision.`]:[]),
  ...(input.constraints??[])
 ];

 const auto=autoAcceptance(input,kind);
 const commands=[...new Set([...(input.acceptance_commands??[]),...auto])];
 if(commands.length>10)fail('acceptance_commands는 10개까지');
 if(!commands.length)warn('수용 명령이 없음: 일꾼의 보고만으로 판정하게 된다. 가능하면 schema·assets_manifest·screenshot을 적을 것');

 // acceptance_map의 "@auto"는 자동으로 만든 수용 명령 전부를 뜻한다.
 let map;
 if(input.acceptance_map){
  map=Object.fromEntries(Object.entries(input.acceptance_map).map(([ac,cmds])=>[ac,[...new Set(cmds.flatMap(c=>c==='@auto'?auto:[c]))]]));
  for(const [ac,cmds] of Object.entries(map)){
   if(!input.success_criteria.some(c=>c.startsWith(ac+':')))fail(`acceptance_map의 ${ac}가 success_criteria에 없음`);
   const unknown=cmds.find(c=>!commands.includes(c));
   if(unknown)fail(`acceptance_map의 명령이 acceptance_commands에 없음: ${unknown}`);
   if(!cmds.length)fail(`acceptance_map의 ${ac}에 명령이 없음("@auto"인데 자동 수용 명령이 만들어지지 않음)`);
  }
 }

 const out={
  task_id:input.task_id,
  objective:input.objective,
  scope:{paths:input.scope.paths},
  constraints,
  success_criteria:input.success_criteria,
  allowed_actions:input.allowed_actions??kind.allowed_actions,
  task_kind:kind.task_kind,
  ...(input.difficulty??kind.difficulty?{difficulty:input.difficulty??kind.difficulty}:{}),
  ...(commands.length?{acceptance_commands:commands}:{}),
  ...(map?{acceptance_map:map}:{})
 };
 for(const k of PASSTHROUGH)if(input[k]!==undefined)out[k]=input[k];
 return out;
}

// HF_SKILL이 있으면 hyperfusion 자체 검증을 한 번 더 돌린다(설치된 버전의 규칙이 기준).
export async function checkWithHyperfusion(brief,skill=process.env.HF_SKILL){
 if(!skill)return false;
 const {brief:validate}=await import(pathToFileURL(path.join(skill,'scripts','contracts.mjs')).href);
 validate(structuredClone(brief));
 return true;
}

async function main(){
 const args=process.argv.slice(2);
 let file,repo=process.cwd(),outFile;
 for(let i=0;i<args.length;i++){
  if(args[i]==='--repo')repo=args[++i];
  else if(args[i]==='--out')outFile=args[++i];
  else if(!file)file=args[i];
  else fail(`알 수 없는 인자: ${args[i]}`);
 }
 if(!file)fail('사용법: brief.mjs <게임-brief.json> [--repo DIR] [--out FILE]');
 const input=JSON.parse(fs.readFileSync(file,'utf8'));
 const brief=compile(input,{repo,warn:m=>console.error('경고: '+m)});
 if(await checkWithHyperfusion(brief))console.error('hyperfusion brief 검증 통과');
 const text=JSON.stringify(brief,null,2)+'\n';
 if(outFile){fs.writeFileSync(outFile,text);console.error(`작성: ${outFile}`);}
 else process.stdout.write(text);
}

if(import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error('오류: '+e.message);process.exit(1);});
