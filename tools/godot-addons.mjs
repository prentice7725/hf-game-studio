#!/usr/bin/env node
// Godot 애드온을 고정된 git 태그로 받아 addons/에 넣고 project.godot의 [editor_plugins]에 등록한다.
// 사용법: node tools/hfgs/godot-addons.mjs <Godot 프로젝트> [--only gdunit4,dialogic,aseprite,godot_ai] [--force]
// 에셋 라이브러리 대신 GitHub 태그를 쓰는 이유: 버전을 고정하고, 같은 명령으로 CI에서도 깔 수 있어서다.
// 이미 있는 애드온은 건너뛴다(--force면 지우고 다시 받음). addons/는 커밋한다.
// 플러그인이 에디터에서 켜질 때(_enable_plugin) 써 넣는 프로젝트 설정도 같이 쓴다. 파일로만 등록하면 에디터가 그 단계를 건너뛰어
// Dialogic이 입력마다 'InputMap action "dialogic_default_action" doesn't exist'를 찍었다(PR 20의 에디터 실행에서 실측).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

// Dialogic 2의 plugin.gd가 project.godot에 쓰는 설정. 자동 로드는 _enter_tree(에디터를 처음 열 때), 입력 액션은 _enable_plugin(플러그인을
// 켤 때)이 쓴다. 값은 Godot 4.7.2가 저장한 형식 그대로이고 이벤트는 add_dialogic_default_action과 같다(Enter, 마우스 왼쪽, Space, X, 패드 A).
// 자동 로드를 미리 넣는 이유: 헤드리스 검사(godot-check.mjs run)가 Dialogic을 실제로 띄워 보게 하려는 것이다.
export const DIALOGIC_SETTINGS=[
 {section:'autoload',key:'Dialogic',text:'Dialogic="*res://addons/dialogic/Core/DialogicGameHandler.gd"'},
 {section:'input',key:'dialogic_default_action',text:`dialogic_default_action={
"deadzone": 0.5,
"events": [Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":4194309,"physical_keycode":0,"key_label":0,"unicode":0,"location":0,"echo":false,"script":null)
, Object(InputEventMouseButton,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"button_mask":0,"position":Vector2(0, 0),"global_position":Vector2(0, 0),"factor":1.0,"button_index":1,"canceled":false,"pressed":true,"double_click":false,"script":null)
, Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":32,"physical_keycode":0,"key_label":0,"unicode":0,"location":0,"echo":false,"script":null)
, Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":88,"physical_keycode":0,"key_label":0,"unicode":0,"location":0,"echo":false,"script":null)
, Object(InputEventJoypadButton,"resource_local_to_scene":false,"resource_name":"","device":-1,"button_index":0,"pressure":0.0,"pressed":false,"script":null)
]
}`}
];

export const ADDONS={
 gdunit4:{repo:'https://github.com/MikeSchulze/gdUnit4',tag:'v6.2.2',dir:'gdUnit4',note:'단위 테스트(GDScript·C#). CLI 종료 코드 0 성공, 100 실패, 101 경고'},
 dialogic:{repo:'https://github.com/dialogic-godot/dialogic',tag:'2.0-alpha-20',dir:'dialogic',note:'대사 시스템. 2.0은 아직 alpha이고 Godot 4.5+ 요구',settings:DIALOGIC_SETTINGS},
 aseprite:{repo:'https://github.com/viniciusgerevini/godot-aseprite-wizard',tag:'v9.8.0-4',dir:'AsepriteWizard',note:'Aseprite 파일 자동 가져오기(스프라이트 애니메이션)'},
 // 리드가 에디터를 조작하고 플레이테스트하는 MCP(8단계 평가로 선택). 에디터가 열리면 uv로 Python 서버를 띄운다. 저장소 안 위치가 plugin/addons/다.
 godot_ai:{repo:'https://github.com/hi-godot/godot-ai',tag:'v4.3.1',dir:'godot_ai',src:'plugin/addons/godot_ai',note:'에디터 조작·플레이테스트 MCP. 에디터를 열 때 uv가 있어야 함'}
};

// 얕은 클론으로 태그 하나만 받는다. 테스트에서는 가짜 clone을 넣는다.
export function gitClone(repo,tag,dest){
 const r=spawnSync('git',['clone','-q','--depth','1','--branch',tag,repo,dest],{encoding:'utf8',timeout:10*60*1000,windowsHide:true,env:{...process.env,GIT_LFS_SKIP_SMUDGE:'1'}});
 if(r.status!==0)throw Error(`git clone 실패 (${repo} @ ${tag}): ${String(r.stderr).trim().split(/\r?\n/).pop()}`);
}

// project.godot의 [editor_plugins] enabled 목록에 플러그인을 넣는다. 다른 섹션은 건드리지 않는다.
export function enablePlugins(text,cfgPaths){
 const want=cfgPaths.map(p=>`"${p}"`);
 const m=/\[editor_plugins\]\s*\n\s*enabled=PackedStringArray\(([^)]*)\)/.exec(text);
 if(m){
  const have=m[1].split(',').map(s=>s.trim()).filter(Boolean);
  const merged=[...have,...want.filter(w=>!have.includes(w))];
  return text.replace(m[0],`[editor_plugins]\n\nenabled=PackedStringArray(${merged.join(', ')})`);
 }
 return text.replace(/\s*$/,'')+`\n\n[editor_plugins]\n\nenabled=PackedStringArray(${want.join(', ')})\n`;
}

// project.godot에서 [section]의 본문(다음 섹션 머리 직전까지)을 돌려준다. 없으면 null.
function sectionBody(text,section){
 const m=new RegExp(`^\\[${section}\\][^\\n]*\\n([\\s\\S]*?)(?=^\\[[^\\]]+\\]|(?![\\s\\S]))`,'m').exec(text);
 return m?{start:m.index+m[0].length-m[1].length,body:m[1]}:null;
}
// [section]에 key=... 가 있는지 본다. 값이 여러 줄이어도 key= 로 시작하는 줄만 찾는다.
export function hasProjectSetting(text,{section,key}){
 const s=sectionBody(text,section);
 return s!==null&&new RegExp(`^${key}=`,'m').test(s.body);
}
// 없는 설정만 써 넣는다. 섹션이 있으면 그 끝에, 없으면 파일 끝에 섹션을 만든다. 있는 값은 사람이 바꿨을 수 있으니 건드리지 않는다.
export function setProjectSettings(text,settings){
 for(const s of settings){
  if(hasProjectSetting(text,s))continue;
  const sec=sectionBody(text,s.section);
  if(sec===null){text=text.replace(/\s*$/,'')+`\n\n[${s.section}]\n\n${s.text}\n`;continue;}
  text=text.slice(0,sec.start)+sec.body.replace(/\s*$/,'')+`\n${s.text}\n\n`+text.slice(sec.start+sec.body.length);
 }
 return text;
}

export function installAddons(project,{only,force=false,clone=gitClone,log=console.log}={}){
 const projectFile=path.join(project,'project.godot');
 if(!fs.existsSync(projectFile))throw Error(`Godot 프로젝트가 아님(project.godot 없음): ${project}`);
 const names=only??Object.keys(ADDONS);
 const unknown=names.filter(n=>!ADDONS[n]);
 if(unknown.length)throw Error(`알 수 없는 애드온: ${unknown.join(', ')} (가능: ${Object.keys(ADDONS).join(', ')})`);
 const done=[],enabled=[],settings=[];
 for(const n of names){
  const a=ADDONS[n],target=path.join(project,'addons',a.dir);
  enabled.push(`res://addons/${a.dir}/plugin.cfg`);
  settings.push(...(a.settings??[]));
  if(fs.existsSync(target)&&!force){log(`건너뜀(이미 있음): addons/${a.dir}`);continue;}
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-addon-'));
  try{
   clone(a.repo,a.tag,tmp);
   const src=path.join(tmp,a.src??`addons/${a.dir}`);
   if(!fs.existsSync(path.join(src,'plugin.cfg')))throw Error(`${a.repo} @ ${a.tag}에 ${a.src??`addons/${a.dir}`}/plugin.cfg가 없음`);
   fs.rmSync(target,{recursive:true,force:true});
   fs.mkdirSync(path.dirname(target),{recursive:true});
   fs.cpSync(src,target,{recursive:true});
   log(`설치: addons/${a.dir} (${a.tag})`);
   done.push(a.dir);
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
 }
 // 이미 있어 건너뛴 애드온의 설정도 넣는다. 그래야 예전에 깐 저장소도 이 명령을 다시 돌리면 고쳐진다.
 const before=fs.readFileSync(projectFile,'utf8'),after=setProjectSettings(enablePlugins(before,enabled),settings);
 if(after!==before){fs.writeFileSync(projectFile,after);log(`project.godot: ${[...new Set(['editor_plugins',...settings.map(s=>s.section)])].map(s=>`[${s}]`).join(' ')} 갱신`);}
 return done;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const args=process.argv.slice(2);
 let project,only,force=false;
 for(let i=0;i<args.length;i++){
  if(args[i]==='--only')only=(args[++i]??'').split(',').map(s=>s.trim()).filter(Boolean);
  else if(args[i]==='--force')force=true;
  else if(args[i].startsWith('--')){console.error(`알 수 없는 인자: ${args[i]}`);process.exit(2);}
  else project=args[i];
 }
 if(!project){console.error('사용법: godot-addons.mjs <Godot 프로젝트> [--only gdunit4,dialogic,aseprite,godot_ai] [--force]');process.exit(2);}
 try{installAddons(path.resolve(project),{only,force});}
 catch(e){console.error('오류: '+e.message);process.exit(1);}
}
