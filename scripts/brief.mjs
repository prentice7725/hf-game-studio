#!/usr/bin/env node
// 게임 brief → hyperfusion brief 컴파일러.
// hyperfusion의 task_kind는 6종(code, ui, image-asset, tests, refactor, docs)으로 고정이라
// 게임 작업 종류(gdd, narrative, balance-data ...)는 여기서 그 6종으로 내려 보내고,
// 역할 지시문·단일 원본 문서·게임용 수용 검사를 brief의 표준 필드(constraints, acceptance_commands)에 채운다.
// hyperfusion 코드는 건드리지 않는다.
//
// 사용법: node scripts/brief.mjs <게임-brief.json> [--repo <게임 저장소>] [--out <파일> | --stdout]
// 기본 출력은 저장소 밖 임시 폴더(<tmp>/hfgs-briefs/<task_id>.json, HFGS_BRIEF_DIR로 변경)이고 그 경로를 출력한다.
// 저장소 안에 쓰면 추적되지 않는 파일이 생겨 hyperfusion의 변경 목록에 섞인다.
// HF_SKILL이 설정되어 있으면 hyperfusion의 brief 검증(contracts.mjs)까지 통과하는지 확인한다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
export const STUDIO_ROOT=path.resolve(HERE,'..');
// setup.mjs가 게임 저장소에 검사 도구를 복사하는 위치. 수용 명령은 저장소 기준 상대 경로로 돈다.
export const TOOLS_DIR='tools/hfgs';
// 이보다 큰 설계 문서는 통째로 읽히지 않게 한다. Claude Code의 Read는 한 번에 약 2.5만 토큰까지라
// 큰 문서는 읽기가 실패해 나눠 다시 읽고, 일꾼·라운드마다 반복되면 토큰이 크게 늘어난다(원본 템플릿 #64, #136).
export const LARGE_DOC_BYTES=40*1024;
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

// 마크다운 제목과 그 섹션의 줄 범위(1부터, 끝 포함). 코드 블록 안의 #은 제목으로 보지 않는다.
// 섹션은 다음에 오는 같은 단계 이상의 제목 직전까지다(하위 섹션 포함).
export function sections(text){
 const lines=text.split(/\r?\n/),found=[];
 let fence=null;
 lines.forEach((l,i)=>{
  const f=/^\s*(```|~~~)/.exec(l);
  if(f){fence=fence===null?f[1]:(fence===f[1]?null:fence);return;}
  if(fence!==null)return;
  const h=/^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
  if(h)found.push({title:h[2].trim(),level:h[1].length,start:i+1});
 });
 const last=lines.length-(lines.at(-1)===''?1:0);
 return found.map((h,i)=>{
  const next=found.slice(i+1).find(x=>x.level<=h.level);
  return {...h,end:next?next.start-1:last};
 });
}

// 단일 원본 문서를 어떻게 읽을지 일꾼에게 줄 지시문을 만든다.
// context_sections에 섹션을 적은 문서는 그 섹션만, 작은 문서는 통째로, 큰 문서는 제목만 보고 필요한 섹션만 읽게 한다.
export function docDirectives(docs,picked,{repo,warn}){
 const out=[],full=[];
 for(const d of docs){
  const file=path.join(repo,d),text=fs.readFileSync(file,'utf8'),size=Buffer.byteLength(text);
  const want=picked[d];
  if(want){
   const all=sections(text);
   const ranges=want.map(name=>{
    const hit=all.find(x=>x.title===name);
    if(!hit)fail(`context_sections: ${d}에 "${name}" 섹션이 없음 (있는 제목: ${all.map(x=>x.title).join(', ')||'없음'})`);
    return `"${name}" lines ${hit.start}-${hit.end}`;
   });
   out.push(`Read only these sections of ${d}: ${ranges.join(', ')}. Line numbers are as of this brief; if the file changed, find the headings again with grep -n '^#' ${d}. Do not read the rest of the file.`);
  }else if(size>LARGE_DOC_BYTES){
   warn(`${d}는 ${Math.round(size/1024)}KB라 통째로 읽히지 않게 했음: context_sections에 필요한 섹션을 적으면 일꾼이 찾는 수고도 줄어듦`);
   out.push(`${d} is large (${Math.round(size/1024)} KB): list its headings with grep -n '^#' ${d} and read only the sections this task needs. Never read the whole file.`);
  }else full.push(d);
 }
 if(full.length)out.unshift(`Read in full: ${full.join(', ')}.`);
 return out;
}
const str=v=>typeof v==='string'&&v.trim().length>0;

// asset_pipeline: 이미지를 asset-pipeline MCP 서버(asset_build_brief → asset_generate → asset_inspect_run)로 만들게 한다.
// 그 서버를 쓸 수 있는 일꾼은 Codex 설정(~/.codex/config.toml)에 asset_pipeline이 등록된 Luna뿐이다.
// Claude 일꾼은 hyperfusion이 mcp__*를 막고, Grok·Antigravity에는 등록되어 있지 않다.
// ComfyUI 워크플로는 모두 text-to-image라 참조 이미지 편집은 Codex·Grok CLI provider(codex_imagegen, grok_imagine)로만 된다.
// 이 provider들은 실험적이고 자동 선택되지 않으므로 workflow_id로 명시한다.
export const PIPELINE_EXECUTOR='luna';
export function pipelineDirectives(p,{repo=process.cwd(),scope=[]}={}){
 if(!p||typeof p!=='object'||Array.isArray(p))fail('asset_pipeline은 {"project_id": "..."} 형식');
 const unknown=Object.keys(p).filter(k=>!['project_id','workflow_id','reference_image'].includes(k));
 if(unknown.length)fail(`asset_pipeline에 알 수 없는 필드: ${unknown.join(', ')}`);
 if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(p.project_id??''))fail('asset_pipeline.project_id는 영문·숫자로 시작하고 영문·숫자·_-로 64자 이내');
 if(p.workflow_id!==undefined&&!/^[a-z0-9][a-z0-9_]{0,63}$/.test(p.workflow_id))fail('asset_pipeline.workflow_id는 소문자·숫자·_로 된 워크플로 ID(예: codex_imagegen, grok_imagine)');
 let ref;
 if(p.reference_image!==undefined){
  if(!str(p.reference_image)||path.isAbsolute(p.reference_image))fail('asset_pipeline.reference_image는 게임 저장소 기준 상대 경로');
  if(!p.workflow_id)fail('asset_pipeline.reference_image에는 workflow_id가 필요: 참조 편집은 codex_imagegen·grok_imagine 같은 CLI provider로만 된다');
  // 일꾼이 참조 이미지를 바꿔치기하지 못하게 범위 밖에 둔다.
  if(scope.includes(p.reference_image))fail(`asset_pipeline.reference_image(${p.reference_image})가 scope.paths에 있음: 참조는 범위 밖에 둘 것`);
  ref=path.resolve(repo,p.reference_image);
  if(!fs.existsSync(ref))fail(`asset_pipeline.reference_image가 없음: ${p.reference_image}`);
 }
 return [
  `Generate images only through the asset_pipeline MCP tools: asset_build_brief (project_id "${p.project_id}", reference images and design docs as absolute paths) → asset_route → asset_generate → asset_inspect_run. Never draw, synthesize, download or edit images by any other means.`,
  ...(p.workflow_id?[`Use workflow "${p.workflow_id}" only: pass workflow_id "${p.workflow_id}" to asset_build_brief, then set workflow_preferences {"id": "${p.workflow_id}", "allow_experimental": true} in the returned brief before asset_route and asset_generate.`]:[]),
  ...(ref?[`Edit from this reference image: pass reference_image "${ref}" to asset_build_brief. Keep the character's identity, silhouette, palette and outfit from it; change only what the objective asks.`]:[]),
  'Call asset_generate once per asset. Do not retry, change provider or workflow, or work around a BLOCKED, UNAVAILABLE or FAILED result: stop and return needs_decision with the tool status and error_code.',
  'Poll asset_inspect_run until the run leaves RUNNING, then copy the produced image to its manifest path. Only resize or convert format to meet the manifest; do not repaint it.',
  'List every run_id with its final status and review state in remaining_risks. Pipeline output stays a candidate (REVIEW_REQUIRED, game_ready=false) until a human approves it; never claim approval.'
 ];
}

export function autoAcceptance(input,kind){
 const out=[];
 const paths=input.scope.paths;
 if(kind.verify==='schema'&&input.schema){
  const files=input.data_files??paths.filter(p=>p.endsWith('.json'));
  if(!files.length)fail('schema 검사 대상 JSON이 없음: data_files를 적거나 scope.paths에 .json 파일을 넣을 것');
  const expects=Object.entries(input.expect??{}).map(([p,v])=>{
   if(!p.startsWith('/'))fail(`expect의 경로는 /로 시작해야 함: ${p}`);
   return ['--expect',`${p}=${JSON.stringify(v)}`];
  });
  out.push(['node',`${TOOLS_DIR}/validate-data.mjs`,input.schema,...files,...expects.flat()].map(quote).join(' '));
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
  // 일꾼이 띄운 서버는 수용 검사 때 이미 꺼져 있다. 서버 주소를 찍으려면 검사 도구가 직접 띄우게 serve를 적는다.
  if(s.serve!==undefined){
   if(!str(s.serve))fail('screenshot.serve는 서버를 띄우는 명령(예: "npm run dev")');
   if(!s.url)fail('screenshot.serve에는 url이 필요');
   args.push('--serve',s.serve);
  }else if(s.url&&/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?:[:/]|$)/.test(s.url))
   fail('screenshot.url이 로컬 서버인데 serve가 없음: hyperfusion은 일꾼 프로세스가 끝난 뒤 수용 검사를 돌리므로 서버를 띄우는 명령을 serve에 적을 것');
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
 let pipeline=[];
 if(input.asset_pipeline!==undefined){
  if(kind.task_kind!=='image-asset')fail(`asset_pipeline은 image-asset 작업에만 쓸 수 있음: ${input.game_kind}`);
  pipeline=pipelineDirectives(input.asset_pipeline,{repo,scope:input.scope.paths});
  warn(`asset_pipeline 작업은 asset_pipeline MCP가 등록된 Codex 일꾼만 할 수 있음: fusion-state.mjs init <저장소> <brief> --executor ${PIPELINE_EXECUTOR}`);
 }

 const role=input.role===undefined?kind.role:input.role;
 const picked=input.context_sections??{};
 if(typeof picked!=='object'||Array.isArray(picked)||!Object.values(picked).every(v=>Array.isArray(v)&&v.length&&v.every(str)))
  fail('context_sections는 {"문서 경로": ["섹션 제목", ...]} 형식');
 for(const d of Object.keys(picked))if(!fs.existsSync(path.join(repo,d)))fail(`context_sections의 문서가 없음: ${d}`);
 // 섹션을 고른 문서는 context_docs에 없어도 읽을 문서로 넣는다.
 const docs=[...new Set([...(input.context_docs??table.context_docs),...Object.keys(picked)])].filter(d=>{
  const ok=fs.existsSync(path.join(repo,d));
  if(!ok)warn(`단일 원본 문서 없음(건너뜀): ${d}`);
  return ok;
 });
 const constraints=[
  ...kind.constraints,
  ...(role?roleDirectives(role,root):[]),
  ...pipeline,
  ...(docs.length?[`Single source of truth: the design docs below override your assumptions. If they conflict with this brief, return needs_decision.`,...docDirectives(docs,picked,{repo,warn})]:[]),
  ...(input.constraints??[])
 ];

 const auto=autoAcceptance(input,kind);
 // red-first: hyperfusion은 시작 전 수용 검사가 모두 통과하면 ACCEPTANCE_ALREADY_GREEN으로 거절한다.
 // 이미 있는 파일을 고치는 작업에서 형식 검사만 있으면 처음부터 통과하므로 미리 알린다.
 if(auto.length&&!input.acceptance_commands?.length&&input.acceptance_baseline_green===undefined){
  const checked=kind.verify==='schema'&&!input.expect?(input.data_files??input.scope.paths.filter(p=>p.endsWith('.json')))
   :kind.verify==='assets'?(input.asset_files??input.scope.paths.filter(p=>p.toLowerCase().endsWith('.png'))):[];
  const existing=checked.filter(f=>fs.existsSync(path.join(repo,f)));
  if(existing.length)warn(`이미 있는 파일(${existing.join(', ')})은 형식 검사가 처음부터 통과해 hyperfusion이 ACCEPTANCE_ALREADY_GREEN으로 거절할 수 있음: `
   +(kind.verify==='schema'?'expect에 바뀔 값을 적거나 ':'')+'바뀐 내용을 확인하는 검사를 acceptance_commands에 넣을 것');
 }
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

export const defaultOut=taskId=>path.join(process.env.HFGS_BRIEF_DIR??path.join(os.tmpdir(),'hfgs-briefs'),`${taskId}.json`);

export function insideRepo(file,repo){
 const rel=path.relative(path.resolve(repo),path.resolve(file));
 return rel===''||(!rel.startsWith('..')&&!path.isAbsolute(rel));
}

async function main(){
 const args=process.argv.slice(2);
 let file,repo=process.cwd(),outFile,toStdout=false;
 for(let i=0;i<args.length;i++){
  if(args[i]==='--repo')repo=args[++i];
  else if(args[i]==='--out')outFile=args[++i];
  else if(args[i]==='--stdout')toStdout=true;
  else if(!file)file=args[i];
  else fail(`알 수 없는 인자: ${args[i]}`);
 }
 if(!file)fail('사용법: brief.mjs <게임-brief.json> [--repo DIR] [--out FILE | --stdout]');
 const input=JSON.parse(fs.readFileSync(file,'utf8'));
 const brief=compile(input,{repo,warn:m=>console.error('경고: '+m)});
 if(await checkWithHyperfusion(brief))console.error('hyperfusion brief 검증 통과');
 const text=JSON.stringify(brief,null,2)+'\n';
 if(toStdout){process.stdout.write(text);return;}
 outFile??=defaultOut(brief.task_id);
 if(insideRepo(outFile,repo))console.error(`경고: ${outFile}은 게임 저장소 안이라 추적되지 않는 파일로 남음. 저장소 밖에 쓰는 것을 권함`);
 fs.mkdirSync(path.dirname(outFile),{recursive:true});
 fs.writeFileSync(outFile,text);
 // 경로만 표준 출력으로 내보내 init에 바로 넘길 수 있게 한다: init . "$(node brief.mjs x.json --repo .)"
 console.log(outFile);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error('오류: '+e.message);process.exit(1);});
