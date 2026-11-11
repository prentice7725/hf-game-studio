// 실험 카드·조사 노트 lint 테스트. 설계 문서만 있는 임시 폴더에서 돈다(git 불필요).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {lintExperiment,lintResearch,lint,overlaps,EXPERIMENTS_DIR,RESEARCH_DIR} from '../scripts/experiment.mjs';
import {STUDIO_ROOT} from '../scripts/task.mjs';

function repo(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-exp-'));
 fs.mkdirSync(path.join(dir,'design'));
 fs.copyFileSync(path.join(STUDIO_ROOT,'templates','design','gdd.md'),path.join(dir,'design','gdd.md'));
 fs.writeFileSync(path.join(dir,'design','world.md'),'# 세계\n');
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return dir;
}
const put=(dir,rel,doc)=>{
 const file=path.join(dir,rel);
 fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.writeFileSync(file,JSON.stringify(doc,null,2));
 return file;
};
const card=(over={})=>({
 id:'EXP-001',
 question:'용병이 둘 이상일 때 누구를 붙일지가 결과를 바꾸는가',
 sot_anchor:{'design/gdd.md':['기둥(pillars)','핵심 루프']},
 origin:'design/gdd.md 열린 질문 1',
 hypothesis:'계약이 서로 다른 능력치를 보면 배정 정책에 따라 금화가 달라진다',
 falsified_if:'정책 셋의 평균 금화 차이가 5% 안쪽이다',
 rung:'sim',
 measures:[{id:'M1',type:'sim',what:'정책별 평균 금화 차이 15% 이상',check:'npm --prefix prototype test -- sim'}],
 scope:{paths:['prototype/src/sim/']},
 invariants:['design/gdd.md','애셋 추가 없음'],
 budget:{tasks:2,restarts:1},
 ...over});
const note=(over={})=>({
 id:'RQ-001',
 question:'자동 해결 결과의 원인을 얼마나 보여 줘야 다음 배정을 바꾸는가',
 refs:[{id:'REF-1',url:'https://example.invalid/post',retrieved_at:'2026-11-11',source_type:'developer',evidence_kind:'reported',claim:'개발자는 결과 보고에 원인 한 줄을 넣은 뒤 재배치가 늘었다고 적었다'}],
 findings:[{id:'F1',kind:'pattern',statement:'결과 보고에 원인을 한 줄로 적는다',refs:['REF-1']}],
 stopped_because:'새 출처 둘이 판단을 바꾸지 못함',
 ...over});
const has=(errors,re)=>assert.ok(errors.some(e=>re.test(e)),`기대한 오류 없음 ${re}: ${JSON.stringify(errors)}`);

test('갖출 것을 갖춘 시뮬레이션 카드는 통과한다',t=>{
 assert.deepEqual(lintExperiment(card(),{repo:repo(t)}),[]);
});

test('형식: 반증 조건·예산·측정이 없으면 거절',t=>{
 const dir=repo(t);
 for(const k of ['falsified_if','budget','measures','sot_anchor']){
  const c=card();delete c[k];
  has(lintExperiment(c,{repo:dir}),new RegExp(`필수 필드 없음: ${k}`));
 }
 has(lintExperiment(card({measures:[]}),{repo:dir}),/원소 0개/);
 has(lintExperiment(card({extra:1}),{repo:dir}),/정의되지 않은 필드: extra/);
});

test('sot_anchor: 문서와 섹션이 실제로 있어야 한다',t=>{
 const dir=repo(t);
 has(lintExperiment(card({sot_anchor:{}}),{repo:dir}),/sot_anchor가 비어 있음/);
 has(lintExperiment(card({sot_anchor:{'design/none.md':['x']}}),{repo:dir}),/문서가 없음: design\/none\.md/);
 has(lintExperiment(card({sot_anchor:{'design/gdd.md':['없는 섹션']}}),{repo:dir}),/"없는 섹션" 섹션이 없음/);
});

test('측정: 검사 측정은 check·what, 사람 측정은 ask',t=>{
 const dir=repo(t);
 has(lintExperiment(card({measures:[{id:'M1',type:'sim',what:'차이가 난다'}]}),{repo:dir}),/M1\(sim\)에 check/);
 has(lintExperiment(card({measures:[{id:'M1',type:'sim',check:'npm test'}]}),{repo:dir}),/M1\(sim\)에 what/);
 has(lintExperiment(card({measures:[{id:'M1',type:'sim',what:'차이가 난다',check:[]}]}),{repo:dir}),/M1\.check/);
 has(lintExperiment(card({rung:'prototype',measures:[{id:'M1',type:'sim',what:'차이가 난다',check:'x'},{id:'M2',type:'human'}]}),{repo:dir}),/M2\(human\)에 ask/);
 has(lintExperiment(card({measures:[{id:'M1',type:'sim',what:'차이가 난다',check:'x'},{id:'M1',type:'sim',what:'또 차이',check:'y'}]}),{repo:dir}),/id 중복/);
});

test('칸과 측정의 짝',t=>{
 const dir=repo(t),sim={id:'M1',type:'sim',what:'차이가 난다',check:'x'},ask=n=>({id:`M${n}`,type:'human',ask:'왜 졌다고 생각했나'});
 // 시뮬레이션 칸에 사람 측정만 있거나 섞여 있으면 거절.
 has(lintExperiment(card({measures:[ask(1)]}),{repo:dir}),/rung "sim"에는 sim 측정/);
 has(lintExperiment(card({measures:[sim,ask(2)]}),{repo:dir}),/rung "sim"에 human 측정/);
 // 프로토타입 칸: sim 측정이 같이 있으면 아래 칸을 거친 것.
 assert.deepEqual(lintExperiment(card({rung:'prototype',measures:[sim,ask(2)]}),{repo:dir}),[]);
 has(lintExperiment(card({rung:'prototype',measures:[ask(1)]}),{repo:dir}),/sim 칸을 건너뜀/);
 assert.deepEqual(lintExperiment(card({rung:'prototype',measures:[ask(1)],skipped_rungs:{sim:'규칙이 아니라 글자 표시 방식만 묻는 실험'}}),{repo:dir}),[]);
 has(lintExperiment(card({rung:'prototype',measures:[sim,ask(2),ask(3),ask(4),ask(5)]}),{repo:dir}),/사람 측정이 4개/);
 has(lintExperiment(card({rung:'prototype',measures:[sim,{id:'M2',type:'scenario',what:'금화가 보인다',check:'x'},ask(3)]}),{repo:dir}),/scenario 측정/);
 // godot 칸의 사람 측정은 프로토타입 칸을 거친 것으로 치지 않는다.
 const godot=card({rung:'godot',measures:[sim,{id:'M2',type:'scenario',what:'금화가 보인다',check:'x'},ask(3)]});
 has(lintExperiment(godot,{repo:dir}),/prototype 칸을 건너뜀/);
 has(lintExperiment(card({skipped_rungs:{prototype:'시뮬레이션 칸에는 아래 칸이 없다'}}),{repo:dir}),/아래 칸이 아님/);
});

test('builds_on: supported로 닫힌 아래 칸 카드만',t=>{
 const dir=repo(t),ask={id:'M1',type:'human',ask:'왜 졌다고 생각했나'};
 const up=card({id:'EXP-002',rung:'prototype',measures:[ask],builds_on:['EXP-001']});
 has(lintExperiment(up,{repo:dir}),/EXP-001 카드가 .*없음/);
 put(dir,`${EXPERIMENTS_DIR}/EXP-001-assign.json`,card());
 has(lintExperiment(up,{repo:dir}),/supported로 닫힌 카드가 아님\(판정 없음\)/);
 put(dir,`${EXPERIMENTS_DIR}/EXP-001-assign.json`,card({verdict:{result:'supported',at:'2026-11-11',measures:{M1:'차이 22%'},next:'프로토타입 칸'}}));
 assert.deepEqual(lintExperiment(up,{repo:dir}),[]);
});

test('범위: 검사 기준·건 문서·불변 항목과 겹치면 거절',t=>{
 const dir=repo(t);
 has(lintExperiment(card({scope:{paths:['design/experiments/']}}),{repo:dir}),/검사 기준\(design\/experiments\)/);
 has(lintExperiment(card({scope:{paths:['design/schemas/x.schema.json']}}),{repo:dir}),/검사 기준\(design\/schemas\)/);
 has(lintExperiment(card({scope:{paths:['design/']}}),{repo:dir}),/검사 기준/);
 has(lintExperiment(card({scope:{paths:['design/gdd.md']},invariants:[]}),{repo:dir}),/sot_anchor 문서/);
 has(lintExperiment(card({scope:{paths:['design/world.md']},invariants:['design/world.md']}),{repo:dir}),/invariants의 design\/world\.md/);
 has(lintExperiment(card({scope:{paths:['../other']}}),{repo:dir}),/상대 경로/);
 assert.equal(overlaps('prototype/src/','prototype/src/sim/a.ts'),true);
 assert.equal(overlaps('prototype/src2','prototype/src'),false);
});

test('research_refs: 조사 노트와 finding이 있어야 한다',t=>{
 const dir=repo(t);
 has(lintExperiment(card({research_refs:['RQ-001:F1']}),{repo:dir}),/RQ-001 조사 노트가/);
 put(dir,`${RESEARCH_DIR}/RQ-001-feedback.json`,note());
 assert.deepEqual(lintExperiment(card({research_refs:['RQ-001:F1']}),{repo:dir}),[]);
 has(lintExperiment(card({research_refs:['RQ-001:F9']}),{repo:dir}),/F9가 없음/);
});

test('판정: 측정마다 결과가 있어야 하고, 기각된 같은 가설은 경고',t=>{
 const dir=repo(t),v={result:'refuted',at:'2026-11-11',measures:{},next:'제약을 넣은 새 카드'};
 has(lintExperiment(card({verdict:v}),{repo:dir}),/verdict\.measures에 M1/);
 has(lintExperiment(card({verdict:{...v,measures:{M1:'차이 2%',M9:'?'}}}),{repo:dir}),/M9는 measures에 없는/);
 put(dir,`${EXPERIMENTS_DIR}/EXP-001-assign.json`,card({verdict:{...v,measures:{M1:'차이 2%'}}}));
 const warnings=[];
 assert.deepEqual(lintExperiment(card({id:'EXP-002'}),{repo:dir,warn:m=>warnings.push(m)}),[]);
 assert.match(warnings.join('\n'),/이미 기각됨/);
});

test('조사 노트: 출처 연결과 추론 표시',()=>{
 assert.deepEqual(lintResearch(note()),[]);
 has(lintResearch(note({findings:[{id:'F1',kind:'pattern',statement:'결과 보고에 원인을 적는다',refs:['REF-9']}]})),/REF-9가 refs에 없음/);
 has(lintResearch(note({findings:[{id:'F1',kind:'pattern',statement:'결과 보고에 원인을 적는다',refs:[]}]})),/kind "open"/);
 assert.deepEqual(lintResearch(note({refs:[],findings:[{id:'F1',kind:'open',statement:'리드의 추론: 원인을 적으면 읽힌다',refs:[]}]})),[]);
 const r=note().refs[0];
 has(lintResearch(note({refs:[{...r,claim:'x'.repeat(301)}]})),/길이 301/);
 const warnings=[];
 lintResearch(note({refs:[{...r,source_type:'video',evidence_kind:'observed'}]}),{warn:m=>warnings.push(m)});
 assert.match(warnings.join('\n'),/영상을 observed/);
});

test('CLI: 종류는 id로 가르고 종료 코드는 0·1·2',t=>{
 const dir=repo(t),script=path.join(STUDIO_ROOT,'scripts','experiment.mjs');
 const run=(...a)=>spawnSync(process.execPath,[script,...a],{encoding:'utf8'});
 const good=put(dir,`${EXPERIMENTS_DIR}/EXP-001-assign.json`,card());
 const bad=put(dir,`${EXPERIMENTS_DIR}/EXP-002-bad.json`,card({id:'EXP-002',measures:[{id:'M1',type:'human',ask:'왜 졌다고 생각했나'}]}));
 const rq=put(dir,`${RESEARCH_DIR}/RQ-001-feedback.json`,note());
 assert.equal(run('lint',good,'--repo',dir).status,0);
 const failed=run('lint',bad,'--repo',dir);
 assert.equal(failed.status,1);assert.match(failed.stdout,/FAIL rung "sim"/);
 assert.equal(run('lint',rq,'--repo',dir).status,0);
 assert.equal(run('lint',path.join(dir,'none.json')).status,2);
 assert.equal(run('lint',put(dir,'x.json',{id:'T-1'})).status,2);
 assert.equal(run('nope').status,2);
 assert.equal(lint(good,{repo:dir}).kind,'experiment');
 // 파일 이름은 id로 시작해야 한다.
 has(lint(put(dir,`${EXPERIMENTS_DIR}/assign.json`,card({id:'EXP-003'})),{repo:dir}).errors,/파일 이름이 id로/);
});
