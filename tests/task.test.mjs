// 작업 컨트롤러 테스트. 예시 작업 파일이 모두 plan을 통과하고, 위험한 입력은 거절되고,
// start(red-first)와 verify(검사·범위·기준 파일 불변)가 실제 git 저장소에서 기대대로 동작하는지 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {plan,start,check,verify,acTable,pipelineDirectives,loadKinds,roleDirectives,quote,sections,dirtyPaths,hashFiles,stateFile,LARGE_DOC_BYTES,STUDIO_ROOT} from '../scripts/task.mjs';

const example=name=>JSON.parse(fs.readFileSync(path.join(STUDIO_ROOT,'examples','tasks',name)));
const VERIFIES=['schema','dialogue','assets','screenshot'];

// 설계 문서만 있는 폴더(plan용). git은 없다.
function repoWithDocs(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-'));
 fs.mkdirSync(path.join(dir,'design'));
 fs.writeFileSync(path.join(dir,'design','glossary.md'),'# 용어집\n');
 fs.copyFileSync(path.join(STUDIO_ROOT,'templates','design','gdd.md'),path.join(dir,'design','gdd.md'));
 fs.mkdirSync(path.join(dir,'design','refs'));
 fs.writeFileSync(path.join(dir,'design','refs','merc.png'),'');
 return dir;
}
// 커밋이 있는 git 저장소에 설계 템플릿과 검사 도구를 깐 것(start·verify용). 상태는 임시 HFGS_HOME에 둔다.
function gameRepo(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-game-'));
 const git=(...a)=>execFileSync('git',['-C',dir,...a],{stdio:'pipe'});
 git('init','-q');git('config','user.email','t@example.invalid');git('config','user.name','t');
 fs.cpSync(path.join(STUDIO_ROOT,'templates','design'),path.join(dir,'design'),{recursive:true});
 fs.cpSync(path.join(STUDIO_ROOT,'tools'),path.join(dir,'tools','hfgs'),{recursive:true});
 git('add','.');git('commit','-q','-m','init');
 const env={...process.env,HFGS_HOME:fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-home-'))};
 t?.after(()=>{fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(env.HFGS_HOME,{recursive:true,force:true});});
 return {dir,git,env};
}
const ASH='{"version":1,"mercenaries":[{"id":"ash","name":"애쉬","hire_cost":100,"stats":{"might":5,"wits":5,"grit":5}}]}';

test('모든 kind는 owner·verify·역할 파일이 올바르다',()=>{
 for(const [name,k] of Object.entries(loadKinds().kinds)){
  assert.ok(['claude','asset-pipeline'].includes(k.owner),`${name}: owner`);
  assert.ok(k.verify===undefined||VERIFIES.includes(k.verify),`${name}: verify ${k.verify}`);
  assert.ok(k.writer===undefined||k.writer==='argon',`${name}: writer`);
  if(k.role)assert.ok(roleDirectives(k.role).length>0,`${name}: 역할 지시문 없음`);
  assert.ok(!('task_kind' in k)&&!('allowed_actions' in k)&&!('constraints' in k),`${name}: hyperfusion 필드가 남아 있음`);
 }
});

test('예시 작업 파일은 모두 plan을 통과한다',()=>{
 const repo=repoWithDocs();
 for(const f of fs.readdirSync(path.join(STUDIO_ROOT,'examples','tasks')))assert.doesNotThrow(()=>plan(example(f),{repo}),f);
});

test('balance-data: 스키마 검사, @auto 매핑, 읽기 지시, 역할 규칙',()=>{
 const repo=repoWithDocs(),warnings=[];
 const p=plan(example('merc-data.json'),{repo,warn:m=>warnings.push(m)});
 assert.equal(p.owner,'claude');
 assert.equal(p.writer,undefined);
 assert.deepEqual(p.acceptance_commands,['node tools/hfgs/validate-data.mjs design/schemas/mercenaries.schema.json data/mercenaries.json']);
 assert.deepEqual(p.acceptance_map,{AC1:p.acceptance_commands});
 assert.deepEqual(p.criteria_files,['design/schemas/mercenaries.schema.json']);
 assert.ok(p.rules.some(c=>c.startsWith('Role systems-designer:')));
 assert.ok(p.reading.includes('Read in full: design/glossary.md.'));
 assert.ok(p.reading.some(c=>/^Read only these sections of design\/gdd\.md: "규칙" lines \d+-\d+, "수치와 공식" lines \d+-\d+\./.test(c)));
 assert.ok(warnings.some(w=>w.includes('design/world.md')),'없는 문서는 경고');
});

test('narrative: Argon 작가 brief와 dialogue-to-dtl --check 하나',()=>{
 const p=plan(example('contract-intro-dialogue.json'),{repo:repoWithDocs()});
 assert.equal(p.owner,'claude');
 assert.equal(p.writer,'argon');
 assert.deepEqual(p.acceptance_commands,['node tools/hfgs/dialogue-to-dtl.mjs data/dialogue/contract-grain-cart.json --schema design/schemas/dialogue.schema.json --check']);
 assert.deepEqual(p.acceptance_map,{AC1:p.acceptance_commands,AC2:p.acceptance_commands});
 assert.deepEqual(p.criteria_files,['design/schemas/dialogue.schema.json','design/glossary.md']);
 assert.equal(p.write_brief.format,'json');
 assert.match(p.write_brief.structure,/design\/schemas\/dialogue\.schema\.json/);
 assert.match(p.write_brief.style,/^Role writer:/);
 assert.deepEqual(p.write_brief.context_docs,['design/glossary.md','design/gdd.md']);
});

test('narrative: 용어집은 검사 기준이라 범위 안에 못 두고, glossary를 적으면 --glossary로 넘긴다',()=>{
 const repo=repoWithDocs(),g=example('contract-intro-dialogue.json');
 assert.throws(()=>plan({...g,scope:{paths:[...g.scope.paths,'design/glossary.md']}},{repo}),/design\/glossary\.md\)이 scope\.paths에 있음/);
 assert.throws(()=>plan({...g,glossary:'design/cast.md',scope:{paths:[...g.scope.paths,'design/cast.md']}},{repo}),/design\/cast\.md\)이 scope\.paths에 있음/);
 assert.throws(()=>plan({...g,expect:{'/id':'x'}},{repo}),/expect는 schema 검사 작업/);
 const p=plan({...g,glossary:'design/cast.md'},{repo});
 assert.match(p.acceptance_commands[0],/ --glossary design\/cast\.md --check$/);
 assert.ok(p.criteria_files.includes('design/cast.md'));
});

test('art-image: asset_pipeline 필수, 매니페스트 검사는 파일별 --only, 리드에게 주는 MCP 절차',()=>{
 const warnings=[],p=plan(example('merc-portrait-pipeline.json'),{repo:repoWithDocs(),warn:m=>warnings.push(m)});
 assert.equal(p.owner,'asset-pipeline');
 assert.deepEqual(p.acceptance_commands,['node tools/hfgs/check-assets.mjs design/asset-manifest.json --only assets/portraits/merc-ash.png']);
 for(const d of pipelineDirectives({project_id:'merc-guild',output_class:'NONPIXEL_IMAGE'},{classes:['NONPIXEL_IMAGE']}))assert.ok(p.rules.includes(d));
 assert.ok(p.rules.some(c=>c.includes('project_id "merc-guild", requested_output_type "NONPIXEL_IMAGE"')));
 assert.ok(p.rules.some(c=>c.includes('stop and ask the user')),'일꾼 표현(needs_decision)이 아니라 리드에게 말한다');
 assert.ok(!warnings.some(w=>/Luna|executor/.test(w)),'일꾼 배치 경고는 없다');
 const {asset_pipeline,...without}=example('merc-portrait-pipeline.json');
 assert.throws(()=>plan(without,{repo:repoWithDocs()}),/art-image 작업은 asset_pipeline이 필요함.*그림을 그릴 수 없어/);
});

test('asset_pipeline 폴링: STARTING과 RUNNING을 모두 기다린다',()=>{
 const poll=pipelineDirectives({project_id:'a',output_class:'NONPIXEL_IMAGE'},{classes:['NONPIXEL_IMAGE']}).find(d=>d.includes('asset_inspect_run until'));
 assert.match(poll,/no longer STARTING or RUNNING/);
});

test('sfx: asset_pipeline 필수, WAV 매니페스트 검사, 길이 전달',()=>{
 const p=plan(example('sword-swing-sfx.json'),{repo:repoWithDocs()});
 assert.equal(p.owner,'asset-pipeline');
 assert.deepEqual(p.acceptance_commands,['node tools/hfgs/check-assets.mjs design/asset-manifest.json --only assets/sfx/sword-swing.wav']);
 assert.ok(p.rules.some(c=>c.startsWith('Role sound-designer:')));
 assert.ok(p.rules.some(c=>c.includes('requested_output_type "SFX", duration_seconds 1.5')));
 assert.ok(p.rules.some(c=>c.includes('copy the produced PCM WAV')));
 const {asset_pipeline,...without}=example('sword-swing-sfx.json');
 assert.throws(()=>plan(without,{repo:repoWithDocs()}),/sfx 작업은 asset_pipeline이 필요함.*소리를 합성/);
 const sp=example('sword-swing-sfx.json');
 assert.throws(()=>plan({...sp,asset_pipeline:{...sp.asset_pipeline,workflow_id:'codex_imagegen',reference_image:'design/refs/merc.png'}},{repo:repoWithDocs()}),/이미지 작업에만/);
});

test('asset_pipeline: 종류별 output_class만 허용하고 PIXEL_STATIC은 경고',()=>{
 const g=example('merc-portrait-pipeline.json'),s=example('sword-swing-sfx.json'),repo=repoWithDocs();
 assert.throws(()=>plan({...g,asset_pipeline:{project_id:'a',output_class:'SFX'}},{repo}),/NONPIXEL_IMAGE, PIXEL_STATIC 중 하나: SFX/);
 assert.throws(()=>plan({...s,asset_pipeline:{project_id:'a',output_class:'NONPIXEL_IMAGE'}},{repo}),/SFX 중 하나/);
 assert.throws(()=>plan({...g,asset_pipeline:{project_id:'a',output_class:'NONPIXEL_IMAGE',duration_seconds:1}},{repo}),/SFX에만/);
 for(const d of [0,-1,'2',null])assert.throws(()=>plan({...s,asset_pipeline:{...s.asset_pipeline,duration_seconds:d}},{repo}),/0보다 큰/);
 const warnings=[];
 plan({...g,asset_pipeline:{project_id:'a',output_class:'PIXEL_STATIC'}},{repo,warn:m=>warnings.push(m)});
 assert.ok(warnings.some(w=>w.includes('Pixel Gate')));
});

test('asset_pipeline: 쓸 수 없는 작업, 잘못된 project_id, 모르는 필드는 거절',()=>{
 const g=example('merc-portrait-pipeline.json'),ok={output_class:'NONPIXEL_IMAGE'},repo=repoWithDocs();
 assert.throws(()=>plan({...example('merc-data.json'),asset_pipeline:{project_id:'a',...ok}},{repo}),/art-image·art-edit·sfx 작업에만/);
 assert.throws(()=>plan({...g,asset_pipeline:{project_id:'../x',...ok}},{repo}),/project_id/);
 assert.throws(()=>plan({...g,asset_pipeline:{project_id:'a'}},{repo}),/output_class/);
 assert.throws(()=>plan({...g,asset_pipeline:{project_id:'a',...ok,provider:'grok'}},{repo}),/알 수 없는 필드: provider/);
 assert.throws(()=>plan({...g,asset_pipeline:'merc-guild'},{repo}),/형식/);
});

test('art-edit: 참조 이미지와 workflow_id가 필수이고, 참조는 검사 기준 파일이다',()=>{
 const repo=repoWithDocs(),g=example('merc-portrait-variant.json'),ap=g.asset_pipeline;
 const p=plan(g,{repo});
 assert.ok(p.rules.some(c=>c.includes('"id": "codex_imagegen", "allow_experimental": true')));
 assert.ok(p.rules.some(c=>c.includes(`reference_image "${path.join(repo,'design','refs','merc.png')}"`)));
 assert.ok(p.criteria_files.includes('design/refs/merc.png'));
 assert.throws(()=>plan({...g,asset_pipeline:{project_id:ap.project_id,output_class:ap.output_class}},{repo}),/art-edit 작업은 asset_pipeline\.reference_image/);
 assert.throws(()=>plan({...g,asset_pipeline:{...ap,workflow_id:undefined}},{repo}),/workflow_id가 필요/);
 assert.throws(()=>plan({...g,asset_pipeline:{...ap,reference_image:'design/refs/none.png'}},{repo}),/reference_image가 없음/);
 assert.throws(()=>plan({...g,asset_pipeline:{...ap,reference_image:path.join(repo,'design','refs','merc.png')}},{repo}),/상대 경로/);
 assert.throws(()=>plan({...g,scope:{paths:[...g.scope.paths,ap.reference_image]}},{repo}),/범위 밖에 둘 것/);
 assert.throws(()=>plan({...g,asset_pipeline:{...ap,workflow_id:'Codex ImageGen'}},{repo}),/워크플로 ID/);
});

test('web-prototype: 서버는 검사 도구가 직접 띄우고, 공백·# 있는 인자는 따옴표로 감싸고, Vitest는 따로 돈다',()=>{
 const p=plan(example('contract-board-ui.json'),{repo:repoWithDocs()});
 assert.equal(p.owner,'claude');
 assert.deepEqual(p.acceptance_commands,['npm --prefix prototype test','node tools/hfgs/screenshot.mjs --serve "npm --prefix prototype run dev" --url http://localhost:5173 --selector "#hud" --expect-text "곡물 수레 호위" --name M1-T4-contract-board']);
 assert.deepEqual(p.acceptance_map,{AC1:[p.acceptance_commands[1]],AC2:[p.acceptance_commands[0]]});
 const g=example('contract-board-ui.json');
 delete g.screenshot.serve;
 assert.throws(()=>plan(g,{repo:repoWithDocs()}),/serve가 없음/);
 g.screenshot.url='https://example.com/game';
 assert.doesNotThrow(()=>plan(g,{repo:repoWithDocs()}),'원격 주소는 serve 없이 허용');
});

test('expect는 --expect 인자로 들어가고, 이미 있는 파일을 형식 검사만으로 고치면 red-first 경고',()=>{
 const repo=repoWithDocs(),warnings=[];
 const p=plan({...example('merc-data.json'),expect:{'/mercenaries/[id=ash]/hire_cost':120,'/mercenaries/[id=ash]/name':'애쉬'}},{repo});
 assert.equal(p.acceptance_commands[0],'node tools/hfgs/validate-data.mjs design/schemas/mercenaries.schema.json data/mercenaries.json --expect "/mercenaries/[id=ash]/hire_cost=120" --expect "/mercenaries/[id=ash]/name=\\"애쉬\\""');
 assert.throws(()=>plan({...example('merc-data.json'),expect:{'hire_cost':1}},{repo}),/\/로 시작/);
 fs.mkdirSync(path.join(repo,'data'));
 fs.writeFileSync(path.join(repo,'data','mercenaries.json'),'{}');
 plan(example('merc-data.json'),{repo,warn:m=>warnings.push(m)});
 assert.ok(warnings.some(w=>w.includes('ACCEPTANCE_ALREADY_GREEN')));
 warnings.length=0;
 plan({...example('merc-data.json'),expect:{'/version':2}},{repo,warn:m=>warnings.push(m)});
 assert.ok(!warnings.some(w=>w.includes('ACCEPTANCE_ALREADY_GREEN')),'expect가 있으면 경고하지 않음');
});

test('필수 입력·AC 형식·검사 기준 범위를 확인한다',()=>{
 const g=example('merc-data.json'),repo=repoWithDocs();
 assert.throws(()=>plan({...g,schema:undefined},{repo}),/schema가 필요/);
 assert.throws(()=>plan({...g,kind:'audio'},{repo}),/알 수 없는 kind/);
 assert.throws(()=>plan({...g,success_criteria:['데이터를 만든다']},{repo}),/AC1/);
 assert.throws(()=>plan({...g,acceptance_map:{AC9:['@auto']}},{repo}),/success_criteria에 없음/);
 assert.throws(()=>plan({...g,scope:{paths:[...g.scope.paths,g.schema]}},{repo}),/scope\.paths에 있음/);
 assert.ok(!plan({...g,role:null},{repo}).rules.some(c=>c.startsWith('Role ')),'role:null이면 역할 규칙을 넣지 않는다');
});

test('quote·sections',()=>{
 assert.equal(quote('data/a.json'),'data/a.json');
 assert.equal(quote('a b'),'"a b"');
 const t='# A\n\n## B\ntext\n```\n# not\n```\n### C\n## D\nx\n';
 assert.deepEqual(sections(t).map(x=>[x.title,x.start,x.end]),[['A',1,10],['B',3,8],['C',8,8],['D',9,10]]);
});

test('context_sections: 실제 줄 범위, 없는 섹션·문서·형식 거절, 큰 문서 경고',()=>{
 const repo=repoWithDocs(),g=example('merc-data.json'),gdd=fs.readFileSync(path.join(repo,'design','gdd.md'),'utf8');
 const want=sections(gdd).find(x=>x.title==='수치와 공식');
 const p=plan({...g,context_docs:[],context_sections:{'design/gdd.md':['수치와 공식']}},{repo});
 assert.ok(p.reading.some(c=>c.includes(`"수치와 공식" lines ${want.start}-${want.end}`)));
 assert.ok(!p.reading.some(c=>c.startsWith('Read in full')));
 assert.throws(()=>plan({...g,context_sections:{'design/gdd.md':['없는 섹션']}},{repo}),/"없는 섹션" 섹션이 없음.*수치와 공식/);
 assert.throws(()=>plan({...g,context_sections:{'design/none.md':['A']}},{repo}),/문서가 없음/);
 assert.throws(()=>plan({...g,context_sections:{'design/gdd.md':'규칙'}},{repo}),/형식/);
 const warnings=[];
 fs.writeFileSync(path.join(repo,'design','world.md'),'# 세계관\n'+'가'.repeat(LARGE_DOC_BYTES));
 const big=plan({...g,context_sections:undefined},{repo,warn:m=>warnings.push(m)});
 assert.ok(big.reading.some(c=>c.startsWith('design/world.md is large')&&c.includes('Never read the whole file')));
 assert.ok(warnings.some(w=>w.includes('design/world.md')&&w.includes('context_sections')));
});

// ── start / verify: 실제 git 저장소 ──

test('start: 새 파일을 만드는 작업은 red-first를 통과하고 작업 전 상태를 기록한다',t=>{
 const {dir,env}=gameRepo(t);
 const {state,file}=start(example('merc-data.json'),{repo:dir,env});
 assert.equal(file,stateFile('M1-T1-merc-data',env));
 assert.deepEqual(state.baseline.red,['node tools/hfgs/validate-data.mjs design/schemas/mercenaries.schema.json data/mercenaries.json']);
 assert.deepEqual(state.dirty_before,{});
 assert.ok(/^[0-9a-f]{64}$/.test(state.criteria_before['design/schemas/mercenaries.schema.json']));
 assert.throws(()=>start(example('merc-data.json'),{repo:dir,env}),/이미 시작한 작업/);
 assert.doesNotThrow(()=>start(example('merc-data.json'),{repo:dir,env,restart:true}));
});

test('start: 이미 통과하는 검사는 ACCEPTANCE_ALREADY_GREEN, expect나 baseline_green이면 진행',t=>{
 const {dir,git,env}=gameRepo(t);
 fs.mkdirSync(path.join(dir,'data'));fs.writeFileSync(path.join(dir,'data','mercenaries.json'),ASH);
 git('add','.');git('commit','-q','-m','ash');
 assert.throws(()=>start(example('merc-data.json'),{repo:dir,env}),/ACCEPTANCE_ALREADY_GREEN/);
 const expect={...example('merc-data.json'),expect:{'/mercenaries/[id=ash]/hire_cost':120}};
 assert.equal(start(expect,{repo:dir,env}).state.baseline.red.length,1,'바뀔 값을 적으면 수정 전에는 실패');
 const warnings=[];
 const s=start({...example('merc-data.json'),task_id:'refactor',baseline_green:'형식만 바꾸는 리팩터'},{repo:dir,env,warn:m=>warnings.push(m)});
 assert.equal(s.state.baseline.green_reason,'형식만 바꾸는 리팩터');
 assert.ok(warnings.some(w=>w.includes('처음부터 통과')));
});

test('verify: 검사 통과 + 범위 안 변경이면 통과하고 리뷰 명령을 준다',t=>{
 const {dir,env}=gameRepo(t),task=example('merc-data.json');
 assert.throws(()=>verify(task,{repo:dir,env}),/시작 기록이 없음/);
 const {state}=start(task,{repo:dir,env});
 fs.mkdirSync(path.join(dir,'data'));fs.writeFileSync(path.join(dir,'data','mercenaries.json'),ASH);
 const warnings=[],r=verify(task,{repo:dir,env,warn:m=>warnings.push(m)});
 assert.equal(r.ok,true,JSON.stringify(r.errors)+JSON.stringify(r.failed));
 assert.ok(!warnings.some(w=>w.includes('ACCEPTANCE_ALREADY_GREEN')),'verify에서는 red-first 경고를 내지 않는다');
 assert.deepEqual(r.changed,['data/mercenaries.json']);
 assert.deepEqual(r.ac.map(a=>a.status),['pass','manual']);
 assert.match(r.review_command,new RegExp(`consult\\.mjs review --repo ${dir} --base ${state.head} --criteria "AC1: .*" --criteria "AC2: .*" --check "node tools/hfgs/validate-data\\.mjs .*"$`));
 const saved=JSON.parse(fs.readFileSync(stateFile(task.task_id,env),'utf8'));
 assert.equal(saved.verify.ok,true);
 assert.throws(()=>start(task,{repo:dir,env}),/이미 끝난 작업/);
});

test('verify: 검사 실패, 범위 밖 변경, 검사 기준 파일 변경을 각각 잡는다',t=>{
 const {dir,env}=gameRepo(t),task=example('merc-data.json');
 start(task,{repo:dir,env});
 fs.mkdirSync(path.join(dir,'data'));
 fs.writeFileSync(path.join(dir,'data','mercenaries.json'),'{"version":1,"mercenaries":[]}');
 let r=verify(task,{repo:dir,env});
 assert.equal(r.ok,false);
 assert.equal(r.failed.length,1);
 assert.deepEqual(r.ac.map(a=>a.status),['fail','manual']);
 fs.writeFileSync(path.join(dir,'data','mercenaries.json'),ASH);
 fs.writeFileSync(path.join(dir,'src.js'),'x');
 r=verify(task,{repo:dir,env});
 assert.equal(r.failed.length,0);
 assert.match(r.errors.join('\n'),/범위 밖 변경: src\.js/);
 assert.equal(verify({...task,allow_out_of_scope:['src.js']},{repo:dir,env}).ok,true,'allow_out_of_scope로 허용');
 fs.rmSync(path.join(dir,'src.js'));
 fs.appendFileSync(path.join(dir,'design','schemas','mercenaries.schema.json'),'\n');
 r=verify(task,{repo:dir,env});
 assert.match(r.errors.join('\n'),/검사 기준 파일이 바뀜: design\/schemas\/mercenaries\.schema\.json/);
});

test('verify: 작업 전부터 바뀌어 있던 파일은 더 바뀌었을 때만 이 작업의 변경으로 본다',t=>{
 const {dir,env}=gameRepo(t),task=example('merc-data.json'),warnings=[];
 fs.writeFileSync(path.join(dir,'notes.md'),'before');
 start(task,{repo:dir,env,warn:m=>warnings.push(m)});
 assert.ok(warnings.some(w=>w.includes('작업 전에 바뀐 파일 1개')));
 fs.mkdirSync(path.join(dir,'data'));fs.writeFileSync(path.join(dir,'data','mercenaries.json'),ASH);
 assert.equal(verify(task,{repo:dir,env}).ok,true,'그대로면 범위 밖이 아니다');
 fs.writeFileSync(path.join(dir,'notes.md'),'after');
 assert.match(verify(task,{repo:dir,env}).errors.join('\n'),/범위 밖 변경: notes\.md/);
});

test('check·acTable·dirtyPaths·hashFiles',t=>{
 const {dir,git,env}=gameRepo(t),task=example('merc-data.json');
 assert.equal(check(task,{repo:dir}).ok,false);
 fs.mkdirSync(path.join(dir,'data'));fs.writeFileSync(path.join(dir,'data','mercenaries.json'),ASH);
 assert.equal(check(task,{repo:dir}).ok,true);
 fs.writeFileSync(path.join(dir,'한글 이름.txt'),'x');
 git('mv','design/world.md','design/세계관.md');
 const dirty=dirtyPaths(dir);
 assert.ok(dirty.includes('한글 이름.txt')&&dirty.includes('design/세계관.md')&&!dirty.includes('design/world.md'),JSON.stringify(dirty));
 assert.deepEqual(hashFiles(dir,['none.txt']),{'none.txt':null});
 const p=plan(task,{repo:dir});
 assert.deepEqual(acTable(p,[{command:p.acceptance_commands[0],exit_code:0}]).map(a=>a.status),['pass','manual']);
 assert.deepEqual(acTable({...p,acceptance_map:undefined},[]).map(a=>a.status),['manual','manual']);
});
