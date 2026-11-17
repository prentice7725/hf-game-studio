#!/usr/bin/env node
// 구조 검사. "규칙은 순수 함수에, 화면은 그리기만"을 기계가 확인한다. task.mjs의 정적 검사(static_commands)로 돈다.
// 사용법: node tools/hfgs/check-structure.mjs <design/structure.json> [--root DIR]
// 설정의 층(layer)마다 files에 맞는 파일을 읽어
//   forbid_imports   TypeScript·JavaScript의 import·export from·import()·require가 가져오는 것. 패키지 이름(phaser)은 그 이름과
//                    하위 경로(phaser/...)에, 경로 패턴(prototype/src/scenes/**)은 상대 경로를 파일 위치에서 풀어 저장소 경로로 바꾼 것에 맞는다
//   forbid_patterns  줄 단위 정규식(언어를 가리지 않음). 주석만 있는 줄(//, #로 시작)은 건너뛰고, in_comments가 true면 주석 줄도 본다
// 에 걸리는 줄을 "파일:줄: [층] 이유"로 출력한다. 종료 코드: 0 통과, 1 위반 있음, 2 검사를 돌릴 수 없음(설정 없음·형식 오류·정규식 오류).
// 정규식 검사라 우회할 수 있다(const r=Math; r.random()). 실수를 잡는 장치이지 속임수를 막는 장치가 아니다.
// 의존성 없이 Node 표준 모듈만 쓴다. ESLint는 템플릿에 의존성이 붙고 Godot 쪽에 같은 도구가 없어 쓰지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const SKIP_DIRS=new Set(['node_modules','.git','.godot','dist','build']);
const SCRIPT_EXT=/\.(?:[cm]?[jt]sx?)$/;
const RESOLVE_EXT=['.ts','.tsx','.mts','.cts','.js','.jsx','.mjs','.cjs'];
const LAYER_FIELDS=['name','files','exclude','forbid_imports','forbid_patterns'];
const PATTERN_FIELDS=['pattern','why','in_comments'];

function bad(m){throw Object.assign(Error(m),{broken:true});}
const strList=v=>Array.isArray(v)&&v.every(s=>typeof s==='string'&&s.trim());

// 글롭을 정규식으로. **는 폴더 여러 단계(0단계 포함), *와 ?는 한 단계 안. 경로는 슬래시로 통일한다.
export function globRegex(glob){
 let re='';
 for(let i=0;i<glob.length;i++){
  const c=glob[i];
  if(c==='*'&&glob[i+1]==='*'){
   i++;
   if(glob[i+1]==='/'){i++;re+='(?:.*/)?';}else re+='.*';
  }else if(c==='*')re+='[^/]*';
  else if(c==='?')re+='[^/]';
  else re+=c.replace(/[.+^${}()|[\]\\]/g,'\\$&');
 }
 return new RegExp(`^${re}$`);
}
export const matchGlob=(glob,file)=>globRegex(glob).test(file);

// 설정 검사. 틀리면 종료 코드 2로 끝나게 broken 오류를 던진다.
export function parseConfig(config){
 if(!config||typeof config!=='object'||Array.isArray(config))bad('설정이 객체가 아님');
 if(config.version!==1)bad(`version은 1이어야 함: ${config.version}`);
 if(!Array.isArray(config.layers)||!config.layers.length)bad('layers 필요(층 하나 이상)');
 return config.layers.map((l,i)=>{
  if(!l||typeof l!=='object')bad(`layers[${i}]이 객체가 아님`);
  const unknown=Object.keys(l).filter(k=>!LAYER_FIELDS.includes(k));
  if(unknown.length)bad(`layers[${i}]에 알 수 없는 필드: ${unknown.join(', ')}`);
  if(typeof l.name!=='string'||!l.name.trim())bad(`layers[${i}].name 필요`);
  if(!strList(l.files)||!l.files.length)bad(`${l.name}: files는 비지 않은 경로 패턴 배열`);
  for(const k of ['exclude','forbid_imports'])if(l[k]!==undefined&&!strList(l[k]))bad(`${l.name}: ${k}는 문자열 배열`);
  if(l.forbid_patterns!==undefined&&!Array.isArray(l.forbid_patterns))bad(`${l.name}: forbid_patterns는 배열`);
  if(!l.forbid_imports?.length&&!l.forbid_patterns?.length)bad(`${l.name}: forbid_imports나 forbid_patterns 중 하나는 있어야 함`);
  const patterns=(l.forbid_patterns??[]).map((p,j)=>{
   if(!p||typeof p!=='object')bad(`${l.name}: forbid_patterns[${j}]이 객체가 아님`);
   const extra=Object.keys(p).filter(k=>!PATTERN_FIELDS.includes(k));
   if(extra.length)bad(`${l.name}: forbid_patterns[${j}]에 알 수 없는 필드: ${extra.join(', ')}`);
   if(typeof p.pattern!=='string'||!p.pattern)bad(`${l.name}: forbid_patterns[${j}].pattern 필요`);
   if(typeof p.why!=='string'||!p.why.trim())bad(`${l.name}: forbid_patterns[${j}].why 필요(위반 때 보여 줄 이유)`);
   if(p.in_comments!==undefined&&typeof p.in_comments!=='boolean')bad(`${l.name}: forbid_patterns[${j}].in_comments는 true나 false`);
   let re;
   try{re=new RegExp(p.pattern);}catch(e){bad(`${l.name}: 정규식 오류 ${p.pattern}: ${e.message}`);}
   return {re,source:p.pattern,why:p.why,inComments:p.in_comments===true};
  });
  return {name:l.name,files:l.files,exclude:l.exclude??[],imports:l.forbid_imports??[],patterns};
 });
}

// 패턴에서 글롭 문자 앞까지의 폴더. 저장소 전체를 걷지 않고 그 폴더만 걷는다.
const globBase=glob=>{
 const parts=glob.split('/'),fixed=[];
 for(const p of parts.slice(0,-1)){if(/[*?]/.test(p))break;fixed.push(p);}
 return fixed.join('/');
};
function walk(root,rel,out){
 const dir=path.join(root,rel);
 if(!fs.existsSync(dir))return;
 if(!fs.statSync(dir).isDirectory()){out.add(rel);return;}
 for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  const r=rel?`${rel}/${e.name}`:e.name;
  if(e.isDirectory()){if(!SKIP_DIRS.has(e.name))walk(root,r,out);}
  else if(e.isFile())out.add(r);
 }
}
export function layerFiles(root,layer){
 const all=new Set();
 for(const g of layer.files)walk(root,globBase(g),all);
 return [...all].filter(f=>layer.files.some(g=>matchGlob(g,f))&&!layer.exclude.some(g=>matchGlob(g,f))).sort();
}

// import가 가져오는 것과 그 줄 번호. 여러 줄 import({\n a,\n b\n} from 'x')도 잡도록 파일 전체에서 찾는다.
const IMPORT_RES=[
 /\bimport\s+(?:[\w*{}\s,$]+?\s+from\s*)?['"]([^'"\n]+)['"]/g,
 /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
 /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*['"]([^'"\n]+)['"]/g,
 /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g
];
const commentLine=l=>/^\s*(?:\/\/|#|\/\*|\*)/.test(l);
export function findImports(text){
 const lines=text.split(/\r?\n/),starts=[];
 let pos=0;for(const l of lines){starts.push(pos);pos+=l.length+1;}
 const lineAt=i=>{let lo=0,hi=starts.length-1;while(lo<hi){const m=(lo+hi+1)>>1;if(starts[m]<=i)lo=m;else hi=m-1;}return lo;};
 const out=[],seen=new Set();
 // \r\n을 \n으로 바꿔 줄 시작 위치가 맞게 한다.
 const flat=lines.join('\n');
 for(const re of IMPORT_RES){
  for(const m of flat.matchAll(re)){
   const n=lineAt(m.index);
   if(commentLine(lines[n]))continue; // 주석으로 막아 둔 import
   const key=`${n}:${m[1]}`;
   if(seen.has(key))continue;
   seen.add(key);out.push({line:n+1,spec:m[1]});
  }
 }
 return out.sort((a,b)=>a.line-b.line);
}

// 상대 경로 import를 저장소 경로로 푼다. 확장자를 뺀 import(../scenes/Board)도 패턴과 맞도록 붙일 후보를 함께 낸다.
function importTargets(file,spec){
 if(!spec.startsWith('.'))return null;
 const p=path.posix.normalize(path.posix.join(path.posix.dirname(file),spec));
 return [p,...RESOLVE_EXT.map(e=>p+e),...RESOLVE_EXT.map(e=>`${p}/index${e}`)];
}
export function importForbidden(file,spec,rules){
 const targets=importTargets(file,spec);
 return rules.find(rule=>targets
  ?targets.some(t=>t===rule||matchGlob(rule,t))
  :spec===rule||spec.startsWith(rule+'/')||(/[*?]/.test(rule)&&matchGlob(rule,spec)));
}

export function checkFile(root,file,layer){
 const text=fs.readFileSync(path.join(root,file),'utf8'),found=[];
 if(layer.imports.length&&SCRIPT_EXT.test(file)){
  for(const {line,spec} of findImports(text)){
   const rule=importForbidden(file,spec,layer.imports);
   if(rule)found.push({file,line,layer:layer.name,why:`'${spec}'를 가져옴(금지: ${rule})`});
  }
 }
 text.split(/\r?\n/).forEach((l,i)=>{
  const comment=/^\s*(?:\/\/|#)/.test(l);
  for(const p of layer.patterns){
   if(comment&&!p.inComments)continue;
   if(p.re.test(l))found.push({file,line:i+1,layer:layer.name,why:`${p.why} (/${p.source}/)`});
  }
 });
 return found;
}

// 설정 객체로 저장소를 검사한다. 파일이 하나도 없는 층은 통과로 치고 경고만 낸다(아직 그 폴더를 만들지 않은 저장소).
export function checkStructure(root,config){
 const layers=parseConfig(config),violations=[],warnings=[];
 for(const layer of layers){
  const files=layerFiles(root,layer);
  if(!files.length){warnings.push(`${layer.name}: files(${layer.files.join(', ')})에 맞는 파일이 없음`);continue;}
  for(const f of files)violations.push(...checkFile(root,f,layer));
 }
 violations.sort((a,b)=>a.file.localeCompare(b.file)||a.line-b.line);
 return {violations,warnings};
}

function main(argv){
 const args=[...argv];let root=process.cwd();
 const r=args.indexOf('--root');
 if(r>=0){root=args[r+1];if(!root)bad('--root에 값이 필요함');args.splice(r,2);}
 const unknown=args.find(a=>a.startsWith('--'));
 if(unknown)bad(`알 수 없는 인자: ${unknown}`);
 if(args.length!==1)bad('사용법: check-structure.mjs <design/structure.json> [--root DIR]');
 const file=path.resolve(root,args[0]);
 if(!fs.existsSync(file))bad(`설정 파일 없음: ${args[0]}`);
 let config;
 try{config=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){bad(`설정 JSON 오류(${args[0]}): ${e.message}`);}
 const {violations,warnings}=checkStructure(path.resolve(root),config);
 for(const w of warnings)console.error(`경고: ${w}`);
 for(const v of violations)console.log(`${v.file}:${v.line}: [${v.layer}] ${v.why}`);
 console.log(violations.length?`구조 위반 ${violations.length}건`:'구조 검사 통과');
 return violations.length?1:0;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(fs.realpathSync(process.argv[1])).href){
 try{process.exit(main(process.argv.slice(2)));}
 catch(e){console.error(`오류: ${e.message}`);process.exit(2);}
}
