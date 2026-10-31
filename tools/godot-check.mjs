#!/usr/bin/env node
// Godot 프로젝트 검사. task.mjs의 수용 검사와 CI가 쓴다. Godot 실행 파일은 GODOT_BIN(또는 --godot)으로 받는다.
// 사용법: node tools/hfgs/godot-check.mjs <syntax|test|run|shot|all> [--project DIR] [--godot BIN] [--out DIR]
//   syntax  --import로 클래스 캐시를 만든 뒤 scripts/·test/의 .gd를 하나씩 --check-only로 파싱한다
//   test    gdUnit4 CLI(--headless, --ignoreHeadlessMode)로 test/를 돈다. 종료 코드 0 성공, 100 실패, 101 경고(통과로 봄).
//           Godot 4.7.2가 테스트를 다 돌린 뒤 종료 시그널로 죽는 일이 있어(CI 실측), 그때는 gdUnit4가 찍은 "Exit code: N"을 쓴다
//   run     헤드레스로 시작 장면을 몇 프레임 띄워 스크립트 오류가 없고 HFGS_READY 로그가 나오는지 본다
//   shot    창을 띄워(리눅스는 xvfb-run) Movie Maker로 프레임 PNG를 남긴다. 사람이 보는 용도이고 픽셀 비교는 하지 않는다
//   all     syntax + test + run (shot은 따로)
// 종료 코드: 통과 0, 실패 1, 사용법·환경 오류 2.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const SCRIPT_DIRS=['scripts','test'];
export const ERROR_PATTERN=/SCRIPT ERROR|Parse Error|ERROR: |Failed to load|Cannot open|Unexpected token/;
export const READY_MARK='HFGS_READY';
export const GDUNIT_TOOL='res://addons/gdUnit4/bin/GdUnitCmdTool.gd';

export function findGodot({godot,env=process.env}={}){
 const bin=godot??env.GODOT_BIN;
 if(!bin)throw Object.assign(Error('Godot 실행 파일을 모름: GODOT_BIN 환경변수나 --godot으로 지정할 것 (https://github.com/godotengine/godot/releases/tag/4.7.2-stable)'),{usage:true});
 if(!fs.existsSync(bin))throw Object.assign(Error(`Godot 실행 파일이 없음: ${bin}`),{usage:true});
 return bin;
}

export function gdFiles(project,dirs=SCRIPT_DIRS){
 const out=[];
 const walk=(abs,rel)=>{
  if(!fs.existsSync(abs))return;
  for(const e of fs.readdirSync(abs,{withFileTypes:true})){
   if(e.isDirectory())walk(path.join(abs,e.name),`${rel}/${e.name}`);
   else if(e.name.endsWith('.gd'))out.push(`${rel}/${e.name}`);
  }
 };
 for(const d of dirs)walk(path.join(project,d),d);
 return out.sort();
}

// Godot을 한 번 돌리고 출력을 모은다. 헤드리스 Godot은 오류를 stderr가 아니라 stdout으로 내기도 해서 둘을 합쳐 본다.
export function godot(bin,args,{project,timeoutMs=10*60*1000,spawn=spawnSync,prefix=[]}={}){
 const cmd=prefix.length?prefix[0]:bin,cmdArgs=prefix.length?[...prefix.slice(1),bin,...args]:args;
 const r=spawn(cmd,cmdArgs,{cwd:project,encoding:'utf8',timeout:timeoutMs,maxBuffer:64*1024*1024,windowsHide:true});
 if(r.error)throw Error(`Godot 실행 실패: ${r.error.code==='ETIMEDOUT'?`${Math.round(timeoutMs/1000)}초 시간 초과`:r.error.message}`);
 return {status:r.status,signal:r.signal??null,output:`${r.stdout??''}\n${r.stderr??''}`};
}
const tail=(s,n=1500)=>s.trim().slice(-n);

export function checkSyntax(bin,project,opts={}){
 const problems=[];
 // 클래스 이름(class_name) 캐시가 있어야 다른 스크립트를 참조하는 파일이 파싱된다.
 const imp=godot(bin,['--headless','--path',project,'--import'],{project,...opts});
 if(imp.status!==0)problems.push(`--import 실패(종료 ${imp.status}): ${tail(imp.output)}`);
 for(const f of gdFiles(project)){
  const r=godot(bin,['--headless','--path',project,'--check-only','--script',`res://${f}`],{project,...opts});
  if(r.status!==0||ERROR_PATTERN.test(r.output))problems.push(`${f}: ${tail(r.output,600)||`종료 코드 ${r.status}`}`);
 }
 return problems;
}

export function runTests(bin,project,opts={}){
 if(!fs.existsSync(path.join(project,'addons','gdUnit4','plugin.cfg')))return [`gdUnit4가 없음: node tools/hfgs/godot-addons.mjs ${project} --only gdunit4`];
 // runtest.sh의 -d --remote-debug는 대화형 디버거(-d) 때문에 넣는 것이라 빼고 돈다. 4.7은 포트 0을 거부해 오류만 찍는다.
 const r=godot(bin,['--headless','--path',project,'-s',GDUNIT_TOOL,'--ignoreHeadlessMode','-a','res://test'],{project,...opts});
 let code=r.status;
 if(code===null){
  const printed=/Exit code: (\d+)/.exec(r.output);
  if(!printed)return [`gdUnit4가 시그널 ${r.signal}로 끝났고 결과를 찍지 못함: ${tail(r.output)}`];
  code=Number(printed[1]);
  console.error(`경고: Godot이 테스트를 마친 뒤 시그널 ${r.signal}로 끝남. gdUnit4가 찍은 결과(Exit code: ${code})를 씀`);
 }
 if(code===0)return [];
 if(code===101){console.error('경고: gdUnit4가 경고로 끝남(101): '+tail(r.output,400));return [];}
 return [`gdUnit4 ${code===100?'실패':'종료 코드 '+code}: ${tail(r.output)}`];
}

export function checkRun(bin,project,opts={}){
 const r=godot(bin,['--headless','--path',project,'--quit-after','5'],{project,...opts});
 const problems=[];
 if(r.status!==0)problems.push(`종료 코드 ${r.status}`);
 if(ERROR_PATTERN.test(r.output))problems.push('스크립트 오류: '+(r.output.split(/\r?\n/).find(l=>ERROR_PATTERN.test(l))??'').trim());
 if(!r.output.includes(READY_MARK))problems.push(`시작 장면이 ${READY_MARK}를 출력하지 않음(main.gd의 _ready 참고)`);
 return problems;
}

// 창이 필요하다. 리눅스에서 DISPLAY가 없으면 xvfb-run으로 감싼다. 결과는 PNG 프레임 묶음(이름00000000.png ...)이다.
export function shotPrefix({platform=process.platform,env=process.env,has=cmd=>spawnSync(platform==='win32'?'where':'which',[cmd],{stdio:'ignore'}).status===0}={}){
 if(platform!=='linux'||env.DISPLAY)return [];
 if(!has('xvfb-run'))throw Object.assign(Error('표시 장치가 없음: DISPLAY를 주거나 xvfb-run을 설치할 것(apt-get install xvfb)'),{usage:true});
 return ['xvfb-run','-a'];
}
export function takeShot(bin,project,outDir,opts={}){
 fs.mkdirSync(outDir,{recursive:true});
 const base=path.join(outDir,`boot-${Date.now()}.png`);
 const r=godot(bin,['--path',project,'--rendering-driver','opengl3','--resolution','1280x720','--write-movie',base,'--fixed-fps','10','--quit-after','10'],{project,prefix:shotPrefix(),...opts});
 const made=fs.readdirSync(outDir).filter(f=>f.startsWith(path.basename(base,'.png'))&&f.endsWith('.png'));
 const problems=[];
 if(ERROR_PATTERN.test(r.output))problems.push('스크립트 오류: '+(r.output.split(/\r?\n/).find(l=>ERROR_PATTERN.test(l))??'').trim());
 if(!made.length)problems.push(`PNG가 만들어지지 않음(종료 ${r.status}): ${tail(r.output,600)}`);
 return {problems,files:made.map(f=>path.join(outDir,f))};
}

function parseArgs(args){
 const o={_:[]};
 for(let i=0;i<args.length;i++){
  const a=args[i];
  if(['--project','--godot','--out'].includes(a)){o[a.slice(2)]=args[++i];if(o[a.slice(2)]===undefined)throw Object.assign(Error(`${a}에 값이 필요함`),{usage:true});}
  else if(a.startsWith('--'))throw Object.assign(Error(`알 수 없는 인자: ${a}`),{usage:true});
  else o._.push(a);
 }
 return o;
}

function main(){
 const a=parseArgs(process.argv.slice(2)),cmd=a._[0];
 if(!['syntax','test','run','shot','all'].includes(cmd))throw Object.assign(Error('사용법: godot-check.mjs <syntax|test|run|shot|all> [--project DIR] [--godot BIN] [--out DIR]'),{usage:true});
 const project=path.resolve(a.project??process.cwd());
 if(!fs.existsSync(path.join(project,'project.godot')))throw Object.assign(Error(`Godot 프로젝트가 아님(project.godot 없음): ${project}`),{usage:true});
 const bin=findGodot({godot:a.godot});
 const steps=cmd==='all'?['syntax','test','run']:[cmd];
 let failed=false;
 for(const s of steps){
  let problems;
  if(s==='syntax')problems=checkSyntax(bin,project);
  else if(s==='test')problems=runTests(bin,project);
  else if(s==='run')problems=checkRun(bin,project);
  else{
   const {problems:p,files}=takeShot(bin,project,path.resolve(a.out??path.join(project,'shots')));
   problems=p;
   for(const f of files)console.log(`프레임: ${f}`);
  }
  if(problems.length){failed=true;console.error(`FAIL ${s}`);for(const p of problems)console.error('  '+p);}
  else console.log(`OK ${s}`);
 }
 return failed?1:0;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{process.exit(main());}catch(e){console.error('오류: '+e.message);process.exit(e.usage?2:1);}
}
