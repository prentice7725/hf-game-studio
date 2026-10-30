#!/usr/bin/env node
// 화면을 실제로 띄워 보고 스크린샷을 남긴다. UI 작업에서 일꾼의 "됐다"는 말 대신 컨트롤러가 확인하는 수용 검사다.
// 사용법:
//   node tools/hfgs/screenshot.mjs --url http://localhost:5173 --selector "#contract-board" [--expect-text "계약"] [--name contract-board]
//   node tools/hfgs/screenshot.mjs --file dist/index.html --selector canvas
//   node tools/hfgs/screenshot.mjs --electron . --selector "#app"
// 실패 조건: 페이지 오류(uncaught exception), 콘솔 error, 선택자 없음, 기대 문구 없음.
// 스크린샷은 저장소 밖(임시 폴더, HFGS_SCREENSHOT_DIR로 변경)에 저장한다. 저장소 안에 쓰면 컨트롤러가 트리 변경으로 본다.
// Playwright가 대상 저장소나 전역에 설치되어 있어야 한다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

export function parseArgs(argv){
 const o={timeout:15000};
 const keys={'--url':'url','--file':'file','--electron':'electron','--selector':'selector','--expect-text':'expectText','--name':'name','--timeout':'timeout','--width':'width','--height':'height'};
 for(let i=0;i<argv.length;i++){
  const k=keys[argv[i]];
  if(!k||argv[i+1]===undefined)throw Error(`알 수 없는 인자이거나 값이 없음: ${argv[i]}`);
  o[k]=argv[++i];
 }
 for(const k of ['timeout','width','height'])if(o[k]!==undefined)o[k]=Number(o[k]);
 if([o.url,o.file,o.electron].filter(Boolean).length!==1)throw Error('--url, --file, --electron 중 하나만 지정');
 if(!o.selector)throw Error('--selector 필요');
 return o;
}

async function loadPlaywright(){
 // 대상 저장소의 node_modules를 먼저 보고, 없으면 전역 설치를 찾는다.
 const require=createRequire(path.join(process.cwd(),'noop.js'));
 try{return require('playwright');}catch{}
 try{return await import('playwright');}catch{}
 throw Error('playwright를 찾을 수 없음: 대상 저장소에 npm i -D playwright');
}

async function main(){
 const o=parseArgs(process.argv.slice(2));
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
 if(problems.length){for(const p of problems)console.error('FAIL '+p);process.exit(1);}
 console.log('OK');
}

if(import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exit(2);});
