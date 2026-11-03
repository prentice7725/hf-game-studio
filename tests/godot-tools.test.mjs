// Godot 검사·애드온 도구 테스트. 실제 Godot 대신 인자를 기록하고 정해진 종료 코드를 내는 가짜 실행 파일을 쓴다.
// 실제 Godot 4.7로 도는 검증은 CI의 godot-template 잡이 한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {checkSyntax,runTests,checkRun,checkAddonSettings,takeShot,gdFiles,findGodot,shotPrefix,autoloadNames,ERROR_PATTERN,GDUNIT_TOOL} from '../tools/godot-check.mjs';
import {installAddons,enablePlugins,setProjectSettings,hasProjectSetting,ADDONS,DIALOGIC_SETTINGS} from '../tools/godot-addons.mjs';
import {installGodot,GDIGNORE_DIRS} from '../scripts/setup.mjs';
import {STUDIO_ROOT} from '../scripts/task.mjs';

// 가짜 godot: 인자를 JSON 줄로 기록하고, 환경변수·인자에 따라 출력과 종료 코드를 흉내 낸다.
function fakeGodot(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-godot-')),log=path.join(dir,'calls.jsonl'),bin=path.join(dir,'godot');
 fs.writeFileSync(bin,`#!/usr/bin/env node
const fs=require('fs');const a=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\\n');
const mode=process.env.FAKE_GODOT??'ok';
if(a.includes('--version')){console.log('4.7.2.stable.official');process.exit(0);}
if(a.includes('--check-only')){const f=a[a.indexOf('--script')+1];if(mode==='syntax-error'&&f.includes('bad')){console.error('SCRIPT ERROR: Parse Error: Unexpected token');process.exit(1);}if(mode==='autoload'&&f.includes('main')){console.error('SCRIPT ERROR: Parse Error: Identifier not found: Dialogic');process.exit(1);}process.exit(0);}
if(a.includes(${JSON.stringify(GDUNIT_TOOL)})){const code=Number(process.env.FAKE_GDUNIT_EXIT??0);fs.writeSync(1,'gdUnit4 run\\nExit code: '+code+'\\n');if(mode==='crash-after')process.kill(process.pid,'SIGSEGV');if(mode==='exit-crash')process.exit(3);process.exit(code);}
if(a.includes('--quit-after')&&!a.includes('--write-movie')){if(mode==='boot-error')console.log('SCRIPT ERROR: Invalid call');else console.log('HFGS_READY mercenaries=1 contracts=2');process.exit(0);}
if(a.includes('--write-movie')){const out=a[a.indexOf('--write-movie')+1];if(mode!=='no-frames')fs.writeFileSync(out.replace(/\\.png$/,'00000000.png'),'');process.exit(0);}
process.exit(0);`,{mode:0o755});
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 // Windows는 셔뱅 스크립트를 직접 실행하지 못하므로 node로 돌리는 spawn을 끼운다(검사 도구의 spawn 주입).
 const opts=process.platform==='win32'?{spawn:(cmd,args,o)=>spawnSync(process.execPath,[cmd,...args],o)}:{};
 return {bin,opts,calls:()=>fs.existsSync(log)?fs.readFileSync(log,'utf8').trim().split('\n').map(l=>JSON.parse(l)):[]};
}
function godotProject(t,{addons=[]}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-gproj-'));
 fs.mkdirSync(path.join(dir,'.git'));
 installGodot(dir,{log:()=>{}});
 for(const a of addons){fs.mkdirSync(path.join(dir,'addons',a),{recursive:true});fs.writeFileSync(path.join(dir,'addons',a,'plugin.cfg'),'[plugin]\nname="x"\n');}
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return dir;
}
const withEnv=(vars,fn)=>{const old={};for(const [k,v] of Object.entries(vars)){old[k]=process.env[k];process.env[k]=v;}try{return fn();}finally{for(const [k,v] of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}};

test('installGodot: 템플릿을 루트에 깔고 .gdignore를 두고, 있는 파일은 덮어쓰지 않는다',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-g-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.mkdirSync(path.join(dir,'prototype'));fs.mkdirSync(path.join(dir,'tools'));
 const done=installGodot(dir,{log:()=>{}});
 for(const f of ['project.godot','scenes/main.tscn','scripts/main.gd','scripts/rules/contract_rules.gd','test/rules/contract_rules_test.gd','test/dialogue/dialogic_smoke_test.gd','prototype/.gdignore','tools/.gdignore'])
  assert.ok(done.includes(f),f);
 assert.ok(!fs.existsSync(path.join(dir,'docs','.gdignore')),'없는 폴더에는 만들지 않는다');
 fs.writeFileSync(path.join(dir,'scripts','main.gd'),'mine');
 assert.deepEqual(installGodot(dir,{log:()=>{}}),[]);
 assert.equal(fs.readFileSync(path.join(dir,'scripts','main.gd'),'utf8'),'mine');
 const project=fs.readFileSync(path.join(dir,'project.godot'),'utf8');
 assert.match(project,/config\/features=PackedStringArray\("4\.7"/);
 assert.match(project,/gl_compatibility/);
 assert.ok(!project.includes('[editor_plugins]'),'애드온 등록은 godot-addons.mjs가 한다');
 assert.deepEqual(GDIGNORE_DIRS.slice(0,2),['prototype','tools']);
});

test('gdFiles·findGodot',t=>{
 const dir=godotProject(t);
 const files=gdFiles(dir);
 assert.ok(files.includes('scripts/main.gd')&&files.includes('test/rules/contract_rules_test.gd'));
 assert.ok(!files.some(f=>f.startsWith('addons/')));
 assert.throws(()=>findGodot({env:{}}),/GODOT_BIN/);
 assert.throws(()=>findGodot({godot:path.join(dir,'nope')}),/없음/);
});

test('syntax: --import 뒤 파일마다 --check-only, 파싱 오류를 잡는다',t=>{
 const {bin,calls,opts}=fakeGodot(t),dir=godotProject(t);
 assert.deepEqual(checkSyntax(bin,dir,opts),[]);
 const c=calls();
 assert.deepEqual(c[0],['--headless','--path',dir,'--import']);
 assert.ok(c.slice(1).every(a=>a.includes('--check-only')&&a[a.indexOf('--script')+1].startsWith('res://')));
 assert.equal(c.length,1+gdFiles(dir).length);
 fs.writeFileSync(path.join(dir,'scripts','bad.gd'),'func (');
 const problems=withEnv({FAKE_GODOT:'syntax-error'},()=>checkSyntax(bin,dir,opts));
 assert.equal(problems.length,1);
 assert.match(problems[0],/^scripts\/bad\.gd: .*Parse Error/);
});

test('test: gdUnit4가 없으면 안내, 종료 코드 0·101은 통과, 100은 실패',t=>{
 const {bin,calls,opts}=fakeGodot(t);
 assert.match(runTests(bin,godotProject(t),opts)[0],/gdUnit4가 없음/);
 const dir=godotProject(t,{addons:['gdUnit4']});
 assert.deepEqual(runTests(bin,dir,opts),[]);
 const a=calls().at(-1);
 assert.ok(a.includes('--headless')&&a.includes(GDUNIT_TOOL)&&a.includes('--ignoreHeadlessMode')&&a[a.indexOf('-a')+1]==='res://test',JSON.stringify(a));
 assert.ok(!a.includes('-d')&&!a.includes('--remote-debug'),'헤드리스에는 디버거 인자를 넣지 않는다');
 assert.deepEqual(withEnv({FAKE_GDUNIT_EXIT:'101'},()=>runTests(bin,dir,opts)),[]);
 assert.match(withEnv({FAKE_GDUNIT_EXIT:'100'},()=>runTests(bin,dir,opts))[0],/gdUnit4 실패/);
 // Godot이 테스트를 마친 뒤 시그널로 죽으면 gdUnit4가 찍은 Exit code를 쓴다(CI 실측).
 // Windows는 프로세스가 시그널로 죽는 것을 흉내 낼 수 없다(process.kill(pid,'SIGSEGV')가 ENOSYS). CI(리눅스)에서 본다.
 if(process.platform!=='win32'){
  assert.deepEqual(withEnv({FAKE_GODOT:'crash-after'},()=>runTests(bin,dir,opts)),[]);
  assert.match(withEnv({FAKE_GODOT:'crash-after',FAKE_GDUNIT_EXIT:'100'},()=>runTests(bin,dir,opts))[0],/gdUnit4 실패/);
 }
 // 에디터를 열어 둔 채 돌리면 Windows에서 0xC0000005 같은 엉뚱한 코드로 죽는다(마일스톤 2 실측). 찍힌 결과를 쓴다.
 assert.deepEqual(withEnv({FAKE_GODOT:'exit-crash'},()=>runTests(bin,dir,opts)),[]);
 assert.match(withEnv({FAKE_GODOT:'exit-crash',FAKE_GDUNIT_EXIT:'100'},()=>runTests(bin,dir,opts))[0],/gdUnit4 실패/);
});

test('syntax: 자동 로드 이름을 못 찾으면 get_node("/root/이름")로 쓰라고 알린다',t=>{
 const {bin,opts}=fakeGodot(t),dir=godotProject(t);
 fs.appendFileSync(path.join(dir,'project.godot'),'\n[autoload]\n\nDialogic="*res://addons/dialogic/Core/DialogicGameHandler.gd"\n');
 assert.deepEqual(autoloadNames(dir),['Dialogic']);
 const problems=withEnv({FAKE_GODOT:'autoload'},()=>checkSyntax(bin,dir,opts));
 assert.match(problems.join('\n'),/get_node\("\/root\/Dialogic"\)/);
});

test('installGodot: 이미 있는 .gitignore에는 템플릿의 없는 줄만 더한다',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-g-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(path.join(dir,'.gitignore'),'node_modules/\r\n.godot/\r\n');
 assert.ok(installGodot(dir,{log:()=>{}}).includes('.gitignore'));
 const text=fs.readFileSync(path.join(dir,'.gitignore'),'utf8');
 assert.ok(text.startsWith('node_modules/\r\n.godot/\n'),JSON.stringify(text));
 assert.match(text,/shots\/\nreports\/\n$/);
 assert.equal(text.match(/\.godot\//g).length,1);
 assert.ok(!installGodot(dir,{log:()=>{}}).includes('.gitignore'),'두 번째는 더할 것이 없다');
});

test('run: HFGS_READY와 스크립트 오류를 본다',t=>{
 const {bin,opts}=fakeGodot(t),dir=godotProject(t);
 assert.deepEqual(checkRun(bin,dir,opts),[]);
 const p=withEnv({FAKE_GODOT:'boot-error'},()=>checkRun(bin,dir,opts));
 assert.ok(p.some(x=>x.includes('스크립트 오류'))&&p.some(x=>x.includes('HFGS_READY')),JSON.stringify(p));
 assert.ok(ERROR_PATTERN.test('SCRIPT ERROR: x')&&!ERROR_PATTERN.test('Godot Engine v4.7.2'));
});

test('run: Dialogic이 깔렸는데 자동 로드·입력 액션이 project.godot에 없으면 실패(헤드리스 로그에는 안 나오는 오류)',t=>{
 const {bin,opts}=fakeGodot(t),dir=godotProject(t,{addons:['dialogic']});
 assert.deepEqual(checkAddonSettings(godotProject(t)),[],'Dialogic이 없으면 요구하지 않는다');
 const p=checkRun(bin,dir,opts);
 assert.equal(p.length,1);
 assert.match(p[0],/addons\/dialogic.*autoload\/Dialogic, input\/dialogic_default_action.*godot-addons\.mjs/);
 const f=path.join(dir,'project.godot');
 fs.writeFileSync(f,setProjectSettings(fs.readFileSync(f,'utf8'),DIALOGIC_SETTINGS));
 assert.deepEqual(checkRun(bin,dir,opts),[]);
});

test('shot: 프레임 PNG가 생겨야 통과, 리눅스에서 DISPLAY가 없으면 xvfb-run',t=>{
 const {bin,calls,opts}=fakeGodot(t),dir=godotProject(t),out=path.join(dir,'shots');
 const r=takeShot(bin,dir,out,{prefix:[],...opts});
 assert.deepEqual(r.problems,[]);
 assert.equal(r.files.length,1);
 const a=calls().at(-1);
 assert.ok(a.includes('--write-movie')&&a.includes('--rendering-driver')&&!a.includes('--headless'),JSON.stringify(a));
 const bad=withEnv({FAKE_GODOT:'no-frames'},()=>takeShot(bin,dir,out,{prefix:[],...opts}));
 assert.match(bad.problems[0],/PNG가 만들어지지 않음/);
 assert.deepEqual(shotPrefix({platform:'linux',env:{DISPLAY:':0'}}),[]);
 assert.deepEqual(shotPrefix({platform:'linux',env:{},has:()=>true}),['xvfb-run','-a']);
 assert.throws(()=>shotPrefix({platform:'linux',env:{},has:()=>false}),/xvfb-run/);
 assert.deepEqual(shotPrefix({platform:'darwin',env:{}}),[]);
});

test('enablePlugins: 없으면 섹션을 만들고, 있으면 합치고, 중복은 넣지 않는다',()=>{
 const base='config_version=5\n\n[application]\n\nconfig/name="Game"\n';
 const once=enablePlugins(base,['res://addons/gdUnit4/plugin.cfg']);
 assert.match(once,/\[editor_plugins\]\n\nenabled=PackedStringArray\("res:\/\/addons\/gdUnit4\/plugin\.cfg"\)\n$/);
 const twice=enablePlugins(once,['res://addons/gdUnit4/plugin.cfg','res://addons/dialogic/plugin.cfg']);
 assert.match(twice,/enabled=PackedStringArray\("res:\/\/addons\/gdUnit4\/plugin\.cfg", "res:\/\/addons\/dialogic\/plugin\.cfg"\)/);
 assert.equal((twice.match(/\[editor_plugins\]/g)||[]).length,1);
 assert.ok(twice.includes('[application]'));
});

test('setProjectSettings: 없는 설정만 넣고, 섹션이 있으면 끝에, 없으면 새 섹션, 여러 줄 값도 찾는다',()=>{
 const base='config_version=5\n\n[application]\n\nconfig/name="Game"\n\n[input]\n\nui_x={\n"deadzone": 0.5,\n"events": []\n}\n\n[rendering]\n\nx=1\n';
 const out=setProjectSettings(base,DIALOGIC_SETTINGS);
 assert.ok(hasProjectSetting(out,{section:'input',key:'dialogic_default_action'})&&!hasProjectSetting(base,{section:'input',key:'dialogic_default_action'}));
 assert.ok(hasProjectSetting(out,{section:'autoload',key:'Dialogic'}));
 assert.ok(!hasProjectSetting(out,{section:'application',key:'Dialogic'}),'다른 섹션의 같은 이름은 세지 않는다');
 assert.match(out,/\[input\]\n\nui_x=\{\n"deadzone": 0\.5,\n"events": \[\]\n\}\ndialogic_default_action=\{\n[\s\S]*?\n\}\n\n\[rendering\]\n\nx=1\n\n\[autoload\]\n\nDialogic="\*res:\/\/addons\/dialogic\/Core\/DialogicGameHandler\.gd"\n$/);
 assert.equal(setProjectSettings(out,DIALOGIC_SETTINGS),out,'두 번 돌려도 그대로');
 // Dialogic plugin.gd의 add_dialogic_default_action과 같은 이벤트: Enter(4194309), 마우스 왼쪽(button_index 1), Space(32), X(88), 패드 A(button_index 0)
 const action=DIALOGIC_SETTINGS[1].text;
 for(const k of ['"keycode":4194309','"keycode":32','"keycode":88','InputEventMouseButton,[^\n]*"button_index":1','InputEventJoypadButton,[^\n]*"button_index":0'])assert.match(action,new RegExp(k));
 // CRLF로 저장된 project.godot(Windows 체크아웃)도 다룬다.
 const crlf=setProjectSettings(base.replace(/\n/g,'\r\n'),DIALOGIC_SETTINGS);
 assert.ok(hasProjectSetting(crlf,{section:'input',key:'dialogic_default_action'})&&hasProjectSetting(crlf,{section:'autoload',key:'Dialogic'}));
});

test('installAddons: 태그로 받아 addons/에 넣고 project.godot에 등록, 있는 것은 건너뜀',t=>{
 const dir=godotProject(t),cloned=[];
 const clone=(repo,tag,dest)=>{
  cloned.push([repo,tag]);
  const a=Object.values(ADDONS).find(a=>a.repo===repo),sub=a.src??`addons/${a.dir}`;
  fs.mkdirSync(path.join(dest,sub),{recursive:true});
  fs.writeFileSync(path.join(dest,sub,'plugin.cfg'),`[plugin]\nname="${a.dir}"\n`);
 };
 const done=installAddons(dir,{only:['gdunit4','dialogic'],clone,log:()=>{}});
 assert.deepEqual(done,['gdUnit4','dialogic']);
 assert.deepEqual(cloned,[[ADDONS.gdunit4.repo,'v6.2.2'],[ADDONS.dialogic.repo,'2.0-alpha-20']]);
 assert.ok(fs.existsSync(path.join(dir,'addons','gdUnit4','plugin.cfg')));
 const project=fs.readFileSync(path.join(dir,'project.godot'),'utf8');
 assert.match(project,/enabled=PackedStringArray\("res:\/\/addons\/gdUnit4\/plugin\.cfg", "res:\/\/addons\/dialogic\/plugin\.cfg"\)/);
 assert.ok(hasProjectSetting(project,{section:'autoload',key:'Dialogic'})&&hasProjectSetting(project,{section:'input',key:'dialogic_default_action'}),'Dialogic의 _enable_plugin이 쓰는 설정을 대신 쓴다');
 assert.deepEqual(checkAddonSettings(dir),[]);
 assert.deepEqual(installAddons(dir,{only:['gdunit4'],clone,log:()=>{}}),[],'이미 있으면 받지 않는다');
 // godot-ai는 저장소 안 plugin/addons/godot_ai에 있다.
 assert.deepEqual(installAddons(dir,{only:['godot_ai'],clone,log:()=>{}}),['godot_ai']);
 assert.ok(fs.existsSync(path.join(dir,'addons','godot_ai','plugin.cfg')));
 assert.match(fs.readFileSync(path.join(dir,'project.godot'),'utf8'),/"res:\/\/addons\/godot_ai\/plugin\.cfg"/);
 // 예전에 깐 저장소(애드온은 있고 설정은 없음)도 다시 돌리면 설정이 들어간다.
 const dir2=godotProject(t,{addons:['dialogic']});
 assert.deepEqual(installAddons(dir2,{only:['dialogic'],clone,log:()=>{}}),[]);
 assert.deepEqual(checkAddonSettings(dir2),[]);
 assert.throws(()=>installAddons(dir,{only:['unity'],clone}),/알 수 없는 애드온/);
 assert.throws(()=>installAddons(dir,{only:['aseprite'],clone:(r,t,d)=>fs.mkdirSync(d,{recursive:true})}),/plugin\.cfg가 없음/);
 assert.throws(()=>installAddons(fs.mkdtempSync(path.join(os.tmpdir(),'x-')),{clone}),/project\.godot 없음/);
});

test('템플릿의 공식은 프로토타입과 같은 숫자를 낸다(두 테스트 파일이 같은 경우를 본다)',()=>{
 const ts=fs.readFileSync(path.join(STUDIO_ROOT,'templates','phaser','src','rules','contract.test.ts'),'utf8');
 const gd=fs.readFileSync(path.join(STUDIO_ROOT,'templates','godot','test','rules','contract_rules_test.gd'),'utf8');
 for(const pair of [['merc(5), contract(3)','0.5'],['merc(6), contract(3)','0.6'],['merc(3), contract(3)','0.3']]){
  assert.ok(ts.includes(`successChance(${pair[0]})).toBe(${pair[1]})`),'ts '+pair[0]);
  assert.ok(gd.includes(`success_chance(${pair[0]})).is_equal_approx(${pair[1]}, 0.001)`),'gd '+pair[0]);
 }
});
