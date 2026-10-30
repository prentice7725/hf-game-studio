// 스크린샷 도구의 인자 처리 테스트. 브라우저 실행은 여기서 하지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseArgs,startServer,waitForUrl,stopServer} from '../tools/screenshot.mjs';

test('대상은 하나만, 선택자는 필수',()=>{
 assert.deepEqual(parseArgs(['--url','http://x','--selector','#a']),{timeout:15000,serveTimeout:60000,url:'http://x',selector:'#a'});
 assert.throws(()=>parseArgs(['--url','http://x','--file','a.html','--selector','#a']),/하나만/);
 assert.throws(()=>parseArgs(['--url','http://x']),/--selector/);
 assert.throws(()=>parseArgs(['--bogus','1']),/알 수 없는 인자/);
});

test('숫자 인자는 숫자로',()=>{
 assert.equal(parseArgs(['--file','a.html','--selector','canvas','--timeout','500']).timeout,500);
});

test('--serve에는 --url이 필요',()=>{
 assert.equal(parseArgs(['--serve','npm run dev','--url','http://localhost:5173','--selector','#a']).serve,'npm run dev');
 assert.throws(()=>parseArgs(['--serve','npm run dev','--file','a.html','--selector','#a']),/--url/);
});

// 서버 명령이 손자 프로세스를 띄워도(npm run dev → vite 같은 구조) 그룹째 종료되는지 본다.
// 손자는 파이프를 물려받지 않게(stdio ignore) 띄워, 종료가 잘못되면 테스트가 멈추지 않고 실패하게 한다.
test('서버를 띄워 기다린 뒤 손자 프로세스까지 종료',{skip:process.platform==='win32'&&'POSIX 프로세스 그룹 전용'},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-serve-'));
 const pidOf=f=>Number(fs.readFileSync(path.join(dir,f),'utf8'));
 t.after(()=>{for(const f of ['pid','parent-pid'])try{process.kill(pidOf(f),'SIGKILL');}catch{}});
 fs.writeFileSync(path.join(dir,'server.mjs'),`import http from 'node:http';import fs from 'node:fs';
const s=http.createServer((q,r)=>r.end('ok')).listen(0,()=>fs.writeFileSync(${JSON.stringify(path.join(dir,'port'))},String(s.address().port)));
fs.writeFileSync(${JSON.stringify(path.join(dir,'pid'))},String(process.pid));`);
 fs.writeFileSync(path.join(dir,'parent.mjs'),`import {spawn} from 'node:child_process';import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(path.join(dir,'parent-pid'))},String(process.pid));spawn(process.execPath,[${JSON.stringify(path.join(dir,'server.mjs'))}],{stdio:'ignore'});setInterval(()=>{},1000);`);
 const child=startServer(`"${process.execPath}" "${path.join(dir,'parent.mjs')}"`,{cwd:dir});
 try{
  for(let i=0;i<100&&!fs.existsSync(path.join(dir,'port'));i++)await new Promise(r=>setTimeout(r,50));
  const url=`http://127.0.0.1:${fs.readFileSync(path.join(dir,'port'),'utf8')}/`;
  await waitForUrl(url,child,5000);
  assert.equal(await (await fetch(url)).text(),'ok');
 }finally{
  await stopServer(child);
 }
 assert.throws(()=>process.kill(pidOf('parent-pid'),0),/ESRCH/,'자식 프로세스가 남아 있음');
 assert.throws(()=>process.kill(pidOf('pid'),0),/ESRCH/,'손자 프로세스가 남아 있음');
});

test('서버가 응답 전에 죽으면 바로 실패',async()=>{
 const child=startServer(`"${process.execPath}" -e "process.exit(3)"`);
 await assert.rejects(waitForUrl('http://127.0.0.1:9/',child,10000),/응답 전에 종료/);
 await stopServer(child);
});
