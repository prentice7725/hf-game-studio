// 외부 CLI 실행 파일 찾기와 Windows 명령줄 길이 확인.
// 출처: hyperfusion scripts/platform.mjs (MIT). 프로세스 트리 종료·이름 바꾸기 재시도는 쓰지 않아 뺐다.
import fs from 'node:fs';
import path from 'node:path';

export const isWin=process.platform==='win32';

const SCRIPT=/\.(c|m)?js$/i;
// .js/.mjs 진입점은 node로 실행하므로 실행 비트가 필요 없다.
const executable=f=>{try{if(!fs.statSync(f).isFile())return false;if(!isWin&&!SCRIPT.test(f))fs.accessSync(f,fs.constants.X_OK);return true;}catch{return false;}};

// npm이 만든 .cmd 래퍼에서 실제 진입점(.js 또는 .exe)을 꺼낸다.
// cmd.exe를 거치면 JSON 프롬프트의 따옴표·%·^가 깨지므로 래퍼를 직접 실행하지 않는다.
export function unwrapShim(file){
 const text=fs.readFileSync(file,'utf8');
 const m=[...text.matchAll(/"%~?dp0%?\\([^"]+?\.(?:c?js|mjs|exe))"/gi)].at(-1);
 if(!m)return null;
 const target=path.join(path.dirname(file),...m[1].split(/[\\/]/));
 return fs.existsSync(target)?target:null;
}

// 실행 파일을 찾아 {executable, prefix_args}로 돌려준다. 스크립트 진입점은 현재 node로 실행한다.
export function resolveExecutable(name,binary,{env=process.env}={}){
 const exts=isWin?[...(env.PATHEXT||'.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map(e=>e.toLowerCase()),'']:[''];
 const dirs=/[\\/]/.test(binary)?['']:(env.PATH||env.Path||'').split(path.delimiter).filter(Boolean);
 let found;
 for(const d of dirs){for(const e of exts){const f=path.resolve(d,binary+e);if(executable(f)){found=f;break;}}if(found)break;}
 if(!found)throw Error(`CLI_UNAVAILABLE: ${name} 실행 파일을 찾을 수 없음 (${binary})`);
 found=fs.realpathSync(found);
 if(SCRIPT.test(found))return {executable:process.execPath,prefix_args:[found]};
 if(isWin&&/\.(cmd|bat)$/i.test(found)){
  const target=unwrapShim(found);
  if(!target)throw Error(`CLI_UNAVAILABLE: ${name}는 진입점을 찾을 수 없는 배치 래퍼(${found}): .exe나 .js 진입점을 직접 지정할 것`);
  return SCRIPT.test(target)?{executable:process.execPath,prefix_args:[target]}:{executable:target,prefix_args:[]};
 }
 return {executable:found,prefix_args:[]};
}

// Node(libuv)가 Windows 명령줄을 만드는 방식대로 센다. 공백·따옴표가 있는 인자는 따옴표로 감싸고, 안의 "는 \"로,
// " 앞이나 끝에 오는 \는 두 배로 늘린다. JSON 프롬프트는 따옴표가 많아 글자 수만 세면 실제 길이보다 작게 나온다.
function quotedLength(arg){
 const s=String(arg);
 if(!s)return 2;
 if(!/[\s"]/.test(s))return s.length;
 let n=s.length+2,slashes=0;
 for(const ch of s){
  if(ch==='\\'){slashes++;continue;}
  if(ch==='"')n+=slashes+1;
  slashes=0;
 }
 return n+slashes;
}
export const windowsCommandLineLength=(exe,args)=>[exe,...args].reduce((n,a,i)=>n+quotedLength(a)+(i?1:0),0);
export const WINDOWS_COMMAND_LINE_MAX=32000;
// Windows 명령줄은 32767자 제한이 있다. 프롬프트를 인자로 넘기는 CLI(agy)는 실행 전에 막는다.
export function assertCommandLine(exe,args,{windows=isWin,hint=null}={}){
 if(!windows)return;
 const length=windowsCommandLineLength(exe,args);
 if(length>WINDOWS_COMMAND_LINE_MAX)throw Error(`명령줄이 Windows 한도를 넘음 (${length}자, 한도 ${WINDOWS_COMMAND_LINE_MAX}): `+(hint?.()??'프롬프트를 줄일 것'));
}
