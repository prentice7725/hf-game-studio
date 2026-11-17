// 플레이테스트 도구 테스트. godot-ai 대신 가짜 도구 호출로 게시판 → 대사 → 선택지 → 결과를 흉내 낸다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runScenario,checkScenario,judgeExpect,judgeVisible,matches,canvasToWindow} from '../tools/godot-playtest.mjs';

const rect=(x,y)=>({position:{x,y},size:{x:100,y:20}});
// 대사 대본: 줄은 Enter로, 선택지는 클릭으로 넘어간다. 끝나면 대사창이 사라지고 라벨이 바뀐다.
function fakeGame({script,onEnd}){
 const calls=[];let started=false,talking=false,at=0,live=0;
 const state={gold:'금화 10',result:''};
 const elements=()=>{
  const out=[
   {name:'TalkButton',path:'/Main/TalkButton',type:'Button',text:'이야기하기',visible:true,disabled:talking,global_rect:rect(0,0)},
   {name:'GoldLabel',path:'/Main/GoldLabel',type:'Label',text:state.gold,visible:true,global_rect:rect(0,30)},
   {name:'ResultLabel',path:'/Main/ResultLabel',type:'Label',text:state.result,visible:true,global_rect:rect(0,60)},
   {name:'Portrait',path:'/Main/Portrait',type:'TextureRect',visible:true,global_rect:rect(0,200)},
   {name:'Sprite',path:'/Main/Sprite',type:'TextureRect',visible:true,global_rect:{position:{x:0,y:300},size:{x:0,y:0}}}];
  if(talking){
   const s=script[at];
   if(s.line)out.push({name:'Text',path:'/Main/../Layout/Text',type:'RichTextLabel',text:s.line,visible:true,global_rect:rect(0,100)});
   for(const [i,c] of (s.choices??[]).entries())out.push({name:`Choice${i}`,path:`/Main/../Layout/Choice${i}`,type:'Button',text:c,visible:true,global_rect:rect(0,130+i*30)});
  }
  return out;
 };
 const advance=()=>{at++;if(at>=script.length){talking=false;onEnd(state);}};
 let mouse=null;
 const call=async(name,args)=>{
  calls.push([name,args]);
  if(name==='project_run'){started=true;return {text:'{"status":"not_live"}'};}
  if(name==='game_manage'&&args.op==='get_ui_elements'){
   if(!started||live++<2)throw Error('game_manage: not_live');
   return {text:JSON.stringify({elements:elements()})};
  }
  if(name==='game_manage'&&args.op==='input_mouse'&&args.params.pressed===false){
   const hit=elements().find(e=>e.global_rect.position.y+10===mouse.y&&!e.disabled);
   if(hit?.name==='TalkButton'){talking=true;at=0;}
   else if(hit?.name.startsWith('Choice')){state.picked=[...(state.picked??[]),hit.text];advance();}
  }
  if(name==='game_manage'&&args.op==='input_mouse')mouse=args.params.position;
  if(name==='game_manage'&&args.op==='input_key'&&args.params.pressed&&talking&&!script[at].choices)advance();
  if(name==='editor_screenshot')return {text:'{}',image:{data:Buffer.from('png').toString('base64')}};
  if(name==='logs_read')return {text:JSON.stringify({lines:[{level:'warning',text:'애드온 경고'}]})};
  return {text:'{}'};
 };
 return {call,calls,state};
}
const SCRIPT=[{line:'호위를 맡기려고요.'},{line:'맡아 주시겠습니까?',choices:['받는다','넘긴다']},{line:'받지.'}];
const run=(game,scenario,extra={})=>runScenario(checkScenario(scenario),{call:game.call,log:()=>{},sleep:async()=>{},...extra});

test('runScenario: 누르고, Enter로 넘기고, 선택지를 고르고, 라벨을 확인한다(not_live는 기다린다)',async t=>{
 const shots=fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-pt-'));
 t.after(()=>fs.rmSync(shots,{recursive:true,force:true}));
 const game=fakeGame({script:SCRIPT,onEnd:s=>{if(s.picked.includes('받는다')){s.gold='금화 60';s.result='성공';}}});
 const r=await run(game,{name:'accept',steps:[{visible:'Portrait'},{click:'이야기하기'},{dialogue:['받는다']},{expect:{GoldLabel:'금화 60',ResultLabel:{match:'성공'}}},{shot:'end'}]},{shots});
 assert.deepEqual(r,{ok:true,problems:[]});
 assert.deepEqual(game.calls.find(c=>c[0]==='project_run')[1],{mode:'main',autosave:false},'장면을 저장하지 않고 실행');
 assert.ok(game.calls.some(c=>c[0]==='game_manage'&&c[1].op==='input_key'&&c[1].params.key==='Enter'));
 assert.ok(game.calls.every(c=>c[1]?.op!=='get_ui_elements'||c[1].params.root_path==='..'),'대사창은 장면 밖이라 root_path ".."');
 assert.ok(fs.existsSync(path.join(shots,'accept-end.png')));
 assert.equal(game.calls.at(-1)[0],'project_manage');
});

test('runScenario: 없는 선택지, 남은 선택지, 다른 라벨, 없는 버튼은 실패',async()=>{
 const end=s=>{s.gold='금화 0';};
 assert.match((await run(fakeGame({script:SCRIPT,onEnd:end}),{name:'x',steps:[{click:'이야기하기'},{dialogue:['도망친다']}]})).problems[0],/받는다 \| 넘긴다 중 고를 것이 없음/);
 assert.match((await run(fakeGame({script:SCRIPT,onEnd:end}),{name:'x',steps:[{click:'이야기하기'},{dialogue:['넘긴다','또']}]})).problems[0],/고르지 못한 선택지가 남음: 또/);
 assert.match((await run(fakeGame({script:SCRIPT,onEnd:end}),{name:'x',steps:[{click:'이야기하기'},{dialogue:['넘긴다']},{expect:{GoldLabel:'금화 60'}}]})).problems[0],/기대와 다름/);
 assert.match((await run(fakeGame({script:SCRIPT,onEnd:end}),{name:'x',steps:[{click:'받기'}]})).problems[0],/누를 컨트롤 없음: 받기/);
 assert.match((await run(fakeGame({script:SCRIPT,onEnd:end}),{name:'x',steps:[{dialogue:[]}]})).problems[0],/대사창이 열리지 않음/);
 // 그림이 없는 TextureRect(크기 0)와 없는 노드는 보이지 않는 것으로 본다.
 assert.match((await run(fakeGame({script:SCRIPT,onEnd:end}),{name:'x',steps:[{visible:['Portrait','Sprite','Badge']}]})).problems[0],/보이지 않음: Sprite, Badge/);
 // 스크린샷 응답에 이미지가 없으면 실패(Codex 리뷰 F2).
 const noImage=fakeGame({script:SCRIPT,onEnd:end}),orig=noImage.call;
 const call=async(n,a)=>n==='editor_screenshot'?{text:'{}'}:orig(n,a);
 assert.match((await runScenario(checkScenario({name:'x',steps:[{shot:'end'}]}),{call,log:()=>{},sleep:async()=>{}})).problems[0],/스크린샷을 받지 못함/);
});

test('checkScenario·judgeExpect: 형식, 배열은 그중 하나',()=>{
 assert.throws(()=>checkScenario({name:'a',steps:[]}),/steps/);
 assert.throws(()=>checkScenario({name:'한글',steps:[{shot:'x'}]}),/name/);
 assert.throws(()=>checkScenario({name:'a',steps:[{click:'x',shot:'y'}]}),/하나만/);
 assert.throws(()=>checkScenario({name:'a',steps:[{dialogue:'받는다'}]}),/배열/);
 // 빈 기대값·빈 글자는 아무것도 확인하지 않고 통과하므로 막는다(Codex 리뷰 F1).
 for(const bad of [{expect:null},{expect:{}},{expect:[]},{expect:[{}]},{expect:{GoldLabel:3}},{expect:{GoldLabel:{match:'('}}},{click:''},{shot:null},{shot:'../x'}])
  assert.throws(()=>checkScenario({name:'a',steps:[bad]}),undefined,JSON.stringify(bad));
 const els=[{name:'GoldLabel',text:'금화 0'},{name:'ResultLabel',text:'실패'}];
 assert.equal(judgeExpect([{GoldLabel:'금화 60'},{GoldLabel:'금화 0',ResultLabel:{match:'^실패'}}],els).ok,true);
 assert.equal(judgeExpect({GoldLabel:'금화 60'},els).ok,false);
 assert.equal(matches('',''),true);
 for(const bad of [{visible:''},{visible:[]},{visible:[3]},{visible:[['Portrait']]}])
  assert.throws(()=>checkScenario({name:'a',steps:[bad]}),/visible/,JSON.stringify(bad));
 assert.deepEqual(judgeVisible('Portrait',[{name:'Portrait',visible:false,global_rect:rect(0,0)}]),{ok:false,missing:['Portrait']});
 assert.deepEqual(judgeVisible(['Portrait'],[{name:'Portrait',global_rect:rect(0,0)}]),{ok:true,missing:[]});
 assert.throws(()=>matches(3,'3'),/expect 값은/);
});

test('canvasToWindow: 캔버스 좌표를 Godot stretch 규칙대로 창 좌표로 바꾼다',()=>{
 const win=(size,cs,mode=1,aspect=1,factor=1)=>({size:{x:size[0],y:size[1]},content_scale_size:{x:cs[0],y:cs[1]},content_scale_mode:mode,content_scale_aspect:aspect,content_scale_factor:factor});
 const near=(got,want)=>{assert.ok(Math.abs(got.x-want.x)<1e-6&&Math.abs(got.y-want.y)<1e-6,`${JSON.stringify(got)} != ${JSON.stringify(want)}`);};
 // 보고된 경우: 캔버스 1920×1080, 창 1600×900(같은 비율)
 near(canvasToWindow(win([1600,900],[1920,1080]))({x:960,y:540}),{x:800,y:450});
 near(canvasToWindow(win([1600,900],[1920,1080],2))({x:1920,y:1080}),{x:1600,y:900},'viewport 모드도 같은 변환');
 // keep, 화면이 더 넓음: 좌우 여백
 near(canvasToWindow(win([2000,900],[1600,900]))({x:0,y:0}),{x:200,y:0});
 // keep, 화면이 더 높음: 위아래 여백
 near(canvasToWindow(win([1600,1200],[1600,900]))({x:800,y:0}),{x:800,y:150});
 // expand: 여백 없이 캔버스가 늘어남
 near(canvasToWindow(win([2000,900],[1600,900],1,4))({x:100,y:100}),{x:100,y:100});
 // ignore: 축마다 따로 늘림
 near(canvasToWindow(win([800,900],[1600,900],1,0))({x:100,y:100}),{x:50,y:100});
 // stretch 꺼짐·정보 없음: 그대로
 near(canvasToWindow(win([1600,900],[1920,1080],0))({x:10,y:20}),{x:10,y:20});
 near(canvasToWindow(undefined)({x:10,y:20}),{x:10,y:20});
});

test('runScenario: 누를 때 루트 창 정보를 읽어 창 좌표로 누른다',async()=>{
 const pressed=[];
 const call=async(name,args)=>{
  if(name==='game_manage'&&args.op==='get_ui_elements')return {text:JSON.stringify({elements:[{name:'Go',path:'/Main/Go',type:'Button',text:'가기',visible:true,global_rect:{position:{x:900,y:500},size:{x:120,y:80}}}]})};
  if(name==='game_manage'&&args.op==='get_node_info'){
   assert.equal(args.params.path,'/root/.');
   return {text:JSON.stringify({found:true,properties:{size:{x:1600,y:900},content_scale_size:{x:1920,y:1080},content_scale_mode:1,content_scale_aspect:1,content_scale_factor:1}})};
  }
  if(name==='game_manage'&&args.op==='input_mouse')pressed.push(args.params.position);
  return {text:'{}'};
 };
 const r=await runScenario(checkScenario({name:'go',steps:[{click:'가기'}]}),{call,log:()=>{},sleep:async()=>{}});
 assert.deepEqual(r,{ok:true,problems:[]});
 assert.equal(pressed.length,3);
 for(const p of pressed){assert.ok(Math.abs(p.x-800)<1e-6&&Math.abs(p.y-450)<1e-6,JSON.stringify(p));}
});
