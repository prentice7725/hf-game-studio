// 설치 스크립트 테스트.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {install} from '../scripts/setup.mjs';

function gitRepo(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-setup-'));
 fs.mkdirSync(path.join(dir,'.git'));
 return dir;
}

test('Git 저장소가 아니면 거절',()=>{
 assert.throws(()=>install(fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-'))),/Git 저장소가 아님/);
});

test('처음 설치는 도구·문서·스킬을 깔고 hyperfusion 설정은 만들지 않는다',()=>{
 const repo=gitRepo(),done=install(repo,{log:()=>{}});
 for(const f of ['tools/hfgs/validate-data.mjs','tools/hfgs/check-assets.mjs','tools/hfgs/dialogue-to-dtl.mjs','tools/hfgs/screenshot.mjs',
  'design/glossary.md','design/schemas/dialogue.schema.json','design/asset-manifest.json','.claude/skills/gs-balance-check/SKILL.md'])
  assert.ok(done.includes(f),f);
 assert.ok(!fs.existsSync(path.join(repo,'hyperfusion.config.json')));
});

test('있는 파일은 덮어쓰지 않고, --force도 문서는 건드리지 않으며, 남은 v1 설정은 알려만 준다',()=>{
 const repo=gitRepo(),logs=[];
 install(repo,{log:()=>{}});
 fs.writeFileSync(path.join(repo,'hyperfusion.config.json'),'{"mine":true}');
 fs.writeFileSync(path.join(repo,'design','gdd.md'),'내 GDD');
 fs.writeFileSync(path.join(repo,'tools','hfgs','validate-data.mjs'),'old');
 assert.deepEqual(install(repo,{log:m=>logs.push(m)}),[]);
 assert.ok(logs.some(l=>l.includes('hyperfusion.config.json은 v2에서 쓰지 않음')));
 const forced=install(repo,{force:true,log:()=>{}});
 assert.ok(forced.includes('tools/hfgs/validate-data.mjs'));
 assert.equal(fs.readFileSync(path.join(repo,'hyperfusion.config.json'),'utf8'),'{"mine":true}','지우지 않는다');
 assert.equal(fs.readFileSync(path.join(repo,'design','gdd.md'),'utf8'),'내 GDD');
});
