#!/usr/bin/env node
// v2 작업 컨트롤러. Claude(리드)가 직접 구현하고, 전문가 모델은 consult.mjs로 읽기 전용으로 부른다.
// hyperfusion에서 남긴 장치는 둘이다: red-first(시작 전에 수용 검사가 실패하는지 확인)와
// 검사 기준 파일(스키마·매니페스트·용어집·참조 이미지)은 작업 범위 밖에 두고 바뀌지 않았는지 확인하는 것.
//
//   plan   TASK.json   작업 파일을 검증하고 읽을 문서·규칙·수용 검사 명령을 보여 준다. 상태를 바꾸지 않는다.
//   start  TASK.json   plan + red-first. 손대기 전 트리에서 수용 검사를 돌려 실패하는지 확인하고, 작업 전 상태를 기록한다.
//   check  TASK.json   수용 검사만 돌린다(작업 도중 확인용).
//   verify TASK.json   수용 검사 통과 + 범위 밖 변경 없음 + 검사 기준 파일 불변을 확인하고, 다른 계열 리뷰 명령을 알려 준다.
// 사용법: node scripts/task.mjs <plan|start|check|verify> <TASK.json> [--repo DIR] [--restart] [--json]
// 상태는 HFGS_HOME(기본 ~/.hf-game-studio)/tasks/<task_id>.json에 남는다. 게임 저장소 안에는 쓰지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runChecks,passed} from './lib/checks.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
export const STUDIO_ROOT=path.resolve(HERE,'..');
// setup.mjs가 게임 저장소에 검사 도구를 복사하는 위치. 수용 명령은 저장소 기준 상대 경로로 돈다.
export const TOOLS_DIR='tools/hfgs';
// 이보다 큰 설계 문서는 통째로 읽지 않는다. Claude Code의 Read는 한 번에 약 2.5만 토큰까지라
// 큰 문서는 읽기가 실패해 나눠 다시 읽고, 작업마다 반복되면 토큰이 크게 늘어난다(원본 템플릿 #64, #136).
export const LARGE_DOC_BYTES=40*1024;
export const homeDir=(env=process.env)=>env.HFGS_HOME??path.join(os.homedir(),'.hf-game-studio');
export const stateFile=(taskId,env=process.env)=>path.join(homeDir(env),'tasks',`${taskId}.json`);

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

// 단일 원본 문서를 어떻게 읽을지 정한다. 리드 자신과 consult.mjs write의 작가 모델이 같은 지시를 받는다.
// context_sections에 섹션을 적은 문서는 그 섹션만, 작은 문서는 통째로, 큰 문서는 제목만 보고 필요한 섹션만 읽는다.
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
   out.push(`Read only these sections of ${d}: ${ranges.join(', ')}. Line numbers are as of this plan; if the file changed, find the headings again with grep -n '^#' ${d}. Do not read the rest of the file.`);
  }else if(size>LARGE_DOC_BYTES){
   warn(`${d}는 ${Math.round(size/1024)}KB라 통째로 읽지 않게 했음: context_sections에 필요한 섹션을 적으면 찾는 수고도 줄어듦`);
   out.push(`${d} is large (${Math.round(size/1024)} KB): list its headings with grep -n '^#' ${d} and read only the sections this task needs. Never read the whole file.`);
  }else full.push(d);
 }
 if(full.length)out.unshift(`Read in full: ${full.join(', ')}.`);
 return out;
}

// asset_pipeline: 이미지·효과음은 리드가 asset-pipeline MCP 서버(asset_build_brief → asset_route → asset_generate → asset_inspect_run)로 직접 만든다.
// Claude는 그림을 그리거나 소리를 합성할 수 없으므로 다른 길은 없다. output_class는 asset-pipeline의 출력 종류이고,
// 어떤 종류를 쓸 수 있는지는 kind의 pipeline.output_classes가 정한다.
// ComfyUI 워크플로는 모두 text-to-image라 참조 이미지 편집(art-edit)은 Codex·Grok CLI provider(codex_imagegen, grok_imagine)로만 된다.
// 이 provider들은 실험적이고 자동 선택되지 않으므로 workflow_id로 명시한다.
const PIPELINE_FIELDS=['project_id','output_class','duration_seconds','workflow_id','reference_image'];
// asset_generate 직후 상태는 STARTING이고, 생성 중에는 RUNNING이다. 둘 다 끝난 상태가 아니다.
const PIPELINE_PENDING=['STARTING','RUNNING'];
export function pipelineDirectives(p,{classes=[],repo=process.cwd(),scope=[],edit=false}={}){
 if(!p||typeof p!=='object'||Array.isArray(p))fail('asset_pipeline은 {"project_id": "...", "output_class": "..."} 형식');
 const unknown=Object.keys(p).filter(k=>!PIPELINE_FIELDS.includes(k));
 if(unknown.length)fail(`asset_pipeline에 알 수 없는 필드: ${unknown.join(', ')}`);
 if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(p.project_id??''))fail('asset_pipeline.project_id는 영문·숫자로 시작하고 영문·숫자·_-로 64자 이내');
 if(!classes.includes(p.output_class))fail(`asset_pipeline.output_class는 ${classes.join(', ')} 중 하나: ${p.output_class}`);
 const sfx=p.output_class==='SFX';
 if(p.duration_seconds!==undefined){
  if(!sfx)fail('asset_pipeline.duration_seconds는 SFX에만 쓸 수 있음');
  if(typeof p.duration_seconds!=='number'||!(p.duration_seconds>0))fail('asset_pipeline.duration_seconds는 0보다 큰 초 단위 숫자');
 }
 if(p.workflow_id!==undefined&&!/^[a-z0-9][a-z0-9_]{0,63}$/.test(p.workflow_id))fail('asset_pipeline.workflow_id는 소문자·숫자·_로 된 워크플로 ID(예: codex_imagegen, grok_imagine)');
 if(edit&&!p.reference_image)fail('art-edit 작업은 asset_pipeline.reference_image(고칠 원본)가 필요함');
 let ref;
 if(p.reference_image!==undefined){
  if(sfx)fail('asset_pipeline.reference_image는 이미지 작업에만 쓸 수 있음');
  if(!str(p.reference_image)||path.isAbsolute(p.reference_image))fail('asset_pipeline.reference_image는 게임 저장소 기준 상대 경로');
  if(!p.workflow_id)fail('asset_pipeline.reference_image에는 workflow_id가 필요: 참조 편집은 codex_imagegen·grok_imagine 같은 CLI provider로만 된다');
  // 참조 이미지는 검사 기준이다. 범위 밖에 두고 verify에서 바뀌지 않았는지 본다.
  if(scope.includes(p.reference_image))fail(`asset_pipeline.reference_image(${p.reference_image})가 scope.paths에 있음: 참조는 범위 밖에 둘 것`);
  ref=path.resolve(repo,p.reference_image);
  if(!fs.existsSync(ref))fail(`asset_pipeline.reference_image가 없음: ${p.reference_image}`);
 }
 const args=[`project_id "${p.project_id}"`,`requested_output_type "${p.output_class}"`,
  ...(p.duration_seconds!==undefined?[`duration_seconds ${p.duration_seconds}`]:[]),
  'reference images and design docs as absolute paths'];
 const noun=sfx?'sound effects':'images';
 return [
  `Generate ${noun} only through the asset_pipeline MCP tools: asset_build_brief (${args.join(', ')}) → asset_route → asset_generate → asset_inspect_run. Never ${sfx?'synthesize, record, download or edit audio':'draw, synthesize, download or edit images'} by any other means.`,
  ...(p.workflow_id?[`Use workflow "${p.workflow_id}" only: pass workflow_id "${p.workflow_id}" to asset_build_brief, then set workflow_preferences {"id": "${p.workflow_id}", "allow_experimental": true} in the returned brief before asset_route and asset_generate.`]:[]),
  ...(ref?[`Edit from this reference image: pass reference_image "${ref}" to asset_build_brief. Keep the character's identity, silhouette, palette and outfit from it; change only what the objective asks.`]:[]),
  'Call asset_generate once per asset. On a BLOCKED, UNAVAILABLE or FAILED result do not retry, change provider or work around it: stop and ask the user, quoting the tool status and error_code.',
  `Poll asset_inspect_run until its status is no longer ${PIPELINE_PENDING.join(' or ')} before doing anything else; a run left pending never completes. Then copy the produced ${sfx?'PCM WAV':'image'} to its manifest path. Only ${sfx?'convert format':'resize or convert format'} to meet the manifest; do not ${sfx?'re-edit':'repaint'} it.`,
  'Record every run_id with its final status and review state in the task note. Pipeline output stays a candidate (REVIEW_REQUIRED, game_ready=false) until the user has looked at or listened to it and approved it.'
 ];
}

// 매니페스트 검사 대상: asset_files가 없으면 scope.paths 중 검사 도구가 읽을 수 있는 PNG·WAV.
const assetFiles=input=>input.asset_files??input.scope.paths.filter(p=>/\.(png|wav)$/i.test(p));
const jsonFiles=input=>input.data_files??input.scope.paths.filter(p=>p.endsWith('.json'));

export function autoAcceptance(input,kind){
 const out=[];
 if(kind.verify==='schema'&&input.schema){
  const files=jsonFiles(input);
  if(!files.length)fail('schema 검사 대상 JSON이 없음: data_files를 적거나 scope.paths에 .json 파일을 넣을 것');
  const expects=Object.entries(input.expect??{}).map(([p,v])=>{
   if(!p.startsWith('/'))fail(`expect의 경로는 /로 시작해야 함: ${p}`);
   return ['--expect',`${p}=${JSON.stringify(v)}`];
  });
  out.push(['node',`${TOOLS_DIR}/validate-data.mjs`,input.schema,...files,...expects.flat()].map(quote).join(' '));
 }
 // 대사: 스키마 검사가 아니라 변환기의 --check를 돌린다. 스키마·그래프 규칙·용어집 인물 ID·Dialogic 변환까지 한 번에 본다.
 if(kind.verify==='dialogue'&&input.schema){
  const files=jsonFiles(input);
  if(!files.length)fail('대사 검사 대상 JSON이 없음: data_files를 적거나 scope.paths에 .json 파일을 넣을 것');
  if(input.expect!==undefined)fail('expect는 schema 검사 작업(balance-data 등)에만 쓸 수 있음: 대사는 dialogue-to-dtl.mjs --check로 검사한다');
  out.push(['node',`${TOOLS_DIR}/dialogue-to-dtl.mjs`,...files,'--schema',input.schema,...(input.glossary?['--glossary',input.glossary]:[]),'--check'].map(quote).join(' '));
 }
 if(kind.verify==='assets'&&input.assets_manifest){
  const files=assetFiles(input);
  out.push(['node',`${TOOLS_DIR}/check-assets.mjs`,input.assets_manifest,...files.flatMap(f=>['--only',f])].map(quote).join(' '));
 }
 if(kind.verify==='screenshot'&&input.screenshot){
  const s=input.screenshot,args=['node',`${TOOLS_DIR}/screenshot.mjs`];
  const target=['url','file','electron'].filter(k=>s[k]!==undefined);
  if(target.length!==1)fail('screenshot에는 url, file, electron 중 하나만 적을 것');
  if(!str(s.selector))fail('screenshot.selector 필요');
  // 검사는 서버가 떠 있는 동안이 아니라 아무 때나 돌 수 있어야 한다. 서버 주소를 찍으려면 검사 도구가 직접 띄우고 끄게 serve를 적는다.
  if(s.serve!==undefined){
   if(!str(s.serve))fail('screenshot.serve는 서버를 띄우는 명령(예: "npm run dev")');
   if(!s.url)fail('screenshot.serve에는 url이 필요');
   args.push('--serve',s.serve);
  }else if(s.url&&/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?:[:/]|$)/.test(s.url))
   fail('screenshot.url이 로컬 서버인데 serve가 없음: 검사 도구가 서버를 띄우고 끄도록 서버 실행 명령을 serve에 적을 것');
  args.push(`--${target[0]}`,s[target[0]],'--selector',s.selector);
  if(s.expect_text)args.push('--expect-text',s.expect_text);
  args.push('--name',s.name??input.task_id);
  out.push(args.map(quote).join(' '));
 }
 return out;
}

// 검사 기준 파일. 작업 범위 밖에 있어야 하고 verify에서 바뀌지 않았어야 한다.
export function criteriaFiles(input,kind){
 const files=[input.schema,input.assets_manifest,input.asset_pipeline?.reference_image];
 if(kind.verify==='dialogue')files.push(input.glossary??'design/glossary.md');
 return [...new Set(files.filter(Boolean))];
}

// baselineWarning: red-first 경고는 시작 전(plan·start)에만 뜻이 있다. check·verify는 끈다.
export function plan(input,{repo=process.cwd(),root=STUDIO_ROOT,warn=()=>{},baselineWarning=true}={}){
 const table=loadKinds(root);
 if(!input||typeof input!=='object')fail('작업 파일이 객체가 아님');
 const kind=table.kinds[input.kind];
 if(!kind)fail(`알 수 없는 kind: ${input.kind} (가능: ${Object.keys(table.kinds).join(', ')})`);
 if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(input.task_id??''))fail('task_id는 영문·숫자·_-로 80자 이내');
 if(!str(input.objective))fail('objective 필요');
 if(!Array.isArray(input.scope?.paths)||!input.scope.paths.length)fail('scope.paths 필요');
 if(!Array.isArray(input.success_criteria)||!input.success_criteria.length)fail('success_criteria 필요');
 const noId=input.success_criteria.find(c=>!/^AC\d+:/.test(c));
 if(noId)fail(`수용 기준은 "AC1: ..."처럼 ID로 시작해야 함: ${noId}`);
 for(const k of kind.require??[])if(!str(input[k]))fail(`${input.kind} 작업에는 ${k}가 필요함`);
 let pipeline=[];
 if(input.asset_pipeline!==undefined){
  if(!kind.pipeline){
   const ok=Object.entries(table.kinds).filter(([,k])=>k.pipeline).map(([n])=>n);
   fail(`asset_pipeline은 ${ok.join('·')} 작업에만 쓸 수 있음: ${input.kind}`);
  }
  pipeline=pipelineDirectives(input.asset_pipeline,{classes:kind.pipeline.output_classes,repo,scope:input.scope.paths,edit:kind.pipeline.edit===true});
  // asset-pipeline의 PIXEL_STATIC은 자동 후처리가 투명화뿐이라, 색 수가 한도(기본 32)를 넘는 생성물은 Pixel Gate에서 FAILED가 된다.
  if(input.asset_pipeline.output_class==='PIXEL_STATIC')
   warn('PIXEL_STATIC은 asset-pipeline이 색을 자동으로 줄이지 않아 Pixel Gate에서 FAILED로 끝나기 쉬움: 실패하면 멈추고 사용자와 상의');
 }else if(kind.pipeline?.required)fail(`${input.kind} 작업은 asset_pipeline이 필요함: Claude는 ${kind.pipeline.output_classes.includes('SFX')?'소리를 합성':'그림을 그릴'} 수 없어 asset-pipeline MCP로만 만든다`);
 // 검사 기준 파일을 작업 범위에 넣으면 기준을 느슨하게 고쳐 통과시킬 수 있다. 새 인물·새 규격은 사용자와 상의해 따로 고친다.
 const criteria=criteriaFiles(input,kind);
 const inScope=criteria.filter(f=>input.scope.paths.includes(f));
 if(inScope.length)fail(`검사 기준 파일(${inScope.join(', ')})이 scope.paths에 있음: 기준은 범위 밖에 두고 바꾸지 않은 채 작업할 것`);

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
 const reading=docs.length?docDirectives(docs,picked,{repo,warn}):[];
 const rules=[...(kind.rules??[]),...(role?roleDirectives(role,root):[]),...pipeline,...(input.rules??[])];

 const auto=autoAcceptance(input,kind);
 // red-first: start는 손대기 전 트리에서 수용 검사가 모두 통과하면 거절한다(맞는 결과와 엉터리 결과를 가르지 못하는 검사).
 // 이미 있는 파일을 형식 검사만으로 고치는 작업은 처음부터 통과하므로 미리 알린다.
 if(baselineWarning&&auto.length&&!input.acceptance_commands?.length&&input.baseline_green===undefined){
  const checked=(kind.verify==='schema'&&!input.expect)||kind.verify==='dialogue'?jsonFiles(input):kind.verify==='assets'?assetFiles(input):[];
  const existing=checked.filter(f=>fs.existsSync(path.join(repo,f)));
  if(existing.length)warn(`이미 있는 파일(${existing.join(', ')})은 형식 검사가 처음부터 통과해 start가 ACCEPTANCE_ALREADY_GREEN으로 거절할 수 있음: `
   +(kind.verify==='schema'?'expect에 바뀔 값을 적거나 ':'')+'바뀐 내용을 확인하는 검사를 acceptance_commands에 넣을 것');
 }
 const commands=[...new Set([...(input.acceptance_commands??[]),...auto])];
 if(commands.length>10)fail('acceptance_commands는 10개까지');
 if(!commands.length)warn('수용 명령이 없음: verify가 기계적으로 확인할 것이 없다. 가능하면 schema·assets_manifest·screenshot이나 테스트 명령을 적을 것');

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

 // 글은 작가 모델(Gemini Argon)이 쓴다. consult.mjs write에 바로 넘길 수 있는 brief를 함께 만든다.
 let write;
 if(kind.writer){
  const json=kind.verify==='dialogue';
  write={task:input.objective,kind:input.kind,language:input.language??'ko',format:json?'json':'markdown',
   ...(json?{structure:`Follow the JSON schema at ${input.schema} exactly; characters must be glossary IDs.`}:{}),
   ...(role?{style:roleDirectives(role,root).join(' ')}:{}),
   context_docs:docs,...(Object.keys(picked).length?{context_sections:picked}:{})};
 }
 return {task_id:input.task_id,kind:input.kind,owner:kind.owner??'claude',...(kind.writer?{writer:kind.writer}:{}),objective:input.objective,
  scope:input.scope.paths,allow_out_of_scope:input.allow_out_of_scope??[],success_criteria:input.success_criteria,criteria_files:criteria,
  reading,rules,acceptance_commands:commands,...(map?{acceptance_map:map}:{}),...(write?{write_brief:write}:{})};
}

// ── 작업 전후 비교 ──
function gitOut(repo,args){
 const r=spawnSync('git',['-C',repo,...args],{encoding:'utf8',maxBuffer:64*1024*1024,windowsHide:true});
 if(r.status!==0)fail(`git ${args.join(' ')} 실패: ${String(r.stderr).trim()}`);
 return r.stdout;
}
// 작업 트리에서 HEAD와 다른 경로(수정·추가·삭제·추적되지 않은 파일). -z로 받아 한글 이름도 그대로 쓴다.
export function dirtyPaths(repo,{git=gitOut}={}){
 const parts=git(repo,['status','--porcelain=v1','-uall','-z']).split('\0').filter(Boolean),out=[];
 for(let i=0;i<parts.length;i++){
  const entry=parts[i];
  out.push(entry.slice(3));
  // 이름 바꾸기·복사는 다음 토큰이 원래 이름이다.
  if(/^[RC]/.test(entry))i++;
 }
 return out;
}
export function hashFiles(repo,paths){
 return Object.fromEntries(paths.map(p=>{
  const file=path.join(repo,p);
  if(!fs.existsSync(file)||fs.statSync(file).isDirectory())return [p,null];
  return [p,crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')];
 }));
}
const head=(repo,git)=>git(repo,['rev-parse','HEAD']).trim();

function readState(taskId,env){
 const file=stateFile(taskId,env);
 return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
}
function writeState(state,env){
 const file=stateFile(state.task_id,env);
 fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n');
 return file;
}

// start: red-first와 작업 전 기록. 손대기 전 트리에서 수용 검사를 돌려 적어도 하나는 실패해야 한다.
// 모두 통과하면 그 검사는 맞는 결과와 엉터리 결과를 가르지 못하므로 거절한다(baseline_green에 이유를 적으면 예외).
export function start(input,{repo=process.cwd(),root=STUDIO_ROOT,warn=()=>{},restart=false,env=process.env,checks=runChecks,git=gitOut}={}){
 const p=plan(input,{repo,root,warn});
 const old=readState(p.task_id,env);
 if(old&&!old.verify?.ok&&!restart)fail(`이미 시작한 작업: ${stateFile(p.task_id,env)}. 이어서 하려면 check·verify를, 처음부터 다시 하려면 --restart`);
 if(old?.verify?.ok&&!restart)fail(`이미 끝난 작업(verify 통과): ${stateFile(p.task_id,env)}. 다시 열려면 --restart`);
 const dirty=dirtyPaths(repo,{git});
 if(dirty.length)warn(`작업 전에 바뀐 파일 ${dirty.length}개가 있음(내용을 기록해 두고 verify에서 더 바뀌었는지만 봄): ${dirty.slice(0,5).join(', ')}${dirty.length>5?' ...':''}`);
 const baseline=checks(repo,p.acceptance_commands);
 const red=baseline.filter(r=>!passed(r)).map(r=>r.command);
 if(p.acceptance_commands.length&&!red.length){
  if(!str(input.baseline_green))fail('ACCEPTANCE_ALREADY_GREEN: 수용 검사가 손대기 전에 모두 통과함. 바뀔 내용을 확인하는 검사(expect, 테스트)를 넣거나, 처음부터 통과하는 게 맞으면(리팩터 등) baseline_green에 이유를 적을 것');
  warn(`수용 검사가 처음부터 통과함(baseline_green: ${input.baseline_green}). verify는 검사 기준 파일 불변과 범위만 본다`);
 }
 const green=baseline.filter(passed).map(r=>r.command);
 if(red.length&&green.length)warn(`처음부터 통과하는 검사 ${green.length}개는 작업 결과를 가르지 못함: ${green.join(' ; ')}`);
 const state={task_id:p.task_id,kind:p.kind,repo:path.resolve(repo),started_at:new Date().toISOString(),head:head(repo,git),
  baseline:{red,green,results:baseline,...(str(input.baseline_green)?{green_reason:input.baseline_green}:{})},
  dirty_before:hashFiles(repo,dirty),criteria_before:hashFiles(repo,p.criteria_files),plan:p};
 return {plan:p,state,file:writeState(state,env)};
}

export function check(input,{repo=process.cwd(),root=STUDIO_ROOT,warn=()=>{},checks=runChecks}={}){
 const p=plan(input,{repo,root,warn,baselineWarning:false});
 const results=checks(repo,p.acceptance_commands);
 return {plan:p,results,ok:results.every(passed)};
}

// 수용 기준별 판정. 명령이 걸린 기준은 그 명령이 모두 통과해야 pass, 걸리지 않은 기준은 리드와 리뷰어가 직접 본다(manual).
export function acTable(p,results){
 const status=new Map(results.map(r=>[r.command,passed(r)]));
 return p.success_criteria.map(c=>{
  const id=/^AC\d+/.exec(c)[0],cmds=p.acceptance_map?.[id];
  return {id,criterion:c,status:!cmds?'manual':cmds.every(x=>status.get(x))?'pass':'fail'};
 });
}

// 다른 계열 리뷰 명령. 리뷰어는 작성자의 주장 없이 diff와 이 검사 결과만 본다.
export function reviewCommand(p,state,{repo,studio=STUDIO_ROOT}={}){
 const args=['node',path.join(studio,'scripts','consult.mjs'),'review','--repo',repo,'--base',state.head,
  ...p.success_criteria.flatMap(c=>['--criteria',c]),...p.acceptance_commands.flatMap(c=>['--check',c])];
 return args.map(quote).join(' ');
}

export function verify(input,{repo=process.cwd(),root=STUDIO_ROOT,warn=()=>{},env=process.env,checks=runChecks,git=gitOut}={}){
 const p=plan(input,{repo,root,warn,baselineWarning:false});
 const state=readState(p.task_id,env);
 if(!state)fail(`시작 기록이 없음: 먼저 task.mjs start로 red-first 기준선을 남길 것 (${stateFile(p.task_id,env)})`);
 if(path.resolve(repo)!==state.repo)fail(`시작한 저장소(${state.repo})와 다름: ${path.resolve(repo)}`);
 const results=checks(repo,p.acceptance_commands);
 const failed=results.filter(r=>!passed(r)).map(r=>r.command);
 const errors=[];
 // 검사 기준 파일이 바뀌었으면 검사 통과는 의미가 없다.
 const criteriaNow=hashFiles(repo,p.criteria_files);
 const criteriaChanged=p.criteria_files.filter(f=>criteriaNow[f]!==(state.criteria_before[f]??null));
 if(criteriaChanged.length)errors.push(`검사 기준 파일이 바뀜: ${criteriaChanged.join(', ')} (되돌리고, 기준을 고쳐야 하면 별도 작업으로)`);
 // 범위: 작업 전부터 바뀌어 있던 파일은 내용이 더 바뀌었을 때만 이 작업의 변경으로 본다.
 const now=dirtyPaths(repo,{git}),nowHash=hashFiles(repo,now);
 const changed=now.filter(f=>!(f in state.dirty_before)||state.dirty_before[f]!==nowHash[f]);
 const allowed=[...p.scope,...p.allow_out_of_scope];
 const outOfScope=changed.filter(f=>!allowed.includes(f));
 if(outOfScope.length)errors.push(`범위 밖 변경: ${outOfScope.join(', ')} (scope.paths에 넣을 것이면 작업 파일을 고치고, 아니면 되돌릴 것)`);
 const ac=acTable(p,results);
 const ok=!failed.length&&!errors.length;
 const review=reviewCommand(p,state,{repo:path.resolve(repo)});
 state.verify={at:new Date().toISOString(),ok,failed,errors,changed,ac,review_command:review};
 writeState(state,env);
 return {plan:p,results,ac,failed,errors,changed,ok,review_command:review};
}

// ── CLI ──
function printPlan(p){
 console.log(`작업 ${p.task_id} (${p.kind}, 담당: ${p.owner}${p.writer?`, 글: ${p.writer}`:''})`);
 console.log(`목표: ${p.objective}`);
 console.log(`범위: ${p.scope.join(', ')}`);
 if(p.criteria_files.length)console.log(`검사 기준(바꾸지 않을 것): ${p.criteria_files.join(', ')}`);
 if(p.reading.length){console.log('읽기:');for(const r of p.reading)console.log('  - '+r);}
 if(p.rules.length){console.log('규칙:');for(const r of p.rules)console.log('  - '+r);}
 console.log('수용 기준:');for(const c of p.success_criteria)console.log('  - '+c);
 console.log(p.acceptance_commands.length?'수용 검사:':'수용 검사: (없음)');for(const c of p.acceptance_commands)console.log('  $ '+c);
 if(p.write_brief)console.log(`작가 brief(consult.mjs write에 넘길 것):\n${JSON.stringify(p.write_brief,null,2)}`);
}
function printResults(results){
 for(const r of results)console.log(`  ${passed(r)?'OK  ':'FAIL'} ${r.command}${passed(r)?'':`\n       ${r.output_tail.split('\n').slice(-3).join('\n       ')}`}`);
}

function parseArgs(args){
 const o={_:[]};
 for(let i=0;i<args.length;i++){
  const a=args[i];
  if(a==='--repo'){o.repo=args[++i];if(o.repo===undefined)fail('--repo에 값이 필요함');}
  else if(a==='--restart')o.restart=true;
  else if(a==='--json')o.json=true;
  else if(a.startsWith('--'))fail(`알 수 없는 인자: ${a}`);
  else o._.push(a);
 }
 return o;
}

function main(){
 const [cmd,file]=process.argv.slice(2),a=parseArgs(process.argv.slice(4));
 if(!['plan','start','check','verify'].includes(cmd)||!file)fail('사용법: task.mjs <plan|start|check|verify> <TASK.json> [--repo DIR] [--restart] [--json]');
 const repo=path.resolve(a.repo??process.cwd()),input=JSON.parse(fs.readFileSync(file,'utf8')),warn=m=>console.error('경고: '+m);
 if(cmd==='plan'){
  const p=plan(input,{repo,warn});
  if(a.json)console.log(JSON.stringify(p,null,2));else printPlan(p);
  return 0;
 }
 if(cmd==='start'){
  const {plan:p,state,file:f}=start(input,{repo,warn,restart:a.restart});
  if(a.json){console.log(JSON.stringify({plan:p,state},null,2));return 0;}
  printPlan(p);
  console.log(`\nred-first: 손대기 전 트리에서 ${state.baseline.red.length}개 실패, ${state.baseline.green.length}개 통과 (기록: ${f})`);
  console.log('다음: 담당이 claude면 직접 구현하고, argon이면 위 작가 brief로 consult.mjs write를 돌린 뒤 결과를 범위 안 파일로 쓸 것. 끝나면 task.mjs verify.');
  return 0;
 }
 if(cmd==='check'){
  const {results,ok}=check(input,{repo,warn});
  console.log('수용 검사:');printResults(results);
  return ok?0:1;
 }
 const r=verify(input,{repo,warn});
 if(a.json){console.log(JSON.stringify(r,null,2));return r.ok?0:1;}
 console.log('수용 검사:');printResults(r.results);
 console.log('수용 기준:');for(const x of r.ac)console.log(`  ${x.status==='pass'?'PASS  ':x.status==='fail'?'FAIL  ':'직접 확인'} ${x.criterion}`);
 console.log(`변경 파일: ${r.changed.length?r.changed.join(', '):'(없음)'}`);
 for(const e of r.errors)console.log('FAIL '+e);
 if(r.ok){
  console.log('\nverify 통과. 다음은 다른 계열 리뷰(직접 확인 항목은 리뷰어에게도 보인다):');
  console.log('  $ '+r.review_command);
 }else console.log('\nverify 실패. 위 항목을 고친 뒤 다시 verify.');
 return r.ok?0:1;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{process.exit(main());}catch(e){console.error('오류: '+e.message);process.exit(2);}
}
