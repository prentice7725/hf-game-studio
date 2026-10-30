#!/usr/bin/env node
// 엔진 중립 대사 JSON을 Dialogic 2 타임라인(.dtl)으로 바꾼다. 원본은 JSON이고 .dtl은 만들어지는 파일이다.
// 사용법: node tools/hfgs/dialogue-to-dtl.mjs <대사.json> [...] [--out-dir <폴더>] [--schema <스키마>] [--glossary <용어집.md>] [--check]
//   --out-dir   .dtl을 쓸 폴더(기본: 대사 파일과 같은 폴더). 파일 이름은 대사 id.dtl
//   --schema    기본 design/schemas/dialogue.schema.json
//   --glossary  기본 design/glossary.md. speaker·등장·퇴장 인물 ID가 용어집 표의 ID 열에 있어야 한다
//   --check     파일을 쓰지 않고 검사만 한다(수용 검사용). 문제가 있으면 종료 코드 1
// Dialogic 문법은 Dialogic 소스(Modules/Text/event_text.gd, Modules/Choice/event_choice.gd)를 따른다:
//   텍스트 줄의 :는 \:로 쓰고, 줄 맨 앞의 \ 하나는 읽을 때 떼어 낸다. 그래서 텍스트 줄마다 \를 붙여 join·jump·-·# 같은
//   키워드로 시작하는 대사가 다른 이벤트로 읽히지 않게 한다. [ ] { } < >는 Dialogic 효과·변수 문법이라 스키마가 막는다.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {validate} from './validate-data.mjs';

const value=v=>typeof v==='string'?JSON.stringify(v):String(v);
const condition=c=>`{${c.var}} ${c.op} ${value(c.value)}`;
const textLine=n=>'\\'+(n.speaker?`${n.speaker}${n.portrait?` (${n.portrait})`:''}: `:'')+n.text.replace(/:/g,'\\:');

// 스키마로 잡지 못하는 대사 그래프 규칙. 오류는 실패, 경고는 알리기만 한다.
export function lint(doc,{glossaryIds}={}){
 const errors=[],warnings=[];
 for(const n of doc.nodes){
  if(n.next&&n.choices)errors.push(`${n.id}: next와 choices를 함께 쓸 수 없음(선택지가 흐름을 정한다)`);
  if(n.portrait&&!n.speaker)errors.push(`${n.id}: speaker 없는 서술에는 portrait를 쓸 수 없음`);
  // Dialogic 선택지는 텍스트 이벤트 바로 뒤에 와야 한다. 퇴장은 대사 뒤에 나오므로 선택지와 함께 쓸 수 없다.
  if(n.exit?.length&&n.choices)errors.push(`${n.id}: exit와 choices를 함께 쓸 수 없음(퇴장은 다음 노드에서)`);
 }
 if(glossaryIds){
  const used=new Map();
  for(const n of doc.nodes){
   for(const c of [n.speaker,...(n.enter??[]).map(e=>e.character),...(n.exit??[])].filter(Boolean))if(!used.has(c))used.set(c,n.id);
  }
  for(const [c,at] of used)if(!glossaryIds.has(c))errors.push(`${at}: 인물 ID "${c}"가 용어집에 없음(용어집에 먼저 등록할 것)`);
 }
 const byId=new Map(doc.nodes.map(n=>[n.id,n])),seen=new Set(),queue=[doc.start];
 while(queue.length){
  const id=queue.shift();
  if(seen.has(id)||!byId.has(id))continue;
  seen.add(id);
  const n=byId.get(id);
  queue.push(...(n.choices?.map(c=>c.next)??(n.next?[n.next]:[])));
 }
 for(const n of doc.nodes)if(!seen.has(n.id))warnings.push(`${n.id}: start에서 닿지 않는 노드`);
 return {errors,warnings};
}

export function toDtl(doc,{source}={}){
 const ordered=[...doc.nodes].sort((a,b)=>(b.id===doc.start)-(a.id===doc.start));
 const out=[`# ${source??doc.id}에서 tools/hfgs/dialogue-to-dtl.mjs로 만든 파일. 직접 고치지 말고 원본 JSON을 고칠 것.`];
 for(const n of ordered){
  out.push(`label ${n.id}`);
  for(const e of n.enter??[])out.push(['join',e.character,e.portrait?`(${e.portrait})`:null,e.position??null].filter(Boolean).join(' '));
  for(const s of n.set??[])out.push(`set {${s.var}} ${s.op} ${value(s.value)}`);
  out.push(textLine(n));
  // 등장은 대사 앞, 퇴장은 대사 뒤.
  for(const c of n.exit??[])out.push(`leave ${c}`);
  if(n.choices){
   for(const c of n.choices){
    out.push(`- ${c.text}${c.if?` | [if ${condition(c.if)}]`:''}`);
    out.push(`\tjump ${c.next}`);
   }
  }else if(n.next)out.push(`jump ${n.next}`);
  else out.push('[end_timeline]');
 }
 return out.join('\n')+'\n';
}

// 용어집 마크다운 표 중 첫 열 머리가 ID인 표의 ID 값들.
export function glossaryIds(text){
 const ids=new Set();
 let inTable=false;
 for(const line of text.split(/\r?\n/)){
  const cells=line.trim().startsWith('|')?line.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim()):null;
  if(!cells){inTable=false;continue;}
  if(/^ID$/i.test(cells[0])){inTable=true;continue;}
  if(!inTable||/^:?-+:?$/.test(cells[0]))continue;
  if(cells[0])ids.add(cells[0].replace(/`/g,''));
 }
 return ids;
}

export function convert(files,{schema,glossary,outDir,check=false,read=f=>fs.readFileSync(f,'utf8'),write=(f,t)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,t);}}){
 const results=[];
 const ids=glossary===null?undefined:glossaryIds(read(glossary));
 const schemaDoc=JSON.parse(read(schema));
 for(const file of files){
  let doc;
  try{doc=JSON.parse(read(file));}catch(e){results.push({file,errors:[`JSON을 읽을 수 없음: ${e.message}`],warnings:[]});continue;}
  const errors=validate(schemaDoc,doc);
  const lintResult=errors.length?{errors:[],warnings:[]}:lint(doc,{glossaryIds:ids});
  const r={file,errors:[...errors,...lintResult.errors],warnings:lintResult.warnings};
  if(!r.errors.length){
   r.out=path.join(outDir??path.dirname(file),`${doc.id}.dtl`);
   r.text=toDtl(doc,{source:file.replaceAll('\\','/')});
   if(!check)write(r.out,r.text);
  }
  results.push(r);
 }
 return results;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const args=process.argv.slice(2),files=[];
 let schema='design/schemas/dialogue.schema.json',glossary='design/glossary.md',outDir,check=false;
 for(let i=0;i<args.length;i++){
  const a=args[i];
  if(a==='--check')check=true;
  else if(['--out-dir','--schema','--glossary'].includes(a)){
   if(args[i+1]===undefined){console.error(`${a}에 값이 없음`);process.exit(2);}
   const v=args[++i];
   if(a==='--out-dir')outDir=v;else if(a==='--schema')schema=v;else glossary=v==='none'?null:v;
  }else if(a.startsWith('--')){console.error(`알 수 없는 인자: ${a}`);process.exit(2);}
  else files.push(a);
 }
 if(!files.length){console.error('사용법: dialogue-to-dtl.mjs <대사.json> [...] [--out-dir 폴더] [--schema 파일] [--glossary 파일|none] [--check]');process.exit(2);}
 let results;
 try{results=convert(files,{schema,glossary,outDir,check});}catch(e){console.error(e.code==='ENOENT'?`파일 없음: ${e.path}`:e.message);process.exit(2);}
 let failed=false;
 for(const r of results){
  for(const w of r.warnings)console.error(`경고 ${r.file}: ${w}`);
  if(r.errors.length){failed=true;console.error(`FAIL ${r.file}\n  ${r.errors.join('\n  ')}`);}
  else console.log(check?`OK ${r.file}`:`OK ${r.file} → ${r.out}`);
 }
 process.exit(failed?1:0);
}
