// 진입점 판정 테스트. ~/.claude/skills/hf-game-studio 같은 심볼릭 링크(정션) 경로로 실행해도 CLI가 돈다.
// Node는 import.meta.url을 실제 경로로 풀지만 process.argv[1]은 링크 경로 그대로라, 둘을 그냥 비교하면 아무것도 하지 않고 끝났다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ENTRIES=[...fs.readdirSync(path.join(ROOT,'scripts')).map(f=>'scripts/'+f),...fs.readdirSync(path.join(ROOT,'tools')).map(f=>'tools/'+f)]
 .filter(f=>f.endsWith('.mjs')&&/process\.argv\[1\]/.test(fs.readFileSync(path.join(ROOT,f),'utf8')));

test('진입점은 모두 argv[1]을 실제 경로로 풀어 비교한다',()=>{
 assert.ok(ENTRIES.length>=10,ENTRIES.join(','));
 for(const f of ENTRIES){
  const text=fs.readFileSync(path.join(ROOT,f),'utf8');
  assert.ok(!/pathToFileURL\(process\.argv\[1\]\)/.test(text),`${f}: argv[1]을 그대로 비교함`);
  assert.match(text,/pathToFileURL\(fs\.realpathSync\(process\.argv\[1\]\)\)/,f);
 }
});

test('링크 경로로 실행해도 CLI가 돈다(사용법 오류를 낸다)',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-link-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const link=path.join(dir,'hf-game-studio');
 fs.symlinkSync(ROOT,link,process.platform==='win32'?'junction':'dir');
 for(const f of ['scripts/task.mjs','tools/check-structure.mjs']){
  const r=spawnSync(process.execPath,[path.join(link,f)],{encoding:'utf8'});
  assert.notEqual(r.status,0,`${f}: 링크로 실행하면 아무것도 안 하고 0으로 끝남`);
  assert.match(r.stderr,/사용법/,f);
 }
});
