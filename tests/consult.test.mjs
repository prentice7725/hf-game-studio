// 전문가 호출 스크립트 테스트. 실제 git 저장소를 임시로 만들고 모델 호출만 가짜로 바꾼다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {review,write,dispose,stats,judge,familyOf,reviewPrompt,runChecks,checkWriteBrief} from '../scripts/consult.mjs';

function repo(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-consult-'));
 const git=(...a)=>execFileSync('git',['-C',dir,...a],{stdio:'pipe'});
 git('init','-q');git('config','user.email','t@t');git('config','user.name','t');
 fs.mkdirSync(path.join(dir,'design'));
 fs.writeFileSync(path.join(dir,'design','glossary.md'),'# 용어집\n\n## 길드\n용병 길드.\n');
 fs.writeFileSync(path.join(dir,'a.js'),'export const hp=10;\n');
 git('add','.');git('commit','-qm','init');
 fs.writeFileSync(path.join(dir,'a.js'),'export const hp=12;\n');
 fs.writeFileSync(path.join(dir,'b.js'),'export const mp=3;\n');
 return dir;
}
const ok={summary:'좋음',verdict:'pass',blocking_criteria:[],findings:[{file:'a.js',line:1,severity:'nit',issue:'이름',suggestion:'바꿀 것'}],confidence:'high'};
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-reports-'));

test('review: 작성자 주장 없이 diff·새 파일·검사 결과만 보내고 보고서를 남긴다',()=>{
 const dir=repo(),seen={};
 const invoke=(adapter,{prompt,schema})=>{seen.adapter=adapter.name;seen.prompt=JSON.parse(prompt);seen.schema=schema;return {result:ok,session_id:'s',redacted:0};};
 const {report,file}=review({repo:dir,base:'HEAD',criteria:['AC1: hp는 12'],checks:['node -e "process.exit(3)"']},{invoke,dir:tmp()});
 assert.equal(seen.adapter,'codex');
 assert.match(seen.prompt.diff,/hp=12/);
 assert.deepEqual(seen.prompt.untracked_new_files,['b.js']);
 assert.equal(seen.prompt.controller_checks[0].exit_code,3);
 assert.ok(!('author_summary' in seen.prompt));
 assert.match(seen.prompt.instructions.join(' '),/no summary, test claims/);
 assert.equal(report.verdict,'pass');
 assert.equal(report.findings[0].id,'F1');
 assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).model,'gpt-6.1-sol');
});

test('review: 같은 계열 리뷰어, ID 없는 기준, 바뀐 것 없음은 거절',()=>{
 const dir=repo(),invoke=()=>({result:ok});
 assert.throws(()=>review({repo:dir,base:'HEAD',author:'codex',criteria:['AC1: x']},{invoke}),/같은 계열/);
 assert.throws(()=>review({repo:dir,base:'HEAD',reviewer:'agy',model:'claude-opus-5-5',criteria:['AC1: x']},{invoke}),/같은 계열/);
 assert.throws(()=>review({repo:dir,base:'HEAD',criteria:['hp는 12']},{invoke}),/ID로 시작/);
 assert.throws(()=>review({repo:dir,base:'HEAD',criteria:[]},{invoke}),/성공 기준/);
 execFileSync('git',['-C',dir,'stash','-u','-q']);
 assert.throws(()=>review({repo:dir,base:'HEAD',criteria:['AC1: x']},{invoke}),/바뀐 것이 없음/);
});

test('review: 전문가가 저장소를 바꾸면 답을 버린다',()=>{
 const dir=repo();
 const invoke=()=>{fs.writeFileSync(path.join(dir,'a.js'),'hacked\n');return {result:ok};};
 assert.throws(()=>review({repo:dir,base:'HEAD',criteria:['AC1: x']},{invoke,dir:tmp()}),/저장소가 바뀜/);
});

test('judge: 줄 번호 있는 blocker·major가 없는 redo는 권고',()=>{
 assert.deepEqual(judge({verdict:'redo',findings:[{severity:'minor',line:3}]}),{verdict:'redo',advisory:true});
 assert.deepEqual(judge({verdict:'redo',findings:[{severity:'major',line:0}]}),{verdict:'redo',advisory:true});
 assert.deepEqual(judge({verdict:'redo',findings:[{severity:'blocker',line:2}]}),{verdict:'redo',advisory:false});
 assert.deepEqual(judge({verdict:'pass',findings:[]}),{verdict:'pass',advisory:false});
});

test('familyOf: 모델 이름이 CLI보다 우선',()=>{
 assert.equal(familyOf('agy','gemini-4-argon'),'google');
 assert.equal(familyOf('agy','claude-sonnet-5-5'),'anthropic');
 assert.equal(familyOf('codex','gpt-6.1-sol'),'openai');
 assert.equal(familyOf('grok',null),'xai');
});

test('reviewPrompt: agy에는 diff를 잘라 넣고 직접 읽으라고 알린다',()=>{
 const big='x'.repeat(20000);
 const p=JSON.parse(reviewPrompt({criteria:['AC1: x'],base:'main',diff:big,untracked:[],changed:['a'],checks:[],reviewer:'agy'}));
 assert.equal(p.diff.length,12000);
 assert.match(p.diff_truncated,/Read the changed files directly/);
 assert.match(p.instructions.join(' '),/Run no shell commands at all/);
 const c=JSON.parse(reviewPrompt({criteria:['AC1: x'],base:'main',diff:big,untracked:[],changed:['a'],checks:[],reviewer:'codex'}));
 assert.equal(c.diff.length,20000);
 assert.ok(!('diff_truncated' in c));
});

test('runChecks: 종료 코드와 출력 끝을 남긴다',()=>{
 const [r]=runChecks(process.cwd(),['node -e "console.log(\'hi\');process.exit(1)"']);
 assert.equal(r.exit_code,1);
 assert.match(r.output_tail,/hi/);
});

test('write: 문서 읽기 지시와 언어를 넘기고, json 형식이면 content를 검사한다',()=>{
 const dir=repo(),seen={};
 const invoke=(adapter,{prompt,timeoutMs})=>{seen.adapter=adapter.name;seen.prompt=JSON.parse(prompt);seen.timeout=timeoutMs;return {result:{content:'그는 길드 문을 열었다.',new_terms:[{term:'잿빛 항구',definition:'북쪽 항구 도시'}],notes:''},redacted:0};};
 const warnings=[];
 const {report}=write({task:'용병 애쉬의 첫 등장 장면',context_docs:['design/glossary.md','design/none.md']},{repo:dir},{invoke,dir:tmp(),warn:m=>warnings.push(m)});
 assert.equal(seen.adapter,'agy');
 assert.equal(seen.prompt.brief.language,'ko');
 assert.ok(seen.prompt.design_docs.includes('Read in full: design/glossary.md.'));
 assert.ok(seen.timeout>=30*60*1000);
 assert.ok(warnings.some(w=>w.includes('design/none.md')));
 assert.equal(report.model,'gemini-4-argon');
 assert.equal(report.new_terms[0].term,'잿빛 항구');
 const bad=()=>({result:{content:'not json',new_terms:[],notes:''}});
 assert.throws(()=>write({task:'대사',format:'json',context_docs:[]},{repo:dir},{invoke:bad,dir:tmp()}),/JSON이 아님/);
});

test('checkWriteBrief: task 필수, format과 context_sections 형식',()=>{
 assert.throws(()=>checkWriteBrief({}),/task/);
 assert.throws(()=>checkWriteBrief({task:'x',format:'yaml'}),/format/);
 assert.throws(()=>checkWriteBrief({task:'x',context_sections:['a']}),/context_sections/);
 assert.doesNotThrow(()=>checkWriteBrief({task:'x',format:'json'}));
});

test('dispose와 stats: 기각에는 이유가 필요하고, 쓸모 있는 지적 비율을 낸다',()=>{
 const report={kind:'review',adapter:'codex',model:'gpt-6.1-sol',findings:[{id:'F1'},{id:'F2'},{id:'F3'}]};
 assert.throws(()=>dispose(structuredClone(report),['F2=dismissed']),/이유/);
 assert.throws(()=>dispose(structuredClone(report),['F9=act']),/없는 지적/);
 assert.throws(()=>dispose(structuredClone(report),['F1=maybe']),/처분은/);
 const d=dispose(structuredClone(report),['F1=act','F2=dismissed:스타일 취향','F3=consider']);
 assert.equal(d.findings[1].reason,'스타일 취향');
 const [row]=stats([d,{kind:'write'}]);
 assert.deepEqual(row,{reviewer:'codex gpt-6.1-sol',reports:1,findings:3,disposed:3,actionable:2,actionable_rate:0.67});
});

test('review: 이미 있던 새 파일을 고쳐도 저장소가 바뀐 것으로 본다',()=>{
 const dir=repo();
 const invoke=()=>{fs.writeFileSync(path.join(dir,'b.js'),'export const mp=99;\n');return {result:ok};};
 assert.throws(()=>review({repo:dir,base:'HEAD',criteria:['AC1: x']},{invoke,dir:tmp()}),/저장소가 바뀜/);
});

test('review: 작성자 모델로 계열을 판단하고, agy 작성자는 모델이 필요하다',()=>{
 const dir=repo(),invoke=()=>({result:ok});
 assert.throws(()=>review({repo:dir,base:'HEAD',author:'agy',reviewer:'agy',model:'claude-opus-5-5',criteria:['AC1: x']},{invoke}),/--author-model/);
 assert.throws(()=>review({repo:dir,base:'HEAD',author:'agy',authorModel:'claude-sonnet-5-5',reviewer:'agy',model:'claude-opus-5-5',criteria:['AC1: x']},{invoke}),/같은 계열/);
 assert.throws(()=>review({repo:dir,base:'HEAD',author:'someone',criteria:['AC1: x']},{invoke}),/계열을 알 수 없음/);
 const {report}=review({repo:dir,base:'HEAD',author:'agy',authorModel:'claude-sonnet-5-5',reviewer:'codex',criteria:['AC1: x']},{invoke,dir:tmp()});
 assert.equal(report.author_model,'claude-sonnet-5-5');
});
