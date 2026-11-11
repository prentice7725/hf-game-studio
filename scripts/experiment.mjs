#!/usr/bin/env node
// v3 P0: 실험 카드와 조사 노트의 검사(lint). 설계는 docs/design/game-studio-v3.md.
// 무엇을 만들지는 리드가 스킬(gs-inspect, gs-research, gs-experiment) 절차대로 판단하고,
// 이 스크립트는 그 결과가 갖출 것을 갖췄는지만 기계로 본다: 반증 조건, 측정, GDD에 건 자리, 범위, 예산.
//
//   lint <EXP-*.json | RQ-*.json> [--repo DIR] [--json]
// 종류는 파일의 id(EXP-NNN, RQ-NNN)로 가른다.
// 종료 코드: 0 통과, 1 카드·노트가 규칙에 맞지 않음, 2 검사를 돌릴 수 없음(파일 없음, JSON 아님, 사용법).
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {STUDIO_ROOT,sections,slashPath} from './task.mjs';
import {checkEntry} from './lib/checks.mjs';
import {validate} from '../tools/validate-data.mjs';

export const EXPERIMENTS_DIR='design/experiments';
export const RESEARCH_DIR='design/research';
// 실험이 고치면 안 되는 곳. 카드와 조사 노트는 그 실험의 검사 기준이고, 나머지는 v2의 검사 기준 파일이다.
export const CRITERIA_PATHS=[EXPERIMENTS_DIR,RESEARCH_DIR,'design/schemas','design/glossary.md','design/asset-manifest.json'];
// 칸은 싼 순서다. 위 칸의 카드는 아래 칸을 거쳤거나 건너뛴 이유가 있어야 한다.
export const RUNGS=['sim','prototype','godot'];
// 그 칸에서 답이 나왔다고 볼 수 있는 측정 종류.
const RUNG_MEASURES={sim:['sim'],prototype:['telemetry','human'],godot:['scenario','human']};
// 수용 검사 명령으로 판정하는 측정.
const CHECKED=['sim','telemetry','scenario'];
export const MAX_HUMAN_MEASURES=3;

const readSchema=name=>JSON.parse(fs.readFileSync(path.join(STUDIO_ROOT,'schemas',name),'utf8'));
// 한쪽이 다른 쪽의 폴더이거나 같은 경로면 겹친다.
const norm=p=>slashPath(p).replace(/\/+$/,'');
export function overlaps(a,b){
 a=norm(a);b=norm(b);
 return a===b||a.startsWith(b+'/')||b.startsWith(a+'/');
}
const sameText=(a,b)=>a.replace(/\s+/g,' ').trim()===b.replace(/\s+/g,' ').trim();

function readJson(file){
 try{return JSON.parse(fs.readFileSync(file,'utf8'));}
 catch(e){throw Error(e.code==='ENOENT'?`파일 없음: ${file}`:`JSON을 읽을 수 없음: ${file}: ${e.message}`);}
}
// 폴더 안의 <PREFIX>-NNN*.json을 id별로 읽는다. 읽을 수 없는 파일은 건너뛰고 알린다.
function loadDir(repo,dir,prefix,warn){
 const full=path.join(repo,dir),out=new Map();
 if(!fs.existsSync(full))return out;
 for(const name of fs.readdirSync(full).filter(n=>n.startsWith(prefix+'-')&&n.endsWith('.json')).sort()){
  try{
   const doc=JSON.parse(fs.readFileSync(path.join(full,name),'utf8'));
   if(typeof doc?.id==='string')out.set(doc.id,{file:`${dir}/${name}`,doc});
  }catch(e){warn(`${dir}/${name}을 읽을 수 없어 건너뜀: ${e.message}`);}
 }
 return out;
}

export function lintExperiment(card,{repo=process.cwd(),file,warn=()=>{}}={}){
 const errors=validate(readSchema('experiment.schema.json'),card);
 // 형식이 틀리면 아래 규칙은 뜻이 없다.
 if(errors.length)return errors;
 const err=m=>errors.push(m);
 if(file&&!path.basename(file).startsWith(card.id+'-')&&path.basename(file)!==card.id+'.json')err(`파일 이름이 id로 시작하지 않음: ${path.basename(file)} (예: ${card.id}-<slug>.json)`);

 // GDD에 건 자리. 걸 곳이 없는 실험은 게임의 정체성을 넓히는 것이라 실험이 아니라 GDD 작업(사용자 결정)이다.
 const anchors=Object.entries(card.sot_anchor);
 if(!anchors.length)err('sot_anchor가 비어 있음: 이 질문이 걸린 설계 문서 섹션을 적을 것({"design/gdd.md": ["기둥(pillars)"]})');
 for(const [doc,names] of anchors){
  if(!Array.isArray(names)||!names.length||!names.every(n=>typeof n==='string'&&n.trim())){err(`sot_anchor["${doc}"]는 섹션 제목 배열`);continue;}
  const full=path.join(repo,doc);
  if(!fs.existsSync(full)){err(`sot_anchor의 문서가 없음: ${doc}`);continue;}
  const have=sections(fs.readFileSync(full,'utf8')).map(s=>s.title);
  for(const n of names)if(!have.includes(n))err(`sot_anchor: ${doc}에 "${n}" 섹션이 없음 (있는 제목: ${have.join(', ')||'없음'})`);
 }

 // 조사 노트를 가리켰으면 그 finding이 실제로 있어야 한다. 조사는 선택 입력이라 없어도 된다.
 if(card.research_refs?.length){
  const notes=loadDir(repo,RESEARCH_DIR,'RQ',warn);
  for(const ref of card.research_refs){
   const [rq,f]=ref.split(':'),note=notes.get(rq);
   if(!note)err(`research_refs: ${rq} 조사 노트가 ${RESEARCH_DIR}/에 없음`);
   else if(!note.doc.findings?.some(x=>x.id===f))err(`research_refs: ${note.file}에 ${f}가 없음`);
  }
 }

 // 측정: 검사로 판정하는 것은 명령이, 사람에게 묻는 것은 질문이 있어야 한다.
 for(const m of card.measures){
  if(CHECKED.includes(m.type)){
   if(m.check===undefined)err(`${m.id}(${m.type})에 check(수용 검사 명령)가 없음`);
   else try{checkEntry(m.check);}catch(e){err(`${m.id}.check: ${e.message}`);}
   if(!m.what)err(`${m.id}(${m.type})에 what(무엇이 얼마여야 하는지)이 없음`);
   if(m.ask!==undefined)err(`${m.id}(${m.type})에는 ask를 쓰지 않음(사람 측정 전용)`);
  }else{
   if(!m.ask)err(`${m.id}(human)에 ask(사용자에게 물을 질문)가 없음`);
   if(m.check!==undefined)err(`${m.id}(human)에는 check를 쓰지 않음: 답은 사용자가 준다`);
  }
 }
 const types=card.measures.map(m=>m.type),humans=types.filter(t=>t==='human').length;
 if(humans>MAX_HUMAN_MEASURES)err(`사람 측정이 ${humans}개: 실험당 ${MAX_HUMAN_MEASURES}개까지(사용자의 시간이 가장 비싸다)`);

 // 칸과 측정의 짝. 시뮬레이션 칸은 기계가 답하는 칸이라 사람·기록 측정을 섞지 않는다.
 if(!types.some(t=>RUNG_MEASURES[card.rung].includes(t)))err(`rung "${card.rung}"에는 ${RUNG_MEASURES[card.rung].join('·')} 측정이 하나는 있어야 함`);
 if(card.rung==='sim'){
  const extra=[...new Set(types.filter(t=>t!=='sim'))];
  if(extra.length)err(`rung "sim"에 ${extra.join('·')} 측정이 있음: 화면이나 사람이 필요하면 prototype 칸의 카드로`);
 }
 if(card.rung!=='godot'&&types.includes('scenario'))err('scenario 측정(godot-playtest)은 godot 칸에서만');

 // 아래 칸을 거쳤나: 이 카드에 그 칸의 측정이 있거나, 그 칸에서 supported로 닫힌 카드 위에 서 있거나, 건너뛴 이유가 있어야 한다.
 const cards=loadDir(repo,EXPERIMENTS_DIR,'EXP',warn),below=RUNGS.slice(0,RUNGS.indexOf(card.rung));
 for(const id of card.builds_on??[]){
  if(id===card.id)err('builds_on에 자기 자신이 있음');
  else if(!cards.has(id))err(`builds_on: ${id} 카드가 ${EXPERIMENTS_DIR}/에 없음`);
  else if(cards.get(id).doc.verdict?.result!=='supported')err(`builds_on: ${id}는 supported로 닫힌 카드가 아님(${cards.get(id).doc.verdict?.result??'판정 없음'})`);
 }
 for(const r of Object.keys(card.skipped_rungs??{}))if(!below.includes(r))err(`skipped_rungs.${r}: ${card.rung} 칸의 아래 칸이 아님`);
 for(const r of below){
  const here=types.some(t=>RUNG_MEASURES[r].includes(t)&&!(r==='prototype'&&t==='human'&&card.rung==='godot'));
  const built=(card.builds_on??[]).some(id=>cards.get(id)?.doc.rung===r&&cards.get(id).doc.verdict?.result==='supported');
  if(!here&&!built&&!card.skipped_rungs?.[r])err(`${r} 칸을 건너뜀: ${RUNG_MEASURES[r][0]} 측정을 넣거나, ${r} 칸에서 supported로 닫힌 카드를 builds_on에 적거나, skipped_rungs.${r}에 이유를 적을 것`);
 }

 // 범위: 검사 기준과 불변 항목은 실험이 고칠 수 없다.
 for(const p of card.scope.paths){
  if(path.isAbsolute(p)||norm(p).split('/').includes('..'))err(`scope.paths는 게임 저장소 기준 상대 경로: ${p}`);
  const hit=CRITERIA_PATHS.find(c=>overlaps(p,c));
  if(hit)err(`scope.paths의 ${p}가 검사 기준(${hit})과 겹침: 기준은 실험 범위 밖에 둘 것`);
  for(const d of Object.keys(card.sot_anchor))if(overlaps(p,d))err(`scope.paths의 ${p}가 sot_anchor 문서(${d})와 겹침: 설계 문서 반영은 실험을 닫은 뒤 별도 gdd 작업으로`);
 }
 // 불변 항목 중 저장소에 있는 경로는 범위와 겹치면 안 된다. 나머지는 문장이라 리드와 리뷰어가 본다.
 for(const inv of card.invariants??[]){
  if(!fs.existsSync(path.join(repo,inv)))continue;
  const hit=card.scope.paths.find(p=>overlaps(p,inv));
  if(hit)err(`invariants의 ${inv}가 scope.paths(${hit})와 겹침`);
 }

 // 판정이 붙었으면 측정마다 결과가 있어야 한다.
 if(card.verdict){
  const ids=card.measures.map(m=>m.id);
  for(const id of ids)if(typeof card.verdict.measures[id]!=='string'||!card.verdict.measures[id].trim())err(`verdict.measures에 ${id}의 결과가 없음`);
  for(const id of Object.keys(card.verdict.measures))if(!ids.includes(id))err(`verdict.measures의 ${id}는 measures에 없는 측정`);
 }

 // 같은 가설이 이미 기각됐으면 알린다(막지는 않는다: 조건이 달라졌을 수 있다).
 for(const [id,{file:f,doc}] of cards){
  if(id!==card.id&&doc.verdict?.result==='refuted'&&typeof doc.hypothesis==='string'&&sameText(doc.hypothesis,card.hypothesis))
   warn(`같은 가설이 ${f}에서 이미 기각됨: 무엇이 달라졌는지 origin에 적을 것`);
 }
 return errors;
}

export function lintResearch(note,{file,warn=()=>{}}={}){
 const errors=validate(readSchema('research.schema.json'),note);
 if(errors.length)return errors;
 if(file&&!path.basename(file).startsWith(note.id+'-')&&path.basename(file)!==note.id+'.json')errors.push(`파일 이름이 id로 시작하지 않음: ${path.basename(file)}`);
 const refs=new Map(note.refs.map(r=>[r.id,r]));
 for(const f of note.findings){
  for(const r of f.refs)if(!refs.has(r))errors.push(`${f.id}: ${r}가 refs에 없음`);
  // 출처 없이 적은 것은 리드의 추론이다. 패턴이라고 부르지 않는다.
  if(!f.refs.length&&f.kind!=='open')errors.push(`${f.id}: 출처가 없는 finding은 kind "open"(리드의 추론)으로 적을 것`);
 }
 const used=new Set(note.findings.flatMap(f=>f.refs));
 for(const id of refs.keys())if(!used.has(id))warn(`${id}를 쓰는 finding이 없음`);
 // 영상은 자막이나 프레임을 실제로 읽었을 때만 본 것이다.
 for(const r of note.refs)if(r.source_type==='video'&&r.evidence_kind==='observed')warn(`${r.id}: 영상을 observed로 적음. 자막이나 프레임을 실제로 읽었을 때만`);
 return errors;
}

export function lint(file,{repo=process.cwd(),warn=()=>{}}={}){
 const doc=readJson(file),id=doc?.id;
 if(typeof id==='string'&&id.startsWith('RQ-'))return {kind:'research',id,errors:lintResearch(doc,{file,warn})};
 if(typeof id==='string'&&id.startsWith('EXP-'))return {kind:'experiment',id,errors:lintExperiment(doc,{repo,file,warn})};
 throw Error(`실험 카드(id: EXP-NNN)도 조사 노트(id: RQ-NNN)도 아님: ${file}`);
}

function main(){
 const [cmd,file,...rest]=process.argv.slice(2);
 let repo=process.cwd(),json=false;
 for(let i=0;i<rest.length;i++){
  if(rest[i]==='--repo'){repo=rest[++i];if(repo===undefined)throw Error('--repo에 값이 필요함');}
  else if(rest[i]==='--json')json=true;
  else throw Error(`알 수 없는 인자: ${rest[i]}`);
 }
 if(cmd!=='lint'||!file)throw Error('사용법: experiment.mjs lint <EXP-*.json | RQ-*.json> [--repo DIR] [--json]');
 const warnings=[],r=lint(path.resolve(file),{repo:path.resolve(repo),warn:m=>warnings.push(m)});
 if(json)console.log(JSON.stringify({...r,warnings,ok:!r.errors.length},null,2));
 else{
  for(const w of warnings)console.error('경고: '+w);
  for(const e of r.errors)console.log('FAIL '+e);
  console.log(r.errors.length?`\n${r.id}: ${r.errors.length}건을 고친 뒤 다시 lint.`:`${r.id}: lint 통과.${r.kind==='experiment'?' 사용자에게 카드를 보이고 승인을 받을 것.':''}`);
 }
 return r.errors.length?1:0;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{process.exit(main());}catch(e){console.error('오류: '+e.message);process.exit(2);}
}
