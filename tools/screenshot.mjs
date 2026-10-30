#!/usr/bin/env node
// 화면을 실제로 띄워 보고 스크린샷을 남긴다. UI 작업에서 일꾼의 "됐다"는 말 대신 컨트롤러가 확인하는 수용 검사다.
// 사용법:
//   node tools/hfgs/screenshot.mjs --serve "npm run dev" --url http://localhost:5173 --selector "#contract-board" [--expect-text "계약"]
//   node tools/hfgs/screenshot.mjs --file dist/index.html --selector canvas
//   node tools/hfgs/screenshot.mjs --electron . --selector "#app"
// --serve: 개발 서버를 이 도구가 직접 띄우고, --url이 응답할 때까지 기다렸다가 찍은 뒤 프로세스 트리째 종료한다.
//   hyperfusion은 일꾼 프로세스가 모두 끝난 뒤에 수용 검사를 돌리므로, 일꾼이 띄운 서버에 기대면 안 된다.
//   이 도구가 끝날 때 자식 프로세스가 남으면 hyperfusion의 종료 확인에도 걸린다.
// 실패 조건: 서버가 뜨지 않음, 페이지 오류(uncaught exception), 콘솔 error, 선택자 없음, 기대 문구 없음.
// 스크린샷은 저장소 밖(임시 폴더, HFGS_SCREENSHOT_DIR로 변경)에 저장한다. 저장소 안에 쓰면 컨트롤러가 트리 변경으로 본다.
// Playwright가 대상 저장소나 전역에 설치되어 있어야 한다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

export function parseArgs(argv){
 const o={timeout:15000,serveTimeout:60000};
 const keys={'--url':'url','--file':'file','--electron':'electron','--serve':'serve','--serve-timeout':'serveTimeout','--selector':'selector','--expect-text':'expectText','--name':'name','--timeout':'timeout','--width':'width','--height':'height'};
 for(let i=0;i<argv.length;i++){
  const k=keys[argv[i]];
  if(!k||argv[i+1]===undefined)throw Error(`알 수 없는 인자이거나 값이 없음: ${argv[i]}`);
  o[k]=argv[++i];
 }
 for(const k of ['timeout','serveTimeout','width','height'])if(o[k]!==undefined)o[k]=Number(o[k]);
 if([o.url,o.file,o.electron].filter(Boolean).length!==1)throw Error('--url, --file, --electron 중 하나만 지정');
 if(o.serve&&!o.url)throw Error('--serve에는 서버 주소(--url)가 필요');
 if(!o.selector)throw Error('--selector 필요');
 return o;
}

// 서버 명령을 셸로 띄운다. POSIX에서는 새 프로세스 그룹으로 띄워 나중에 그룹째 종료한다.
export function startServer(command,{cwd=process.cwd()}={}){
 const child=spawn(command,{cwd,shell:true,detached:process.platform!=='win32',stdio:['ignore','ignore','pipe']});
 let stderr='';
 child.stderr.on('data',d=>{stderr=(stderr+d).slice(-2000);});
 child.exited=new Promise(r=>child.once('exit',code=>r(code)));
 child.stderrTail=()=>stderr;
 return child;
}

// 주소가 응답할 때까지 기다린다. 서버가 먼저 죽으면 바로 실패한다.
export async function waitForUrl(url,child,timeout){
 const end=Date.now()+timeout;
 let dead=false;
 child.exited.then(()=>{dead=true;});
 while(Date.now()<end){
  if(dead)throw Error(`서버가 응답 전에 종료됨: ${child.stderrTail().trim().split('\n').pop()??''}`);
  try{
   const res=await fetch(url,{signal:AbortSignal.timeout(2000)});
   await res.body?.cancel();
   return;
  }catch{}
  await sleep(250);
 }
 throw Error(`서버가 ${timeout}ms 안에 응답하지 않음: ${url}`);
}

const groupAlive=pid=>{try{process.kill(-pid,0);return true;}catch(e){return e.code==='EPERM';}};

// 서버를 자식·손자 프로세스까지 종료한다. 남은 프로세스가 있으면 hyperfusion이 종료 확인에서 막는다.
export async function stopServer(child){
 if(!child?.pid)return;
 try{await killTree(child);}
 // 남은 프로세스가 파이프를 붙잡아 이 도구가 끝나지 않는 일이 없게 한다.
 finally{child.stderr?.destroy();}
}

async function killTree(child){
 if(process.platform==='win32'){
  spawnSync('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore'});
  await Promise.race([child.exited,sleep(5000)]);
  return;
 }
 if(!groupAlive(child.pid))return;
 try{process.kill(-child.pid,'SIGTERM');}catch{}
 for(let i=0;i<50&&groupAlive(child.pid);i++)await sleep(100);
 if(groupAlive(child.pid)){
  try{process.kill(-child.pid,'SIGKILL');}catch{}
  for(let i=0;i<20&&groupAlive(child.pid);i++)await sleep(100);
 }
 if(groupAlive(child.pid))throw Error(`서버 프로세스 그룹(${child.pid})을 종료하지 못함`);
}

async function loadPlaywright(){
 // 대상 저장소의 node_modules를 먼저 보고, 없으면 전역 설치를 찾는다.
 const require=createRequire(path.join(process.cwd(),'noop.js'));
 try{return require('playwright');}catch{}
 try{return await import('playwright');}catch{}
 throw Error('playwright를 찾을 수 없음: 대상 저장소에 npm i -D playwright');
}

async function capture(o){
 const pw=await loadPlaywright();
 const problems=[];
 let app,browser,page;
 if(o.electron){
  app=await pw._electron.launch({args:[o.electron]});
  page=await app.firstWindow();
 }else{
  browser=await pw.chromium.launch();
  page=await browser.newPage({viewport:{width:o.width??1280,height:o.height??720}});
 }
 page.on('pageerror',e=>problems.push(`페이지 오류: ${e.message}`));
 page.on('console',m=>{if(m.type()==='error')problems.push(`콘솔 오류: ${m.text()}`);});
 try{
  if(!o.electron){
   const target=o.url??pathToFileURL(path.resolve(o.file)).href;
   await page.goto(target,{waitUntil:'load',timeout:o.timeout});
  }
  const el=await page.waitForSelector(o.selector,{state:'visible',timeout:o.timeout}).catch(()=>null);
  if(!el)problems.push(`선택자가 보이지 않음: ${o.selector}`);
  else if(o.expectText){
   const text=await el.innerText();
   if(!text.includes(o.expectText))problems.push(`기대 문구 없음: ${JSON.stringify(o.expectText)}`);
  }
  const dir=process.env.HFGS_SCREENSHOT_DIR??path.join(os.tmpdir(),'hfgs-screenshots');
  fs.mkdirSync(dir,{recursive:true});
  const name=(o.name??o.selector).replace(/[^\w.-]+/g,'_').slice(0,60)||'screen';
  const out=path.join(dir,`${name}-${Date.now()}.png`);
  await page.screenshot({path:out,fullPage:!o.electron});
  console.log(`스크린샷: ${out}`);
 }finally{
  await (app??browser).close();
 }
 return problems;
}

async function main(){
 const o=parseArgs(process.argv.slice(2));
 let server,problems;
 try{
  if(o.serve){
   server=startServer(o.serve);
   await waitForUrl(o.url,server,o.serveTimeout);
  }
  problems=await capture(o);
 }finally{
  await stopServer(server);
 }
 if(problems.length){for(const p of problems)console.error('FAIL '+p);process.exit(1);}
 console.log('OK');
}

if(import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exit(2);});
