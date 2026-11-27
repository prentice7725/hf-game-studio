// 리드 호스트: 정하는 순서, 계열, 호스트에 따라 달라지는 기본값(리뷰어, 작성자, 작가, 스킬 폴더).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {resolveHost,normalizeHost,hostWarning,hostFamily,familyOf,pickReviewer,HOSTS,leadEligibility,assertLeadModel} from '../scripts/lib/host.mjs';
import * as claude from '../scripts/lib/adapters/claude.mjs';
import {ADAPTERS} from '../scripts/lib/adapters/index.mjs';
import {plan as taskPlan,start,verify} from '../scripts/task.mjs';
import {plan as setupPlan,install} from '../scripts/setup.mjs';
import {review,write,reviewInputFromTask} from '../scripts/consult.mjs';

const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-host-'));
function gameRepo(){
 const dir=tmp();
 const git=(...a)=>execFileSync('git',['-C',dir,...a],{stdio:'pipe'});
 git('init','-q');git('config','user.email','t@example.com');git('config','user.name','t');
 fs.mkdirSync(path.join(dir,'design','schemas'),{recursive:true});
 fs.mkdirSync(path.join(dir,'data'));
 fs.writeFileSync(path.join(dir,'design','glossary.md'),'# 용어\n\n애쉬: 용병.\n');
 fs.writeFileSync(path.join(dir,'a.txt'),'one\n');
 git('add','-A');git('commit','-qm','init');
 return dir;
}
const LORE={task_id:'L1',kind:'lore',objective:'잿빛 항구의 내력을 쓴다',scope:{paths:['design/lore/harbor.md']},success_criteria:['AC1: 항구의 내력이 한 단락 있다'],context_docs:['design/glossary.md']};

test('호스트는 --host, HFGS_HOST, Claude Code 감지, 기본값 순서로 정한다',()=>{
 assert.deepEqual(resolveHost({flag:'codex',env:{HFGS_HOST:'agy',CLAUDECODE:'1'}}),{host:'codex',source:'flag'});
 assert.deepEqual(resolveHost({env:{HFGS_HOST:'agy',CLAUDECODE:'1'}}),{host:'agy',source:'env'});
 assert.deepEqual(resolveHost({env:{CLAUDECODE:'1'}}),{host:'claude',source:'detected'});
 assert.deepEqual(resolveHost({env:{}}),{host:'claude',source:'default'});
 assert.equal(hostWarning(resolveHost({env:{CLAUDECODE:'1'}})),null);
 assert.match(hostWarning(resolveHost({env:{}})),/HFGS_HOST=codex\|agy\|gemini/);
 assert.equal(normalizeHost('Antigravity'),'agy');
 assert.equal(normalizeHost('claude-code'),'claude');
 assert.throws(()=>normalizeHost('cursor'),/알 수 없는 호스트/);
});

test('계열: 호스트 이름으로 알고, 리드 모델을 적었으면 그것이 먼저다',()=>{
 assert.equal(hostFamily('claude',{}),'anthropic');
 assert.equal(hostFamily('codex',{}),'openai');
 assert.equal(hostFamily('agy',{}),'google');
 assert.equal(hostFamily('gemini',{}),'google');
 assert.equal(hostFamily('agy',{HFGS_HOST_MODEL:'claude-opus-5-5'}),'anthropic','agy는 Claude 모델도 돌린다');
 assert.equal(familyOf('vertex'),'google');
});

test('리뷰어 기본값은 작성자와 다른 계열이고, agy는 마지막에 고른다',()=>{
 assert.equal(pickReviewer('anthropic'),'codex');
 assert.equal(pickReviewer('openai'),'claude');
 assert.equal(pickReviewer('google'),'codex');
 assert.equal(pickReviewer('openai',['codex','agy','grok']),'grok');
 assert.equal(pickReviewer('openai',['codex','agy']),'agy');
 assert.equal(pickReviewer('openai',['codex']),null);
});

test('claude 어댑터: 읽기 도구만, 프롬프트는 stdin, 편집·셸·MCP·비밀 파일은 막는다',()=>{
 assert.equal(ADAPTERS.claude,claude);
 const schema={type:'object',properties:{summary:{type:'string'}},required:['summary']};
 const r=claude.command({prompt:'P',schema});
 const arg=flag=>r.args[r.args.indexOf(flag)+1];
 assert.equal(r.stdin,'P');
 assert.equal(arg('--model'),'claude-opus-5-5');
 assert.equal(arg('--tools'),'Read,Glob,Grep');
 assert.equal(arg('--allowedTools'),'Read,Glob,Grep');
 assert.equal(arg('--permission-mode'),'dontAsk');
 assert.deepEqual(JSON.parse(arg('--json-schema')),schema);
 for(const d of ['Edit','Write','Bash','mcp__*','Agent','Read(./.env)','Read(**/secrets/**)'])assert.ok(arg('--disallowedTools').split(',').includes(d),d);
 assert.ok(r.args.includes('--safe-mode'));
 assert.equal(arg('--session-id'),r.session);
 const custom=claude.command({prompt:'P',schema,options:{model:'claude-sonnet-5-5',reasoning_effort:'high'}}).args;
 assert.equal(custom[custom.indexOf('--model')+1],'claude-sonnet-5-5');
 assert.equal(custom[custom.indexOf('--effort')+1],'high');
 assert.equal(r.args.includes('--effort'),false);
});

test('claude 어댑터: 성공 결과만 받고, 세션이 다르거나 거부된 도구가 있으면 버린다',()=>{
 const ok={type:'result',subtype:'success',is_error:false,session_id:'s1',structured_output:{summary:'s'},usage:{input_tokens:1}};
 assert.deepEqual(claude.parse(JSON.stringify(ok),{session:'s1'}).result,{summary:'s'});
 assert.throws(()=>claude.parse(JSON.stringify(ok),{session:'other'}),/세션이 요청과 다름/);
 assert.throws(()=>claude.parse(JSON.stringify({...ok,permission_denials:[{tool_name:'Bash'}]}),{session:'s1'}),/허용되지 않은 도구.*Bash/);
 assert.throws(()=>claude.parse(JSON.stringify({...ok,subtype:'error_max_turns'}),{session:'s1'}),/error_max_turns/);
 assert.throws(()=>claude.parse(JSON.stringify({...ok,structured_output:null}),{session:'s1'}),/결과 JSON이 없음/);
 assert.throws(()=>claude.parse('not json'),/JSON이 아닌/);
 assert.match(claude.diagnose(JSON.stringify({type:'result',is_error:true,result:'Usage limit reached'})),/Usage limit reached/);
 assert.equal(claude.diagnose('{}'),null);
});

test('글 작업: Claude·Codex 리드는 작가 brief를 받고, Google 계열 리드는 직접 쓴다',()=>{
 const dir=gameRepo();
 for(const host of ['claude','codex']){
  const p=taskPlan(LORE,{repo:dir,host});
  assert.equal(p.owner,'lead');
  assert.equal(p.writer,'argon');
  assert.equal(p.host,host);
  assert.ok(p.write_brief,'작가 brief가 있다');
  assert.equal('lead_writes' in p,false);
 }
 for(const host of ['agy','gemini']){
  const p=taskPlan(LORE,{repo:dir,host});
  assert.equal(p.owner,'lead');
  assert.equal('writer' in p,false);
  assert.equal(p.lead_writes,true);
  assert.equal('write_brief' in p,false);
  assert.ok(p.rules.some(r=>/You are the writer for this task/.test(r)));
 }
 // 글 작업이 아니면 호스트와 상관없이 같다.
 const code={task_id:'C1',kind:'code',objective:'x',scope:{paths:['a.txt']},success_criteria:['AC1: x'],context_docs:[]};
 assert.equal('lead_writes' in taskPlan(code,{repo:dir,host:'agy'}),false);
});

test('작업 기록에 호스트가 남고, 검증은 다른 셸에서 돌려도 시작한 호스트의 계획을 쓴다',()=>{
 const dir=gameRepo(),env={HFGS_HOME:tmp()};
 const task={task_id:'H1',kind:'code',objective:'a.txt를 고친다',scope:{paths:['a.txt']},success_criteria:['AC1: a.txt가 two다'],context_docs:[],
  acceptance_commands:[`node -e "process.exit(require('fs').readFileSync('a.txt','utf8').trim()==='two'?0:1)"`]};
 const {state}=start(task,{repo:dir,env,host:'codex'});
 assert.equal(state.host,'codex');
 fs.writeFileSync(path.join(dir,'a.txt'),'two\n');
 const r=verify(task,{repo:dir,env,host:'claude'});
 assert.equal(r.ok,true,JSON.stringify(r.errors));
 assert.equal(r.plan.host,'codex');
 assert.equal(reviewInputFromTask('H1',{env}).author,'codex');
});

test('리뷰: 작성자는 리드 호스트, 리뷰어는 다른 계열. Codex 리드의 변경은 Claude가 본다',()=>{
 const dir=gameRepo();
 fs.writeFileSync(path.join(dir,'a.txt'),'two\n');
 const seen=[];
 const invoke=adapter=>{seen.push(adapter.name);return {result:{recommended_verdict:'pass',summary:'ok',confidence:'high',blocking_criteria:[],findings:[]},redacted:0};};
 const base={repo:dir,base:'HEAD',criteria:['AC1: x']};
 const by=(host,env={})=>review({...base,host},{invoke,dir:tmp(),env}).report;
 let r=by('claude');assert.equal(r.author,'claude');assert.equal(r.adapter,'codex');
 r=by('codex');assert.equal(r.author,'codex');assert.equal(r.adapter,'claude');
 r=by('gemini');assert.equal(r.author,'gemini');assert.equal(r.adapter,'codex');
 // agy 리드는 어떤 모델을 돌렸는지 적어야 한다(agy는 Claude도 돌린다).
 assert.throws(()=>by('agy'),/HFGS_HOST_MODEL/);
 r=by('agy',{HFGS_HOST_MODEL:'gemini-4-argon-high'});assert.equal(r.author_model,'gemini-4-argon-high');assert.equal(r.adapter,'codex');
 r=by('agy',{HFGS_HOST_MODEL:'claude-opus-5-5'});assert.equal(r.adapter,'codex','Claude를 돌린 agy 리드도 Claude에게 리뷰받지 않는다');
 // 명시한 값은 그대로 쓰고, 같은 계열은 계속 거절한다.
 assert.throws(()=>review({...base,host:'codex',reviewer:'codex'},{invoke,dir:tmp(),env:{}}),/같은 계열/);
 assert.equal(review({...base,host:'codex',author:'claude'},{invoke,dir:tmp(),env:{}}).report.adapter,'codex');
 assert.deepEqual(seen,['codex','claude','codex','codex','codex','codex']);
});

test('글쓰기: 기본 작가는 agy지만 Google 계열 리드에서는 부르지 않고, 작가를 정하면 부른다',()=>{
 const dir=gameRepo();
 const seen=[];
 const invoke=adapter=>{seen.push(adapter.name);return {result:{content:'글',new_terms:[],notes:''},redacted:0};};
 const brief={task:'로어 한 단락',context_docs:[]};
 write(brief,{repo:dir,host:'claude'},{invoke,dir:tmp(),env:{}});
 write(brief,{repo:dir,host:'codex'},{invoke,dir:tmp(),env:{}});
 assert.throws(()=>write(brief,{repo:dir,host:'agy'},{invoke,dir:tmp(),env:{}}),/리드가 직접 씀/);
 assert.throws(()=>write(brief,{repo:dir,host:'gemini'},{invoke,dir:tmp(),env:{}}),/리드가 직접 씀/);
 write(brief,{repo:dir,host:'agy',writer:'claude'},{invoke,dir:tmp(),env:{}});
 // Claude 모델을 돌리는 agy 리드는 Google 계열이 아니므로 기본 작가를 부른다.
 write(brief,{repo:dir,host:'agy'},{invoke,dir:tmp(),env:{HFGS_HOST_MODEL:'claude-opus-5-5'}});
 assert.deepEqual(seen,['agy','agy','claude','agy']);
});

test('설치: 리드 스킬은 호스트의 스킬 폴더에 깔고, 나머지 파일은 호스트와 상관없이 같다',()=>{
 const where=host=>setupPlan(undefined,{host}).map(f=>f[1]).filter(d=>d.includes('/skills/gs-inspect/'));
 assert.deepEqual(where('claude'),['.claude/skills/gs-inspect/SKILL.md']);
 assert.deepEqual(where('codex'),['.codex/skills/gs-inspect/SKILL.md']);
 assert.deepEqual(where('agy'),['.agents/skills/gs-inspect/SKILL.md']);
 assert.deepEqual(where('gemini'),['.gemini/skills/gs-inspect/SKILL.md']);
 assert.equal(where('all').length,Object.keys(HOSTS).length);
 const rest=host=>setupPlan(undefined,{host}).map(f=>f[1]).filter(d=>!d.includes('/skills/')).sort();
 assert.deepEqual(rest('codex'),rest('claude'));
 const dir=gameRepo();
 install(dir,{host:'codex',log:()=>{}});
 assert.ok(fs.existsSync(path.join(dir,'.codex','skills','gs-inspect','SKILL.md')));
 assert.equal(fs.existsSync(path.join(dir,'.claude')),false);
});

test('리드 모델 하한: Opus·Sol·Neon 이상만 통과하고 하한 미만은 start에서 차단',()=>{
 for(const ok of ['claude-opus-5-5','claude-fable-5-2','gpt-6.1-sol','gpt-6.1-astra','gemini-4-neon-xhigh','Orchestrator (Neon)','future-model-9']){
  assert.equal(leadEligibility(ok).eligible,true,ok);
  assert.doesNotThrow(()=>assertLeadModel(ok));
 }
 for(const bad of ['claude-sonnet-5-5','claude-haiku-5-5','gpt-6.1-terra','gpt-6-luna','gemini-4-argon-high','Orchestrator (Argon)','gemini-4-hydrogen','gemini-3.8-flash','gpt-oss-120b']){
  assert.equal(leadEligibility(bad).eligible,false,bad);
  assert.throws(()=>assertLeadModel(bad),/LEAD_MODEL_BELOW_MINIMUM/);
 }
 const dir=gameRepo(),env={HFGS_HOME:tmp(),HFGS_HOST_MODEL:'gemini-4-argon-high'};
 const task={task_id:'M1',kind:'code',objective:'a.txt를 고친다',scope:{paths:['a.txt']},success_criteria:['AC1: a.txt가 two다'],context_docs:[],
  acceptance_commands:[`node -e "process.exit(require('fs').readFileSync('a.txt','utf8').trim()==='two'?0:1)"`]};
 assert.throws(()=>start(task,{repo:dir,env,host:'agy'}),/LEAD_MODEL_BELOW_MINIMUM/);
 assert.doesNotThrow(()=>start(task,{repo:dir,env:{HFGS_HOME:tmp(),HFGS_HOST_MODEL:'gemini-4-neon-xhigh'},host:'agy'}));
});
