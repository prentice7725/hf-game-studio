// 설치 스크립트와 프리셋 테스트.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {install} from '../scripts/setup.mjs';
import {STUDIO_ROOT} from '../scripts/brief.mjs';

function gitRepo(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-setup-'));
 fs.mkdirSync(path.join(dir,'.git'));
 return dir;
}

test('Git 저장소가 아니면 거절',()=>{
 assert.throws(()=>install(fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-'))),/Git 저장소가 아님/);
});

test('처음 설치는 프리셋·도구·문서·스킬을 깐다',()=>{
 const repo=gitRepo(),done=install(repo,{log:()=>{}});
 for(const f of ['hyperfusion.config.json','tools/hfgs/validate-data.mjs','tools/hfgs/check-assets.mjs','tools/hfgs/screenshot.mjs',
  'design/glossary.md','design/schemas/dialogue.schema.json','design/asset-manifest.json','.claude/skills/gs-balance-check/SKILL.md'])
  assert.ok(done.includes(f),f);
});

test('있는 파일은 덮어쓰지 않고, --force도 설정·문서는 건드리지 않는다',()=>{
 const repo=gitRepo();
 install(repo,{log:()=>{}});
 fs.writeFileSync(path.join(repo,'hyperfusion.config.json'),'{"mine":true}');
 fs.writeFileSync(path.join(repo,'design','gdd.md'),'내 GDD');
 fs.writeFileSync(path.join(repo,'tools','hfgs','validate-data.mjs'),'old');
 assert.deepEqual(install(repo,{log:()=>{}}),[]);
 const forced=install(repo,{force:true,log:()=>{}});
 assert.ok(forced.includes('tools/hfgs/validate-data.mjs'));
 assert.equal(fs.readFileSync(path.join(repo,'hyperfusion.config.json'),'utf8'),'{"mine":true}');
 assert.equal(fs.readFileSync(path.join(repo,'design','gdd.md'),'utf8'),'내 GDD');
});

test('프리셋: 문서·UI는 Antigravity(Gemini Argon) 먼저, 이미지는 Grok 먼저',()=>{
 const c=JSON.parse(fs.readFileSync(path.join(STUDIO_ROOT,'presets','hyperfusion.config.json')));
 const first=kind=>c.routing.rules.find(r=>r.kind===kind).executors[0];
 assert.equal(c.executors.antigravity.model,'gemini-4-argon');
 assert.equal(first('docs'),'antigravity');
 assert.equal(first('ui'),'antigravity');
 assert.equal(first('image-asset'),'grok');
});

// HF_SKILL이 있으면 설치된 hyperfusion의 설정 검증을 통과하는지 본다.
test('프리셋이 hyperfusion 설정 검증 통과(HF_SKILL 있을 때)',{skip:!process.env.HF_SKILL&&'HF_SKILL 없음'},async()=>{
 const {config}=await import(pathToFileURL(path.join(process.env.HF_SKILL,'scripts','executor-config.mjs')).href);
 const repo=gitRepo();
 install(repo,{log:()=>{}});
 assert.equal(config(repo).executors.antigravity.model,'gemini-4-argon');
});
