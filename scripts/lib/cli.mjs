// 외부 모델 CLI(Codex, Antigravity, Grok)를 읽기 전용 전문가로 부르는 공통 부분.
// 출처: hyperfusion scripts/adapters/common.mjs (MIT). v2의 전문가는 파일을 고치지 않고 결과를 JSON으로만 돌려주므로
// 구현 라운드·리스·재개(resume)는 빼고 플래그 확인, 결과 JSON 꺼내기, 읽기 전용 지시문, 실행만 옮겼다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {resolveExecutable} from './platform.mjs';
import {cliEnv} from './env.mjs';
import {redactText} from './redaction.mjs';

export function hasOption(help,option){
 const escaped=option.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 return new RegExp(`(^|[^\\w-])${escaped}(?![\\w-])`,'m').test(help);
}

// 실행 파일과 필수 플래그를 확인한다. 인증은 실제 호출에서만 드러난다.
// optionalFlags는 있으면 쓰고 없어도 통과하는 플래그로, 결과의 supports에 기록된다.
// help는 도움말을 여는 인자. 하위 명령의 플래그를 봐야 하는 CLI(codex exec)는 따로 준다.
export function probe(name,binary,requiredFlags,optionalFlags=[],{help:helpArgs=['--help'],auth=[],spawn=spawnSync}={}){
 const {executable,prefix_args}=resolveExecutable(name,binary);
 const shown=prefix_args.at(-1)??executable;
 // 도움말을 stderr로 내거나 0이 아닌 코드로 끝내는 CLI도 있어 두 스트림을 합쳐 본다.
 const run=(...flag)=>{
  const r=spawn(executable,[...prefix_args,...flag],{encoding:'utf8',timeout:15000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe'],windowsHide:true,env:cliEnv(auth)});
  if(r.error)throw Error(`CLI_UNAVAILABLE: ${name} ${flag.join(' ')} 실패 (${shown}): ${r.error.code==='ETIMEDOUT'?'시간 초과(TTY가 필요한 CLI일 수 있음)':r.error.message}`);
  return `${r.stdout??''}\n${r.stderr??''}`;
 };
 const version=run('--version').trim().split(/\r?\n/)[0];
 const help=run(...helpArgs);
 const missing=requiredFlags.filter(f=>!hasOption(help,f));
 // 어떤 파일이 잡혔고 무엇을 출력했는지 남겨야 엉뚱한 실행 파일(IDE 실행기 등)을 알아챌 수 있다.
 if(missing.length)throw Error(`CLI_UNAVAILABLE: ${name}에 필요한 플래그 없음: ${missing.join(', ')} (${shown}, 버전 "${version}")`);
 return {executable,prefix_args,version,supports:Object.fromEntries(optionalFlags.map(f=>[f,hasOption(help,f)]))};
}

// 스키마 강제가 없는 CLI는 최종 텍스트에서 결과 JSON을 꺼낸다. 본문 전체, 마지막 ```json 블록,
// 또는 텍스트 끝에서 끝나는 JSON 객체만 인정한다.
export function extractResult(text){
 if(typeof text!=='string'||!text.trim())throw Error('최종 응답이 비어 있음');
 try{return JSON.parse(text.trim());}catch{}
 const blocks=[...text.matchAll(/```json\s*\n([\s\S]*?)```/g)];
 if(blocks.length){try{return JSON.parse(blocks.at(-1)[1]);}catch{throw Error('결과 JSON 형식이 깨짐');}}
 // Grok은 중간 설명과 최종 JSON을 구분 없이 이어 붙여 낼 때가 있다("...untouched.{"task_id":...}").
 // 텍스트 끝에서 끝나는 가장 바깥 JSON 객체만 받는다. 설명만 있는 답은 계속 거절한다.
 const tail=trailingObject(text);
 if(tail===undefined)throw Error('최종 응답에 결과 JSON이 없음');
 return tail;
}
function trailingObject(text){
 const s=text.trimEnd();
 if(!s.endsWith('}'))return undefined;
 for(let start=s.indexOf('{');start!==-1;start=s.indexOf('{',start+1)){
  if(objectEnd(s,start)!==s.length-1)continue;
  try{const v=JSON.parse(s.slice(start));if(v&&typeof v==='object'&&!Array.isArray(v))return v;}catch{}
 }
 return undefined;
}
// start의 '{'와 짝이 맞는 '}' 위치. 문자열 안의 괄호와 이스케이프는 건너뛴다.
function objectEnd(s,start){
 let depth=0,inString=false;
 for(let i=start;i<s.length;i++){
  const ch=s[i];
  if(inString){if(ch==='\\')i++;else if(ch==='"')inString=false;continue;}
  if(ch==='"')inString=true;
  else if(ch==='{')depth++;
  else if(ch==='}'&&--depth===0)return i;
 }
 return -1;
}

// 쓰기 금지를 "셸 금지"로 읽은 Codex 리뷰어가 파일을 하나도 열지 못한 일이 있었다. Codex에는 셸 말고 읽기 도구가 없으므로
// Codex에게만 읽기 전용 셸 명령을 허용한다고 적는다. 쓰기는 각 CLI의 read-only 샌드박스·plan 모드와 deny 규칙이 막는다.
// Antigravity는 헤드리스에서 허용 목록 밖의 셸 명령이 자동 거부되고, 한 번이라도 거부되면 결과 없이 끝나므로 셸 문장을 주지 않는다.
const READ_ONLY_BASE='This is a READ-ONLY consultation. Do not create, edit, move or delete any file. Do not run builds, tests, installers, formatters or any command that writes to disk. Do not call any MCP tool or external service. Put everything you produce in your final JSON answer.';
const READ_SHELL='If your only way to read files is a shell, you MAY run read-only commands such as cat, type, head, tail, sed -n, ls, dir, find, rg, grep, wc, git diff, git show, git log, git status and git ls-files. Never redirect their output into a file.';
const READ_TOOLS='Read files only with your file view tools. Run no shell commands at all (not even git diff, cat or ls): headless mode auto-denies them and one denied command ends this run with no result.';
const READ_GENERIC='Read files with your file read tools only.';
export const SECRET_ORDER='Never read .env, .env.* or secrets/**, including nested copies or through shell/search tools.';
export function readOnlyOrders(reader){
 return [READ_ONLY_BASE,reader==='shell'?READ_SHELL:reader==='tools'?READ_TOOLS:READ_GENERIC,SECRET_ORDER];
}
export const SECRET_READ_PATHS=['./.env','./.env.*','**/.env','**/.env.*','./secrets/**','**/secrets/**'];

// 전문가 하나를 부른다. adapter는 adapters/*.mjs의 객체다.
// prompt는 보내기 전에 비밀값을 가린다. schema는 결과 JSON의 모양이다.
// 반환: {result, session_id, usage, redacted}. 실패하면 CLI 출력에서 원인을 알아본 문구를 붙여 던진다.
export function invoke(adapter,{repo,prompt,schema,options={},timeoutMs=20*60*1000,spawn=spawnSync,probed}={}){
 const counts={},masked=redactText(prompt,counts);
 const cli=probed??adapter.probe(options);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-cli-'));
 try{
  const request=adapter.command({repo,prompt:masked,schema,options,cli,dir});
  for(const f of request.files??[])fs.writeFileSync(f.path,f.content);
  const r=spawn(cli.executable,[...cli.prefix_args,...request.args],{cwd:repo,input:request.stdin,encoding:'utf8',timeout:timeoutMs,maxBuffer:64*1024*1024,
   stdio:[request.stdin===undefined?'ignore':'pipe','pipe','pipe'],windowsHide:true,env:cliEnv(adapter.auth)});
  const why=()=>adapter.diagnose?.(r.stdout,r.stderr);
  if(r.error)throw Error(`${adapter.name} 실행 실패: ${r.error.code==='ETIMEDOUT'?`${Math.round(timeoutMs/1000)}초 시간 초과`:r.error.message}${why()?'. '+why():''}`);
  let parsed;
  try{parsed=adapter.parse(r.stdout??'',request);}
  catch(e){throw Error(`${adapter.name}: ${e.message}${why()?'. '+why():''} (종료 코드 ${r.status}, stderr 끝: ${String(r.stderr??'').trim().slice(-300)})`);}
  return {...parsed,redacted:Object.values(counts).reduce((a,b)=>a+b,0),warnings:cli.warnings??[]};
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
