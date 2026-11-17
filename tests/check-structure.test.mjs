// 구조 검사 도구 테스트. 규칙 폴더가 화면 코드·난수·시계를 쓰면 줄 번호와 함께 잡고, 설정이 틀리면 종료 코드 2를 낸다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {checkStructure,findImports,matchGlob,parseConfig} from '../tools/check-structure.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const TOOL=path.join(ROOT,'tools','check-structure.mjs');
const TEMPLATE=JSON.parse(fs.readFileSync(path.join(ROOT,'templates','design','structure.json'),'utf8'));

function repo(t,files={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-structure-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 for(const [f,text] of Object.entries(files)){
  fs.mkdirSync(path.dirname(path.join(dir,f)),{recursive:true});
  fs.writeFileSync(path.join(dir,f),text);
 }
 return dir;
}
const run=(dir,...args)=>spawnSync(process.execPath,[TOOL,...args],{cwd:dir,encoding:'utf8'});
const found=(dir,config=TEMPLATE)=>checkStructure(dir,config).violations.map(v=>`${v.file}:${v.line}`);

test('글롭: **는 여러 단계(0단계 포함), *는 한 단계 안',()=>{
 assert.ok(matchGlob('prototype/src/rules/**/*.ts','prototype/src/rules/contract.ts'));
 assert.ok(matchGlob('prototype/src/rules/**/*.ts','prototype/src/rules/a/b/c.ts'));
 assert.ok(!matchGlob('prototype/src/rules/*.ts','prototype/src/rules/a/c.ts'));
 assert.ok(matchGlob('**/*.test.ts','prototype/src/rules/contract.test.ts'));
 assert.ok(matchGlob('prototype/src/scenes/**','prototype/src/scenes/Board'));
 assert.ok(!matchGlob('prototype/src/scenes/**','prototype/src/scenesX/Board'));
});

test('import: 패키지·상대 경로·여러 줄·동적 import·다시 내보내기·require를 줄 번호와 함께 찾고, 주석 줄은 건너뛴다',()=>{
 const text=[
  "import Phaser from 'phaser';",            // 1
  "import type {A} from '../data/types';",   // 2
  'import {',                                // 3
  '  b,',
  '} from "../scenes/Board";',
  "import 'phaser/side-effect';",            // 6
  "const m = await import('../ui/hud');",    // 7
  "export * from '../scenes/x';",            // 8
  "export {c} from '../ui/y';",              // 9
  "const r = require('phaser');",            // 10
  "// import x from 'phaser';"               // 11
 ].join('\r\n');
 assert.deepEqual(findImports(text).map(i=>`${i.line}:${i.spec}`),
  ['1:phaser','2:../data/types','3:../scenes/Board','6:phaser/side-effect','7:../ui/hud','8:../scenes/x','9:../ui/y','10:phaser']);
});

test('템플릿 규칙: 화면 코드·phaser import, 난수·시계, @ts-ignore, Godot 장면 노드·장면 트리·난수를 잡는다',t=>{
 const dir=repo(t,{
  'prototype/src/rules/bad.ts':[
   "import Phaser from 'phaser';",
   "import {Board} from '../scenes/Board';",
   "import {draw} from '../ui/hud';",
   "import type {A} from '../data/types';",
   'const r = Math.random();',
   'const t = Date.now();',
   '// @ts-ignore',
   '// Math.random() 주석은 건너뜀',
   "export * from 'phaser/types';"
  ].join('\n'),
  'prototype/src/rules/bad.test.ts':'const r = Math.random();\n',
  'prototype/src/scenes/Board.ts':"import Phaser from 'phaser';\nMath.random();\n",
  'scripts/rules/bad_rules.gd':['extends Node2D','## randf() 주석','var n = get_node("Hud")','var m = $Hud','var x = randf()','var s = load("res://scenes/main.tscn")'].join('\n')
 });
 assert.deepEqual(found(dir),[
  'prototype/src/rules/bad.ts:1','prototype/src/rules/bad.ts:2','prototype/src/rules/bad.ts:3',
  'prototype/src/rules/bad.ts:5','prototype/src/rules/bad.ts:6','prototype/src/rules/bad.ts:7','prototype/src/rules/bad.ts:9',
  'scripts/rules/bad_rules.gd:1','scripts/rules/bad_rules.gd:3','scripts/rules/bad_rules.gd:4','scripts/rules/bad_rules.gd:5','scripts/rules/bad_rules.gd:6'
 ],'테스트 파일(exclude)·규칙 폴더 밖·주석 줄·허용한 import는 보지 않는다');
 const r=run(dir,'design/structure.json','--root',dir);
 assert.equal(r.status,2,'설정 파일이 없으면 2');
 fs.mkdirSync(path.join(dir,'design'));
 fs.writeFileSync(path.join(dir,'design','structure.json'),JSON.stringify(TEMPLATE));
 const v=run(dir,'design/structure.json');
 assert.equal(v.status,1);
 assert.match(v.stdout,/prototype\/src\/rules\/bad\.ts:5: \[prototype-rules\] 난수는 인자로 받는다/);
 assert.match(v.stdout,/prototype\/src\/rules\/bad\.ts:2: \[prototype-rules\] '\.\.\/scenes\/Board'를 가져옴\(금지: prototype\/src\/scenes\/\*\*\)/);
});

test('in_comments가 없으면 주석 줄은 보지 않는다',t=>{
 const dir=repo(t,{'r/a.ts':'// @ts-ignore\nconst x = 1;\n'});
 const layer=in_comments=>({version:1,layers:[{name:'r',files:['r/*.ts'],forbid_patterns:[{pattern:'@ts-ignore',why:'고칠 것',...(in_comments?{in_comments}:{})}]}]});
 assert.deepEqual(found(dir,layer(false)),[]);
 assert.deepEqual(found(dir,layer(true)),['r/a.ts:1']);
});

test('템플릿을 그대로 깐 저장소는 통과하고, 파일이 없는 층은 경고만 낸다',t=>{
 const dir=repo(t);
 fs.cpSync(path.join(ROOT,'templates','phaser'),path.join(dir,'prototype'),{recursive:true});
 fs.cpSync(path.join(ROOT,'templates','godot','scripts'),path.join(dir,'scripts'),{recursive:true});
 fs.mkdirSync(path.join(dir,'design'));
 fs.copyFileSync(path.join(ROOT,'templates','design','structure.json'),path.join(dir,'design','structure.json'));
 const r=run(dir,'design/structure.json');
 assert.equal(r.status,0,r.stdout+r.stderr);
 const empty=repo(t,{'design/structure.json':JSON.stringify(TEMPLATE)});
 const e=run(empty,'design/structure.json');
 assert.equal(e.status,0);
 assert.match(e.stderr,/경고: prototype-rules: .*맞는 파일이 없음/);
});

test('설정 형식 오류·정규식 오류·JSON 오류는 종료 코드 2',t=>{
 const base={version:1,layers:[{name:'r',files:['r/*.ts'],forbid_patterns:[{pattern:'x',why:'y'}]}]};
 assert.doesNotThrow(()=>parseConfig(base));
 for(const [bad,msg] of [
  [{...base,version:2},/version/],
  [{...base,layers:[]},/layers/],
  [{...base,layers:[{...base.layers[0],files:[]}]},/files/],
  [{...base,layers:[{...base.layers[0],typo:1}]},/알 수 없는 필드: typo/],
  [{...base,layers:[{name:'r',files:['r/*.ts']}]},/forbid_imports나 forbid_patterns/],
  [{...base,layers:[{...base.layers[0],forbid_patterns:[{pattern:'(',why:'y'}]}]},/정규식 오류/],
  [{...base,layers:[{...base.layers[0],forbid_patterns:[{pattern:'x'}]}]},/why 필요/]
 ]){
  assert.throws(()=>parseConfig(bad),msg);
  const dir=repo(t,{'s.json':JSON.stringify(bad)});
  assert.equal(run(dir,'s.json').status,2,JSON.stringify(bad));
 }
 assert.equal(run(repo(t,{'s.json':'{'}),'s.json').status,2);
 assert.equal(run(repo(t),'a.json','--fix').status,2,'모르는 인자');
});
