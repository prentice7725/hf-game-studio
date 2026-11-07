// 수용 검사 명령을 직접 돌린다. task.mjs(start·check·verify)와 consult.mjs(리뷰어에게 검사 결과 전달)가 같이 쓴다.
// 리뷰어와 리드는 "테스트 통과" 주장 대신 이 결과를 본다.
// 명령은 셸 없이 돈다. Windows의 셸(cmd.exe)은 큰따옴표 안의 \"를 모르고 %이름%을 확장해서, 글자 값을 기대하는
// --expect "/p=\"A&B\"" 같은 인자가 쪼개지거나 바뀌었다(마일스톤 3 리뷰). 셸 문법(파이프, 리다이렉트, 글롭 등)이
// 따옴표 밖에 있는 명령만 예전처럼 셸로 돌린다.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {resolveExecutable} from './platform.mjs';

// node·npm·npx는 지금 도는 node와 그 곁의 npm으로 돌린다. Windows의 npm.cmd는 진입점을 변수로 고르는 배치 파일이라 래퍼를 풀 수 없다.
function bundled(name){
 if(name==='node')return {executable:process.execPath,prefix_args:[]};
 if(name!=='npm'&&name!=='npx')return null;
 const dir=path.dirname(process.execPath);
 const cli=[path.join(dir,'node_modules','npm','bin',`${name}-cli.js`),path.join(dir,'..','lib','node_modules','npm','bin',`${name}-cli.js`)].find(f=>fs.existsSync(f));
 return cli?{executable:process.execPath,prefix_args:[cli]}:null;
}

// 수용 검사 하나는 명령 문자열이거나 인자 배열이다. task.mjs가 만드는 자동 검사는 배열이라 따옴표를 거치지 않고 그대로 돈다
// (예전에는 문자열로 굳혔다가 아래 splitCommand로 다시 쪼개, 그 왕복에서 따옴표 버그가 났다: 마일스톤 1·3, PR #25).
// 사람이 쓰는 acceptance_commands도 배열로 적을 수 있다(node -e 한 줄짜리를 이스케이프 없이 쓰려면 배열이 낫다).
export function checkEntry(e){
 if(typeof e==='string'&&e.trim())return e;
 if(Array.isArray(e)&&e.length&&e.every(a=>typeof a==='string')&&e[0])return e;
 throw Error(`수용 검사는 명령 문자열이나 비지 않은 문자열 배열: ${JSON.stringify(e)}`);
}

// 표시용 인자. 그냥 써도 되는 글자만이면 그대로, 아니면 큰따옴표로만 감싼다. 큰따옴표·역슬래시·$·백틱 앞에만 \를 붙여
// splitCommand가 같은 인자로 되돌린다. JSON.stringify로 감싸면 Windows 경로의 역슬래시가 두 번 이스케이프된다(마일스톤 1 실측).
export const quote=s=>/^[\w./:@=-]+$/.test(s)?s:`"${s.replace(/["\\$`]/g,'\\$&')}"`;

// 검사의 이름이자 표시. 결과의 command, acceptance_map, 수용 기준 판정이 모두 이 문자열로 검사를 가리킨다.
export const displayCheck=e=>Array.isArray(e)?e.map(quote).join(' '):e;

// 따옴표 밖에 있으면 셸이 필요한 글자. 역슬래시는 Windows 경로라 그대로 둔다.
const SHELL_CHARS=/[|&;<>()$`*?~!{}[\]^%\n]/;
const ASSIGN=/^[A-Za-z_][A-Za-z0-9_]*=/;

// 명령 문자열을 인자 배열로 나눈다. 따옴표 규칙은 bash와 같다: "..." 안에서는 \" \\ \$ \`만 이스케이프이고, '...'는 글자 그대로다.
// 앞에 오는 NAME=값은 환경변수로 뗀다. 셸이 필요한 명령이면 null.
export function splitCommand(command){
 const args=[];let cur=null,i=0;
 const s=String(command); // trim하지 않는다: 끝의 "\ "나 앞뒤 줄바꿈도 셸 전환 조건이다
 while(i<s.length){
  const ch=s[i];
  // 따옴표 밖 줄바꿈은 명령 구분자다(셸로 돌려 마지막 실패를 잃지 않는다).
  if(ch==='\n'||ch==='\r')return null;
  if(/\s/.test(ch)){if(cur!==null){args.push(cur);cur=null;}i++;continue;}
  if(ch==='"'){
   cur??='';i++;
   for(;;){
    if(i>=s.length)return null; // 닫히지 않은 따옴표
    const c=s[i];
    if(c==='"'){i++;break;}
    if(c==='\\'&&i+1<s.length&&'"\\$`'.includes(s[i+1])){cur+=s[i+1];i+=2;continue;}
    // 큰따옴표 안에서도 bash는 $와 백틱을 확장한다("$HOME", "`date`"). 그런 명령은 셸로 돌린다.
    if(c==='$'||c==='`')return null;
    cur+=c;i++;
   }
   continue;
  }
  if(ch==="'"){
   const end=s.indexOf("'",i+1);
   if(end<0)return null;
   cur=(cur??'')+s.slice(i+1,end);i=end+1;continue;
  }
  if(SHELL_CHARS.test(ch)||(ch==='#'&&cur===null))return null;
  // 따옴표 밖 역슬래시는 Windows 경로(C:\tools)로 보고 그대로 둔다. 공백·따옴표 앞이면 bash 이스케이프(a\ b, say\"hi\")라 셸로 돌린다.
  if(ch==='\\'&&/[\s"']/.test(s[i+1]??''))return null;
  cur=(cur??'')+ch;i++;
 }
 if(cur!==null)args.push(cur);
 const env={};
 // 같은 이름을 다시 지정하면 지웠다 다시 넣어 객체 순서를 지정 순서와 맞춘다(mergeEnv가 차례로 얹어 마지막 값이 이긴다).
 while(args.length&&ASSIGN.test(args[0])){const a=args.shift(),k=a.indexOf('='),name=a.slice(0,k);delete env[name];env[name]=a.slice(k+1);}
 return args.length?{env,argv:args}:null;
}

// 앞에 붙인 환경변수를 물려받은 환경에 얹는다. Windows의 이름은 대소문자를 가리지 않으므로 같은 이름(Path·path 등)의
// 기존 키를 지우고 새 값 하나만 남긴다(둘이 같이 있으면 어느 쪽이 쓰일지 정해지지 않는다). PATH는 키를 PATH로 맞춘다.
export function mergeEnv(env,given,{windows=process.platform==='win32'}={}){
 if(!windows)return {...env,...given};
 const out={...env};
 for(const [k,v] of Object.entries(given)){
  for(const old of Object.keys(out))if(old.toUpperCase()===k.toUpperCase())delete out[old];
  out[k.toUpperCase()==='PATH'?'PATH':k]=v;
 }
 return out;
}

export function runChecks(repo,commands,{spawn=spawnSync,timeoutMs=10*60*1000,env=process.env}={}){
 const opts={cwd:repo,encoding:'utf8',timeout:timeoutMs,maxBuffer:64*1024*1024,windowsHide:true};
 return commands.map(entry=>{
  const command=displayCheck(entry),argvForm=Array.isArray(entry);
  const split=argvForm?{env:{},argv:entry}:splitCommand(entry);
  let r,shell=false,exe=null;
  if(split){
   const [name,...rest]=split.argv;
   // 앞에 붙인 환경변수(PATH 포함)는 실행 파일 찾기에도 쓰고, 경로로 적은 실행 파일은 게임 저장소 기준으로 찾는다.
   const runEnv=mergeEnv(env,split.env);
   // 상대 PATH 항목(물려받은 것이든 앞에 붙인 것이든)은 자식 프로세스처럼 게임 저장소 기준으로 찾는다.
   const pathKey=Object.hasOwn(runEnv,'PATH')?'PATH':Object.keys(runEnv).find(k=>k.toUpperCase()==='PATH');
   // 찾기용 환경은 키를 PATH 하나로 맞춘다(resolveExecutable은 PATH·Path만 읽는데 Windows에서는 path 등도 같은 변수다).
   const lookupEnv=pathKey?{...Object.fromEntries(Object.entries(runEnv).filter(([k])=>k.toUpperCase()!=='PATH')),PATH:String(runEnv[pathKey]).split(path.delimiter).map(d=>path.resolve(repo,d)).join(path.delimiter)}:runEnv; // 빈 항목은 현재 폴더(=저장소)
   const target=/[\\/]/.test(name)?path.resolve(repo,name):name;
   // 실행 파일이 없으면(셸 내장 명령 echo·dir 등, 진입점을 못 찾는 배치 래퍼) 예전처럼 셸로 돌린다.
   try{exe=bundled(name)??resolveExecutable(name,target,{env:lookupEnv});}catch{}
   if(exe)r=spawn(exe.executable,[...exe.prefix_args,...rest],{...opts,env:runEnv,shell:false});
   // 배열로 적은 검사는 셸로 돌리지 않는다(셸이 인자를 다시 해석하면 배열로 적은 뜻이 없다).
   else if(argvForm)r={status:null,stdout:'',stderr:'',error:Error(`실행 파일을 찾지 못함: ${name}`)};
  }
  if(!r){
   shell=true;
   r=spawn(entry,{...opts,env,shell:true});
  }
  const out=`${r.stdout??''}${r.stderr?'\n'+r.stderr:''}${r.error&&r.error.code!=='ETIMEDOUT'?'\n'+r.error.message:''}`.trim();
  return {command,shell,exit_code:r.error?.code==='ETIMEDOUT'?'timeout':r.status,output_tail:out.slice(-2000)};
 });
}
export const passed=r=>r.exit_code===0;
// exit 코드 규칙: 0 통과, 1 결과가 틀림(작업이 만들 파일이 아직 없는 것 포함), 그 밖(2, 시간 초과, 실행 파일 없음, 셸의 127 등)은
// 검사를 돌릴 수 없음. 고장 난 검사는 작업 결과와 상관없이 실패하므로 red-first의 실패로 치지 않는다.
export const broken=r=>r.exit_code!==0&&r.exit_code!==1;
