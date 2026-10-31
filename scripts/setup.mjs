#!/usr/bin/env node
// 게임 저장소에 hf-game-studio를 깐다. 이미 있는 파일은 덮어쓰지 않는다(--force면 검사 도구와 스킬만 갱신).
// 사용법: node scripts/setup.mjs <게임 저장소> [--force] [--phaser | --phaser=폴더]
//   --phaser[=폴더]           웹 프로토타입 템플릿(templates/phaser)을 <저장소>/<폴더>(기본 prototype)에 깐다. 있는 파일은 건너뛴다
//   tools/hfgs/*.mjs          수용 검사 도구(데이터 스키마, 애셋 규격, 대사 변환·검사, 스크린샷)
//   design/*.md               단일 원본 문서 뼈대(용어집, 세계관, GDD, 아트 바이블)
//   design/schemas/*.json     결과물 형식(JSON 스키마) 예시
//   design/asset-manifest.json 애셋 규격 예시
//   .claude/skills/gs-*       리드용 검토 스킬
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {STUDIO_ROOT,TOOLS_DIR} from './task.mjs';

// [원본(hf-game-studio 기준), 대상(게임 저장소 기준), 갱신 대상인지]
export function plan(root=STUDIO_ROOT){
 const files=[];
 const dir=(src,dst,update)=>{
  for(const e of fs.readdirSync(path.join(root,src),{withFileTypes:true})){
   if(e.isDirectory())dir(`${src}/${e.name}`,`${dst}/${e.name}`,update);
   else files.push([`${src}/${e.name}`,`${dst}/${e.name}`,update]);
  }
 };
 dir('tools',TOOLS_DIR,true);
 dir('templates/design','design',false);
 dir('skills','.claude/skills',true);
 return files;
}

export function install(repo,{force=false,root=STUDIO_ROOT,log=console.log}={}){
 if(!fs.existsSync(path.join(repo,'.git')))throw Error(`Git 저장소가 아님: ${repo} (task.mjs가 작업 전후를 git으로 비교하므로 Git 저장소가 필요)`);
 const done=[];
 for(const [src,dst,update] of plan(root)){
  const target=path.join(repo,dst),exists=fs.existsSync(target);
  if(exists&&!(force&&update)){log(`건너뜀(이미 있음): ${dst}`);continue;}
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.copyFileSync(path.join(root,src),target);
  log(`${exists?'갱신':'생성'}: ${dst}`);
  done.push(dst);
 }
 // v1(hyperfusion 경로)에서 깐 설정이 남아 있으면 알려 준다. 지우지는 않는다.
 if(fs.existsSync(path.join(repo,'hyperfusion.config.json')))log('참고: hyperfusion.config.json은 v2에서 쓰지 않음. hyperfusion을 따로 쓰지 않으면 지워도 됨');
 return done;
}

// 웹 프로토타입 템플릿. 무겁고(npm install) 프로젝트마다 하나라 기본 설치에 넣지 않고 --phaser로만 깐다. 절대 덮어쓰지 않는다.
export const PHASER_DIR='prototype';
export function installPhaser(repo,{dir=PHASER_DIR,root=STUDIO_ROOT,log=console.log}={}){
 if(!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(dir))throw Error(`프로토타입 폴더 이름은 영문·숫자·_-로: ${dir}`);
 const done=[],src=path.join(root,'templates','phaser');
 const walk=rel=>{
  for(const e of fs.readdirSync(path.join(src,rel),{withFileTypes:true})){
   const r=rel?`${rel}/${e.name}`:e.name;
   if(e.isDirectory()){walk(r);continue;}
   const target=path.join(repo,dir,r);
   if(fs.existsSync(target)){log(`건너뜀(이미 있음): ${dir}/${r}`);continue;}
   fs.mkdirSync(path.dirname(target),{recursive:true});
   fs.copyFileSync(path.join(src,r),target);
   log(`생성: ${dir}/${r}`);
   done.push(`${dir}/${r}`);
  }
 };
 walk('');
 return done;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 // --phaser는 기본 폴더(prototype), --phaser=폴더 는 그 폴더. 저장소 경로와 섞이지 않게 값은 =로만 받는다.
 const args=process.argv.slice(2),force=args.includes('--force');
 const phaserFlag=args.find(a=>a==='--phaser'||a.startsWith('--phaser='));
 const phaser=phaserFlag?(phaserFlag.includes('=')?phaserFlag.slice('--phaser='.length):PHASER_DIR):null;
 const unknown=args.find(a=>a.startsWith('--')&&a!=='--force'&&a!==phaserFlag);
 if(unknown){console.error(`알 수 없는 인자: ${unknown}`);process.exit(2);}
 const repo=args.find(a=>!a.startsWith('--'));
 if(!repo||(phaser!==null&&!phaser)){console.error('사용법: setup.mjs <게임 저장소> [--force] [--phaser | --phaser=폴더]');process.exit(2);}
 try{
  install(path.resolve(repo),{force});
  if(phaser){
   installPhaser(path.resolve(repo),{dir:phaser});
   console.log(`\n프로토타입: cd ${phaser} && npm install. 스크린샷 검사에는 저장소 루트에서 npm i -D playwright && npx playwright install chromium`);
  }
  console.log('\n다음 단계: design/ 문서를 채우고, 작업 파일을 써서 node scripts/task.mjs start로 시작할 것');
 }catch(e){console.error('오류: '+e.message);process.exit(1);}
}
