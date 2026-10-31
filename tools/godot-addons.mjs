#!/usr/bin/env node
// Godot 애드온을 고정된 git 태그로 받아 addons/에 넣고 project.godot의 [editor_plugins]에 등록한다.
// 사용법: node tools/hfgs/godot-addons.mjs <Godot 프로젝트> [--only gdunit4,dialogic,aseprite] [--force]
// 에셋 라이브러리 대신 GitHub 태그를 쓰는 이유: 버전을 고정하고, 같은 명령으로 CI에서도 깔 수 있어서다.
// 이미 있는 애드온은 건너뛴다(--force면 지우고 다시 받음). addons/는 커밋한다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const ADDONS={
 gdunit4:{repo:'https://github.com/MikeSchulze/gdUnit4',tag:'v6.2.2',dir:'gdUnit4',note:'단위 테스트(GDScript·C#). CLI 종료 코드 0 성공, 100 실패, 101 경고'},
 dialogic:{repo:'https://github.com/dialogic-godot/dialogic',tag:'2.0-alpha-20',dir:'dialogic',note:'대사 시스템. 2.0은 아직 alpha이고 Godot 4.5+ 요구'},
 aseprite:{repo:'https://github.com/viniciusgerevini/godot-aseprite-wizard',tag:'v9.8.0-4',dir:'AsepriteWizard',note:'Aseprite 파일 자동 가져오기(스프라이트 애니메이션)'}
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

export function installAddons(project,{only,force=false,clone=gitClone,log=console.log}={}){
 const projectFile=path.join(project,'project.godot');
 if(!fs.existsSync(projectFile))throw Error(`Godot 프로젝트가 아님(project.godot 없음): ${project}`);
 const names=only??Object.keys(ADDONS);
 const unknown=names.filter(n=>!ADDONS[n]);
 if(unknown.length)throw Error(`알 수 없는 애드온: ${unknown.join(', ')} (가능: ${Object.keys(ADDONS).join(', ')})`);
 const done=[],enabled=[];
 for(const n of names){
  const a=ADDONS[n],target=path.join(project,'addons',a.dir);
  enabled.push(`res://addons/${a.dir}/plugin.cfg`);
  if(fs.existsSync(target)&&!force){log(`건너뜀(이미 있음): addons/${a.dir}`);continue;}
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-addon-'));
  try{
   clone(a.repo,a.tag,tmp);
   const src=path.join(tmp,'addons',a.dir);
   if(!fs.existsSync(path.join(src,'plugin.cfg')))throw Error(`${a.repo} @ ${a.tag}에 addons/${a.dir}/plugin.cfg가 없음`);
   fs.rmSync(target,{recursive:true,force:true});
   fs.mkdirSync(path.dirname(target),{recursive:true});
   fs.cpSync(src,target,{recursive:true});
   log(`설치: addons/${a.dir} (${a.tag})`);
   done.push(a.dir);
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
 }
 const before=fs.readFileSync(projectFile,'utf8'),after=enablePlugins(before,enabled);
 if(after!==before){fs.writeFileSync(projectFile,after);log('project.godot: [editor_plugins] 갱신');}
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
 if(!project){console.error('사용법: godot-addons.mjs <Godot 프로젝트> [--only gdunit4,dialogic,aseprite] [--force]');process.exit(2);}
 try{installAddons(path.resolve(project),{only,force});}
 catch(e){console.error('오류: '+e.message);process.exit(1);}
}
