#!/usr/bin/env node
// 게임 데이터 JSON을 스키마로 검사한다. hyperfusion의 acceptance_commands에 넣어 컨트롤러가 직접 돌리는 용도다.
// 사용법: node tools/hfgs/validate-data.mjs <스키마.json> <데이터.json> [데이터.json ...]
// 의존성 없이 돌도록 JSON Schema의 일부만 구현한다:
//   type, enum, const, required, properties, additionalProperties(불리언), items, minItems, maxItems,
//   minimum, maximum, minLength, maxLength, pattern, $ref(#/$defs/...)
// 게임 데이터용 확장 키워드:
//   x-uniqueBy: "id"          배열 원소의 해당 필드 값이 겹치면 안 된다
//   x-ref: "/nodes/*/id"      문자열 값이 데이터 문서의 그 경로(*는 배열·객체 전체) 값 중 하나여야 한다
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

const typeOf=v=>v===null?'null':Array.isArray(v)?'array':Number.isInteger(v)?'integer':typeof v;
const isType=(v,t)=>t==='number'?typeof v==='number'&&Number.isFinite(v):t==='integer'?Number.isInteger(v):typeOf(v)===t;

// "/a/*/b" 형식의 경로로 문서에서 값들을 모은다.
export function collect(doc,pointer){
 let cur=[doc];
 for(const part of pointer.split('/').filter(Boolean)){
  const next=[];
  for(const v of cur){
   if(v===null||typeof v!=='object')continue;
   if(part==='*')next.push(...Object.values(v));
   else if(Object.hasOwn(v,part))next.push(v[part]);
  }
  cur=next;
 }
 return cur;
}

function resolveRef(root,ref){
 if(!ref.startsWith('#/'))throw Error(`지원하지 않는 $ref: ${ref}`);
 const [v]=collect(root,ref.slice(1));
 if(v===undefined)throw Error(`$ref를 찾을 수 없음: ${ref}`);
 return v;
}

export function validate(schema,data){
 const errors=[];
 const walk=(s,v,at)=>{
  if(s.$ref)s=resolveRef(schema,s.$ref);
  if(s.type!==undefined){
   const types=[s.type].flat();
   if(!types.some(t=>isType(v,t))){errors.push(`${at}: ${types.join('|')} 이어야 하는데 ${typeOf(v)}`);return;}
  }
  if(s.enum&&!s.enum.some(x=>JSON.stringify(x)===JSON.stringify(v)))errors.push(`${at}: 허용 값(${s.enum.join(', ')})이 아님: ${JSON.stringify(v)}`);
  if(s.const!==undefined&&JSON.stringify(s.const)!==JSON.stringify(v))errors.push(`${at}: ${JSON.stringify(s.const)} 이어야 함`);
  if(typeof v==='number'){
   if(s.minimum!==undefined&&v<s.minimum)errors.push(`${at}: ${v} < 최솟값 ${s.minimum}`);
   if(s.maximum!==undefined&&v>s.maximum)errors.push(`${at}: ${v} > 최댓값 ${s.maximum}`);
  }
  if(typeof v==='string'){
   if(s.minLength!==undefined&&v.length<s.minLength)errors.push(`${at}: 길이 ${v.length} < ${s.minLength}`);
   if(s.maxLength!==undefined&&v.length>s.maxLength)errors.push(`${at}: 길이 ${v.length} > ${s.maxLength}`);
   if(s.pattern!==undefined&&!new RegExp(s.pattern,'u').test(v))errors.push(`${at}: 패턴 ${s.pattern}과 맞지 않음: ${JSON.stringify(v)}`);
   if(s['x-ref']!==undefined&&!collect(data,s['x-ref']).includes(v))errors.push(`${at}: ${JSON.stringify(v)}는 ${s['x-ref']}에 없는 값`);
  }
  if(Array.isArray(v)){
   if(s.minItems!==undefined&&v.length<s.minItems)errors.push(`${at}: 원소 ${v.length}개 < ${s.minItems}`);
   if(s.maxItems!==undefined&&v.length>s.maxItems)errors.push(`${at}: 원소 ${v.length}개 > ${s.maxItems}`);
   if(s.items)v.forEach((x,i)=>walk(s.items,x,`${at}[${i}]`));
   if(s['x-uniqueBy']){
    const key=s['x-uniqueBy'],seen=new Set();
    for(const x of v){
     const k=x?.[key];
     if(k===undefined)continue;
     if(seen.has(k))errors.push(`${at}: ${key} 중복: ${JSON.stringify(k)}`);
     seen.add(k);
    }
   }
  }
  if(v&&typeof v==='object'&&!Array.isArray(v)){
   for(const k of s.required??[])if(!Object.hasOwn(v,k))errors.push(`${at}: 필수 필드 없음: ${k}`);
   for(const [k,x] of Object.entries(v)){
    if(s.properties&&Object.hasOwn(s.properties,k))walk(s.properties[k],x,`${at}.${k}`);
    else if(s.additionalProperties===false)errors.push(`${at}: 정의되지 않은 필드: ${k}`);
   }
  }
 };
 walk(schema,data,'$');
 return errors;
}

function readJson(file){
 try{return JSON.parse(fs.readFileSync(file,'utf8'));}
 catch(e){throw Error(e.code==='ENOENT'?`파일 없음: ${file}`:`JSON을 읽을 수 없음: ${file}: ${e.message}`);}
}

if(import.meta.url===pathToFileURL(process.argv[1]).href){
 const [schemaFile,...files]=process.argv.slice(2);
 if(!schemaFile||!files.length){console.error('사용법: validate-data.mjs <스키마.json> <데이터.json> [...]');process.exit(2);}
 let failed=false;
 try{
  const schema=readJson(schemaFile);
  for(const f of files){
   let errors;
   try{errors=validate(schema,readJson(f));}catch(e){errors=[e.message];}
   if(errors.length){failed=true;console.error(`FAIL ${f}`);for(const e of errors.slice(0,50))console.error('  '+e);if(errors.length>50)console.error(`  ... 외 ${errors.length-50}건`);}
   else console.log(`OK ${f}`);
  }
 }catch(e){console.error(e.message);process.exit(2);}
 process.exit(failed?1:0);
}
