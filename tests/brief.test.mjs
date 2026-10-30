// 게임 brief 컴파일러 테스트. 예시 brief가 모두 컴파일되고, 위험한 입력은 거절되는지 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {compile,loadKinds,roleDirectives,quote,checkWithHyperfusion,insideRepo,defaultOut,STUDIO_ROOT} from '../scripts/brief.mjs';

const example=name=>JSON.parse(fs.readFileSync(path.join(STUDIO_ROOT,'examples','briefs',name)));
const HF_KINDS=['code','ui','image-asset','tests','refactor','docs'];

function repoWithDocs(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-'));
 fs.mkdirSync(path.join(dir,'design'));
 fs.writeFileSync(path.join(dir,'design','glossary.md'),'# 용어집\n');
 return dir;
}

test('모든 game_kind는 hyperfusion task_kind로 내려가고 역할 파일이 있다',()=>{
 for(const [name,k] of Object.entries(loadKinds().kinds)){
  assert.ok(HF_KINDS.includes(k.task_kind),`${name}: ${k.task_kind}`);
  if(k.role)assert.ok(roleDirectives(k.role).length>0,`${name}: 역할 지시문 없음`);
 }
});

test('balance-data: 스키마 검사와 @auto 매핑',()=>{
 const repo=repoWithDocs(),warnings=[];
 const b=compile(example('merc-data.json'),{repo,warn:m=>warnings.push(m)});
 assert.equal(b.task_kind,'code');
 assert.equal(b.difficulty,'medium');
 assert.deepEqual(b.acceptance_commands,['node tools/hfgs/validate-data.mjs design/schemas/mercenaries.schema.json data/mercenaries.json']);
 assert.deepEqual(b.acceptance_map,{AC1:b.acceptance_commands});
 assert.ok(b.constraints.some(c=>c.startsWith('Role systems-designer:')));
 assert.ok(b.constraints.some(c=>c.includes('Single source of truth: read design/glossary.md')));
 assert.ok(warnings.some(w=>w.includes('design/world.md')),'없는 문서는 경고');
 assert.ok(!('game_kind' in b)&&!('schema' in b),'게임 전용 필드는 hyperfusion brief에 남기지 않는다');
});

test('image-asset: 매니페스트 검사는 파일별 --only',()=>{
 const b=compile(example('merc-portrait.json'),{repo:repoWithDocs()});
 assert.equal(b.task_kind,'image-asset');
 assert.deepEqual(b.acceptance_commands,['node tools/hfgs/check-assets.mjs design/asset-manifest.json --only assets/portraits/merc-ash.png']);
});

test('ui: 서버는 검사 도구가 직접 띄우고, 공백·# 있는 인자는 따옴표로 감싼다',()=>{
 const b=compile(example('contract-board-ui.json'),{repo:repoWithDocs()});
 assert.equal(b.task_kind,'ui');
 assert.equal(b.acceptance_commands[0],'node tools/hfgs/screenshot.mjs --serve "npm run dev" --url http://localhost:5173 --selector "#contract-board" --expect-text "곡물 수레 호위" --name M1-T4-contract-board');
});

test('ui: 로컬 서버 주소에 serve가 없으면 거절(일꾼이 띄운 서버는 검사 때 꺼져 있음)',()=>{
 const g=example('contract-board-ui.json');
 delete g.screenshot.serve;
 assert.throws(()=>compile(g,{repo:repoWithDocs()}),/serve가 없음/);
 assert.throws(()=>compile({...g,screenshot:{...g.screenshot,url:'http://localhost'}},{repo:repoWithDocs()}),/serve가 없음/);
 g.screenshot.url='https://example.com/game';
 assert.doesNotThrow(()=>compile(g,{repo:repoWithDocs()}),'원격 주소는 serve 없이 허용');
});

test('expect는 --expect 인자로 들어간다',()=>{
 const g={...example('merc-data.json'),expect:{'/mercenaries/[id=ash]/hire_cost':120,'/mercenaries/[id=ash]/name':'애쉬'}};
 const b=compile(g,{repo:repoWithDocs()});
 assert.equal(b.acceptance_commands[0],'node tools/hfgs/validate-data.mjs design/schemas/mercenaries.schema.json data/mercenaries.json --expect "/mercenaries/[id=ash]/hire_cost=120" --expect "/mercenaries/[id=ash]/name=\\"애쉬\\""');
 assert.throws(()=>compile({...g,expect:{'hire_cost':1}}),/\/로 시작/);
});

test('이미 있는 파일을 형식 검사만으로 고치면 red-first 경고',()=>{
 const repo=repoWithDocs(),warnings=[];
 fs.mkdirSync(path.join(repo,'data'));
 fs.writeFileSync(path.join(repo,'data','mercenaries.json'),'{}');
 compile(example('merc-data.json'),{repo,warn:m=>warnings.push(m)});
 assert.ok(warnings.some(w=>w.includes('ACCEPTANCE_ALREADY_GREEN')));
 warnings.length=0;
 compile({...example('merc-data.json'),expect:{'/version':2}},{repo,warn:m=>warnings.push(m)});
 assert.ok(!warnings.some(w=>w.includes('ACCEPTANCE_ALREADY_GREEN')),'expect가 있으면 경고하지 않음');
 compile(example('merc-portrait.json'),{repo,warn:m=>warnings.push(m)});
 assert.ok(!warnings.some(w=>w.includes('ACCEPTANCE_ALREADY_GREEN')),'새 파일 생성은 경고하지 않음');
});

test('기본 출력은 저장소 밖, 저장소 안 여부 판정',()=>{
 const repo=repoWithDocs();
 assert.equal(insideRepo(defaultOut('T1'),repo),false);
 assert.equal(insideRepo(path.join(repo,'BRIEF.json'),repo),true);
 assert.equal(insideRepo(repo+'-other/BRIEF.json',repo),false);
});

test('narrative는 docs로, Gemini Argon 우선 배치 대상',()=>{
 const b=compile(example('contract-intro-dialogue.json'),{repo:repoWithDocs()});
 assert.equal(b.task_kind,'docs');
 assert.ok(b.constraints.some(c=>c.startsWith('Role writer:')));
});

test('검사 기준 파일을 일꾼 범위에 넣으면 거절',()=>{
 const g=example('merc-data.json');
 g.scope.paths.push(g.schema);
 assert.throws(()=>compile(g,{repo:repoWithDocs()}),/scope.paths에 있음/);
});

test('필수 입력과 AC 형식을 확인한다',()=>{
 const g=example('merc-data.json');
 assert.throws(()=>compile({...g,schema:undefined}),/schema가 필요/);
 assert.throws(()=>compile({...g,game_kind:'audio'}),/알 수 없는 game_kind/);
 assert.throws(()=>compile({...g,success_criteria:['데이터를 만든다']}),/AC1/);
 assert.throws(()=>compile({...g,acceptance_map:{AC9:['@auto']}}),/success_criteria에 없음/);
});

test('role:null이면 역할 지시문을 넣지 않는다',()=>{
 const b=compile({...example('merc-data.json'),role:null},{repo:repoWithDocs()});
 assert.ok(!b.constraints.some(c=>c.startsWith('Role ')));
});

test('quote는 평범한 경로는 그대로, 공백은 감싼다',()=>{
 assert.equal(quote('data/a.json'),'data/a.json');
 assert.equal(quote('a b'),'"a b"');
});

// HF_SKILL이 있으면 설치된 hyperfusion의 brief 검증까지 통과하는지 본다.
test('hyperfusion brief 검증(HF_SKILL 있을 때)',{skip:!process.env.HF_SKILL&&'HF_SKILL 없음'},async()=>{
 for(const f of fs.readdirSync(path.join(STUDIO_ROOT,'examples','briefs'))){
  assert.equal(await checkWithHyperfusion(compile(example(f),{repo:repoWithDocs()})),true,f);
 }
});
