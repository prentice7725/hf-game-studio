#!/usr/bin/env node
// godot-ai MCP로 떠 있는 Godot 에디터에서 게임을 실행하고, 시나리오대로 누르고 대사를 넘긴 뒤 라벨을 확인한다.
// "직접 확인"이던 화면 기준을 수용 검사로 바꾸는 용도다(마일스톤 2에서 손으로 짠 드라이버를 옮김).
// 사용법: node tools/hfgs/godot-playtest.mjs <시나리오.json> [--port 8000] [--ws-port 9500] [--shots DIR]
//   에디터가 godot-ai 애드온과 함께 떠 있어야 한다. 포트는 에디터가 띄운 서버의 것(로그에 안 찍힘: netstat로 에디터 PID의 LISTEN 포트를 찾음).
//   --port·--ws-port 기본은 GODOT_AI_PORT·GODOT_AI_WS_PORT, 없으면 8000·9500.
//   --shots 스크린샷 폴더. 기본 HFGS_HOME(~/.hf-game-studio)/playtest. 저장소 안에 쓰면 에디터가 .import를 만들고 범위 밖 변경이 된다.
// 시나리오: {"name":"accept","steps":[...]} 단계는 차례로 돈다.
//   {"click":"이야기하기"}               글자나 노드 이름이 같은, 보이고 눌리는 컨트롤을 누른다
//   {"dialogue":["보수부터 듣는다","받는다"]}  대사가 끝날 때까지 Enter로 넘기고, 선택지가 나오면 이 목록을 차례로 고른다
//   {"expect":{"GoldLabel":"금화 60","ResultLabel":{"match":"성공"}}}  노드 이름별 글자. 배열이면 그중 하나가 맞으면 통과
//   {"visible":["Portrait"]}               노드 이름별로, 보이고(visible) 크기가 0이 아닌 컨트롤이 있어야 한다(그림이 들어간 TextureRect 등). 글자 하나면 그 이름 하나
//   {"shot":"end"}                         게임 화면을 <shots>/<name>-end.png로 남긴다(사람이 보는 용도)
// 대사창은 현재 장면 밖(루트)에 붙으므로 get_ui_elements를 root_path ".."로 부르고, 경로에 "/../"가 든 요소를 대사창으로 본다.
// Dialogic은 input_action으로는 넘어가지 않고 같은 액션에 묶인 Enter 키로 넘어간다. project_run은 autosave:false로 부른다(장면이 저장되어 범위 밖 변경이 생김).
// 종료 코드: 통과 0, 실패 1, 사용법·환경 오류 2.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const GODOT_AI_VERSION='4.3.1';
const sleepMs=ms=>new Promise(r=>setTimeout(r,ms));

// 최소 MCP 클라이언트(stdio JSON-RPC). 게임 저장소에 복사되는 도구라 hf-game-studio의 scripts/를 가져오지 않는다.
export function attach({port,wsPort,version=GODOT_AI_VERSION}){
 const child=spawn('uvx',['--link-mode','copy','--from',`godot-ai==${version}`,'godot-ai','attach','--port',String(port),'--ws-port',String(wsPort),'--disable-telemetry'],
  {env:{...process.env,GODOT_AI_DISABLE_TELEMETRY:'true'},stdio:['pipe','pipe','pipe'],windowsHide:true});
 const pending=new Map();let id=0,stderr='',dead=null;
 const abort=e=>{dead=e;for(const p of pending.values())p.reject(e);pending.clear();};
 child.on('error',e=>abort(Error(`godot-ai를 띄우지 못함(uvx): ${e.message}`)));
 child.on('exit',code=>abort(Error(`godot-ai attach가 끝남(${code})${stderr?': '+stderr.trim().slice(-500):''}`)));
 child.stderr.on('data',d=>{stderr=(stderr+d).slice(-4000);});
 readline.createInterface({input:child.stdout}).on('line',line=>{
  let msg;try{msg=JSON.parse(line);}catch{return;}
  const p=pending.get(msg.id);if(!p)return;
  pending.delete(msg.id);
  if(msg.error)p.reject(Error(msg.error.message??JSON.stringify(msg.error)));else p.resolve(msg.result);
 });
 const send=m=>{if(dead)throw dead;child.stdin.write(JSON.stringify(m)+'\n');};
 const request=(method,params,timeoutMs=60*1000)=>new Promise((resolve,reject)=>{
  const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error(`${method}: ${timeoutMs/1000}초 안에 응답 없음`));},timeoutMs);
  pending.set(n,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});
  try{send({jsonrpc:'2.0',id:n,method,params});}catch(e){clearTimeout(timer);pending.delete(n);reject(e);}
 });
 const ready=request('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'hfgs-playtest',version:'0.1.0'}})
  .then(()=>send({jsonrpc:'2.0',method:'notifications/initialized'}));
 // 도구 결과: 글자(대개 JSON)와 이미지. isError는 도구 쪽 실패다.
 const call=async(name,args)=>{
  await ready;
  const r=await request('tools/call',{name,arguments:args});
  const text=(r.content??[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
  if(r.isError)throw Error(`${name}: ${text.slice(0,300)||'도구 오류'}`);
  return {text,image:(r.content??[]).find(c=>c.type==='image')};
 };
 return {call,close:()=>child.kill()};
}

export function checkScenario(s){
 if(!s||typeof s!=='object'||!Array.isArray(s.steps)||!s.steps.length)throw Error('시나리오는 {"name":..., "steps":[...]} 형식');
 if(!/^[A-Za-z0-9_-]+$/.test(s.name??''))throw Error('시나리오 name은 영문·숫자·_-');
 for(const [i,st] of s.steps.entries()){
  const keys=Object.keys(st??{});
  if(keys.length!==1||!['click','dialogue','expect','visible','shot'].includes(keys[0]))throw Error(`steps[${i}]: click, dialogue, expect, visible, shot 중 하나만`);
  if(keys[0]==='visible'){
   const names=[st.visible].flat();
   if(!names.length||!names.every(n=>typeof n==='string'&&n.trim()))throw Error(`steps[${i}]: visible은 노드 이름이나 이름 배열(비어 있지 않음)`);
  }
  if(keys[0]==='dialogue'&&!(Array.isArray(st.dialogue)&&st.dialogue.every(x=>typeof x==='string')))throw Error(`steps[${i}]: dialogue는 고를 선택지 글자 배열(없으면 [])`);
  if((keys[0]==='click'||keys[0]==='shot')&&!(typeof st[keys[0]]==='string'&&st[keys[0]].trim()))throw Error(`steps[${i}]: ${keys[0]}은 비어 있지 않은 글자`);
  if(keys[0]==='shot'&&!/^[A-Za-z0-9_-]+$/.test(st.shot))throw Error(`steps[${i}]: shot 이름은 영문·숫자·_-`);
  // 빈 기대값은 아무것도 확인하지 않고 통과하므로 막는다.
  if(keys[0]==='expect'){
   const options=Array.isArray(st.expect)?st.expect:[st.expect];
   const okOption=o=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length&&Object.values(o).every(v=>typeof v==='string'||(v&&typeof v.match==='string'&&Object.keys(v).length===1));
   if(!options.length||!options.every(okOption))throw Error(`steps[${i}]: expect는 {"노드 이름":"글자"|{"match":"정규식"}} 객체(비어 있지 않음)나 그런 객체의 배열`);
   for(const o of options)for(const v of Object.values(o))if(typeof v!=='string')new RegExp(v.match);
  }
 }
 return s;
}

const outside=e=>e.path?.includes('/../');
const visibleText=e=>e.visible!==false&&typeof e.text==='string'&&e.text.trim();
const isButton=e=>/Button/.test(e.type??'');
const center=e=>({x:e.global_rect.position.x+e.global_rect.size.x/2,y:e.global_rect.position.y+e.global_rect.size.y/2});

// 기대값 하나: 문자열은 같아야, {"match":"정규식"}은 맞아야 한다.
export function matches(want,got){
 if(typeof want==='string')return got===want;
 if(want&&typeof want.match==='string')return typeof got==='string'&&new RegExp(want.match).test(got);
 throw Error(`expect 값은 문자열이나 {"match":"정규식"}: ${JSON.stringify(want)}`);
}
// 보이는 컨트롤: 이름이 같고, visible이 false가 아니고, 화면에서 차지하는 크기가 있다. TextureRect는 그림이 없으면 크기가 0이 된다.
export function judgeVisible(names,elements){
 const shown=n=>elements.some(e=>e.name===n&&e.visible!==false&&e.global_rect?.size?.x>0&&e.global_rect?.size?.y>0);
 const missing=[names].flat().filter(n=>!shown(n));
 return {ok:!missing.length,missing};
}
export function judgeExpect(expect,elements){
 const text=name=>elements.find(e=>e.name===name)?.text;
 const options=Array.isArray(expect)?expect:[expect];
 const ok=options.some(o=>Object.entries(o).every(([name,want])=>matches(want,text(name))));
 const seen=Object.fromEntries([...new Set(options.flatMap(Object.keys))].map(n=>[n,text(n)??null]));
 return {ok,seen};
}

// 시나리오 실행. call은 godot-ai 도구 호출(테스트에서는 가짜)이다.
export async function runScenario(scenario,{call,log=console.log,sleep=sleepMs,shots,wait=500,maxSteps=60}={}){
 const ui=async()=>JSON.parse((await call('game_manage',{op:'get_ui_elements',params:{root_path:'..'}})).text).elements??[];
 const click=async e=>{
  const position=center(e);
  await call('game_manage',{op:'input_mouse',params:{event:'motion',position}});
  await call('game_manage',{op:'input_mouse',params:{event:'button',position,pressed:true}});
  await call('game_manage',{op:'input_mouse',params:{event:'button',position,pressed:false}});
 };
 const problems=[];
 await call('project_manage',{op:'stop'}).catch(()=>{});
 await call('project_run',{mode:'main',autosave:false});
 // project_run은 게임 쪽 도우미가 몇 초 안에 안 붙으면 not_live를 돌려준다. 실패가 아니라 기다리면 붙으므로 UI가 보일 때까지 다시 묻는다.
 let els=[];
 for(let i=0;i<40&&!els.some(e=>!outside(e));i++){await sleep(wait);try{els=await ui();}catch{}}
 if(!els.length)return {ok:false,problems:['게임 UI를 읽지 못함(게임이 뜨지 않았거나 godot-ai 게임 도우미가 붙지 않음)']};
 for(const step of scenario.steps){
  if(step.click!==undefined){
   els=await ui();
   const target=els.find(e=>e.visible!==false&&!e.disabled&&(e.text===step.click||e.name===step.click));
   if(!target){problems.push(`누를 컨트롤 없음: ${step.click}`);break;}
   await click(target);log(`누름: ${step.click}`);
  }else if(step.dialogue){
   const picks=[...step.dialogue];let seen=false,idle=0,last='',done=false;
   for(let i=0;i<maxSteps;i++){
    await sleep(wait);els=await ui();
    const box=els.filter(e=>outside(e)&&visibleText(e));
    const choices=box.filter(isButton),lines=box.filter(e=>!isButton(e)).map(e=>e.text.trim()).join(' / ');
    if(lines&&lines!==last){log(`대사: ${lines.slice(0,160)}`);last=lines;}
    if(choices.length){
     seen=true;idle=0;
     const want=picks.shift();
     const pick=want===undefined?null:choices.find(e=>e.text.trim()===want);
     if(!pick){problems.push(`선택지 ${choices.map(e=>e.text.trim()).join(' | ')} 중 고를 것이 없음(시나리오: ${want??'남은 선택 없음'})`);break;}
     await click(pick);log(`고름: ${want}`);continue;
    }
    if(box.length){
     seen=true;idle=0;
     await call('game_manage',{op:'input_key',params:{key:'Enter',pressed:true}});
     await call('game_manage',{op:'input_key',params:{key:'Enter',pressed:false}});
     continue;
    }
    // 대사창이 두 번 연달아 안 보이면 끝난 것으로 본다. 처음부터 안 열리면 실패.
    if(seen&&++idle>=2){done=true;break;}
    if(!seen&&i>=10)break;
   }
   if(problems.length)break;
   if(!seen){problems.push('대사창이 열리지 않음');break;}
   if(!done){problems.push(`대사가 ${maxSteps}번 안에 끝나지 않음`);break;}
   if(picks.length){problems.push(`고르지 못한 선택지가 남음: ${picks.join(', ')}`);break;}
   log('대사 끝');
  }else if(step.expect){
   await sleep(wait);els=await ui();
   const r=judgeExpect(step.expect,els);
   log(`${r.ok?'맞음':'다름'}: ${JSON.stringify(r.seen)}`);
   if(!r.ok){problems.push(`기대와 다름: ${JSON.stringify(r.seen)} (기대 ${JSON.stringify(step.expect)})`);break;}
  }else if(step.visible){
   await sleep(wait);els=await ui();
   const r=judgeVisible(step.visible,els);
   log(`${r.ok?'보임':'안 보임'}: ${[step.visible].flat().join(', ')}`);
   if(!r.ok){problems.push(`보이지 않음: ${r.missing.join(', ')}`);break;}
  }else if(step.shot){
   const {image}=await call('editor_screenshot',{source:'game',max_resolution:960});
   if(!image){problems.push(`스크린샷을 받지 못함: ${step.shot}`);break;}
   if(shots){
    fs.mkdirSync(shots,{recursive:true});
    const file=path.join(shots,`${scenario.name}-${step.shot}.png`);
    fs.writeFileSync(file,Buffer.from(image.data,'base64'));log(`화면: ${file}`);
   }
  }
 }
 // 게임 로그의 경고·오류는 알려만 준다(애드온 경고가 섞여 실패로 보지 않음).
 try{
  const logs=JSON.parse((await call('logs_read',{source:'game'})).text);
  const bad=(logs.lines??[]).filter(l=>l.level&&l.level!=='info').map(l=>`${l.level}: ${String(l.text).slice(0,160)}`);
  if(bad.length)log(`게임 로그 경고·오류 ${bad.length}개:\n  ${bad.slice(0,8).join('\n  ')}`);
 }catch{}
 await call('project_manage',{op:'stop'}).catch(()=>{});
 return {ok:!problems.length,problems};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const args=process.argv.slice(2);
 let file,port=process.env.GODOT_AI_PORT??'8000',wsPort=process.env.GODOT_AI_WS_PORT??'9500';
 let shots=path.join(process.env.HFGS_HOME??path.join(os.homedir(),'.hf-game-studio'),'playtest');
 for(let i=0;i<args.length;i++){
  const a=args[i];
  if(['--port','--ws-port','--shots'].includes(a)){
   const v=args[++i];
   if(v===undefined){console.error(`${a}에 값이 없음`);process.exit(2);}
   if(a==='--port')port=v;else if(a==='--ws-port')wsPort=v;else shots=path.resolve(v);
  }else if(a.startsWith('--')){console.error(`알 수 없는 인자: ${a}`);process.exit(2);}
  else file=a;
 }
 if(!file){console.error('사용법: godot-playtest.mjs <시나리오.json> [--port 8000] [--ws-port 9500] [--shots DIR]');process.exit(2);}
 let scenario;
 try{scenario=checkScenario(JSON.parse(fs.readFileSync(file,'utf8')));}catch(e){console.error('오류: '+e.message);process.exit(2);}
 const client=attach({port,wsPort});
 let code=1;
 try{
  const r=await runScenario(scenario,{call:client.call,shots});
  for(const p of r.problems)console.error('  '+p);
  console.log(`${r.ok?'PLAYTEST PASS':'PLAYTEST FAIL'} ${scenario.name}`);
  code=r.ok?0:1;
 }catch(e){console.error(`오류: ${e.message} (에디터가 godot-ai와 함께 떠 있는지, 포트 ${port}/${wsPort}가 맞는지 볼 것)`);code=2;}
 finally{client.close();}
 process.exit(code);
}
