// codex, agy, grok 어댑터의 명령 인자와 응답 해석 테스트. 실제 CLI는 부르지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as codex from '../scripts/lib/adapters/codex.mjs';
import * as agy from '../scripts/lib/adapters/agy.mjs';
import * as grok from '../scripts/lib/adapters/grok.mjs';

const cli={executable:'x',prefix_args:[],supports:{'--ephemeral':true,'--print-timeout':true,'--new-project':true}};
const schema={type:'object',properties:{summary:{type:'string'},tags:{type:'array',items:{type:'object',properties:{a:{type:'string'},b:{type:'string'}},required:['a']}}},required:['summary']};
const arg=(args,flag)=>args[args.indexOf(flag)+1];

test('codex: 읽기 전용 샌드박스, 기본 모델 Sol, 프롬프트는 stdin, 스키마는 모든 키 필수',()=>{
 const r=codex.command({repo:'/r',prompt:'P',schema,cli,dir:'/d'});
 assert.equal(arg(r.args,'--sandbox'),'read-only');
 assert.equal(arg(r.args,'--model'),codex.DEFAULT_MODEL);
 assert.ok(r.args.includes('--ephemeral')&&r.args.includes('features.hooks=false'));
 assert.equal(r.args.at(-1),'-');
 assert.equal(r.stdin,'P');
 const sent=JSON.parse(r.files[0].content);
 assert.deepEqual(sent.required,['summary','tags']);
 assert.deepEqual(sent.properties.tags.items.required,['a','b']);
 assert.throws(()=>codex.command({repo:'/r',prompt:'P',schema,cli,dir:'/d',options:{reasoning_effort:'max'}}),/reasoning_effort/);
});

test('codex: JSONL에서 최종 메시지를 꺼내고 샌드박스 실패는 원인과 함께 실패',()=>{
 const ok=[{type:'thread.started',thread_id:'t1'},{type:'item.completed',item:{type:'agent_message',text:'{"summary":"s"}'}},{type:'turn.completed',usage:{input_tokens:1,output_tokens:2}}].map(JSON.stringify).join('\n');
 assert.deepEqual(codex.parse(ok).result,{summary:'s'});
 assert.equal(codex.parse(ok).session_id,'t1');
 const box=[{type:'item.completed',item:{type:'command_execution',exit_code:1,aggregated_output:'windows sandbox failed: CreateProcessAsUserW failed: 5'}},{type:'item.completed',item:{type:'agent_message',text:'{}'}},{type:'turn.completed'}].map(JSON.stringify).join('\n');
 assert.throws(()=>codex.parse(box),/CODEX_WINDOWS_SANDBOX/);
 assert.throws(()=>codex.parse(JSON.stringify({type:'turn.failed',error:{message:'quota'}})),/턴 실패.*quota/);
 assert.throws(()=>codex.parse(JSON.stringify({type:'thread.started',thread_id:'t'})),/끝나지 않았/);
 assert.match(codex.diagnose('','CreateProcessAsUserW failed: 1312'),/MSIX/);
 assert.equal(codex.diagnose('','CreateProcessAsUserW failed: 2'),null);
});

test('codex: Windows 샌드박스 모드는 운영자 환경변수로만',()=>{
 assert.deepEqual(codex.windowsSandboxArgs({}),[]);
 assert.deepEqual(codex.windowsSandboxArgs({[codex.WINDOWS_SANDBOX_ENV]:'unelevated'}),['-c','windows.sandbox="unelevated"']);
 assert.throws(()=>codex.windowsSandboxArgs({[codex.WINDOWS_SANDBOX_ENV]:'off'}),/elevated/);
});

test('agy: 모델 기본값은 gemini-4-argon-high, 강도는 모델 ID 접미사로',()=>{
 assert.deepEqual(agy.selectModel(),{model:'gemini-4-argon-high',effort_flag:null});
 assert.deepEqual(agy.selectModel({model:'gemini-4-argon-low'}),{model:'gemini-4-argon-low',effort_flag:null});
 assert.deepEqual(agy.selectModel({model:'gemini-4-argon',reasoning_effort:'medium'}),{model:'gemini-4-argon-medium',effort_flag:null});
 assert.deepEqual(agy.selectModel({model:'claude-opus-5-5',reasoning_effort:'max'}),{model:'claude-opus-5-5',effort_flag:'max'});
 assert.throws(()=>agy.selectModel({model:'gemini-4-argon-low',reasoning_effort:'high'}),/고정/);
 assert.throws(()=>agy.selectModel({model:'gemini-4-argon',reasoning_effort:'max'}),/강도/);
});

test('agy: 목록에 없는 모델은 실행 전에 막는다(조용히 기본 모델로 도는 것 방지)',()=>{
 const spawn=out=>()=>({status:0,stdout:out});
 assert.equal(agy.checkModel(cli,'gemini-4-argon-high',{spawn:spawn('gemini-4-argon-high\tGemini 4 Argon (High)\n'),env:{}}).status,'listed');
 assert.equal(agy.checkModel(cli,'gemini-4-argon-high',{spawn:spawn('Gemini 4 Argon High\n'),env:{}}).status,'listed');
 assert.throws(()=>agy.checkModel(cli,'gemini-9',{spawn:spawn('gemini-4-argon-high\n'),env:{}}),/MODEL_UNLISTED/);
 assert.equal(agy.checkModel(cli,'gemini-9',{spawn:()=>({status:1}),env:{}}).status,'unverified');
 assert.equal(agy.checkModel(cli,'gemini-9',{spawn:spawn(''),env:{[agy.ALLOW_UNLISTED_ENV]:'1'}}).status,'skipped');
});

test('agy: plan 모드·샌드박스·새 프로젝트, 프롬프트는 -p 마지막',()=>{
 const r=agy.command({repo:'/r',prompt:'P',schema,cli,dir:'/d',options:{timeout_ms:600000}});
 assert.equal(arg(r.args,'--mode'),'plan');
 assert.equal(arg(r.args,'--model'),'gemini-4-argon-high');
 assert.equal(arg(r.args,'--print-timeout'),'570s');
 assert.ok(r.args.includes('--sandbox')&&r.args.includes('--new-project'));
 assert.deepEqual(r.args.slice(-2),['-p','P']);
});

test('agy: structured_output 또는 응답 텍스트의 JSON, 로그아웃 진단',()=>{
 assert.deepEqual(agy.parse(JSON.stringify({conversation_id:'c',structured_output:{a:1}})).result,{a:1});
 assert.deepEqual(agy.parse(JSON.stringify({conversation_id:'c',response:'done {"a":2}'})).result,{a:2});
 assert.throws(()=>agy.parse(JSON.stringify({status:'error'})),/실행 상태/);
 assert.match(agy.diagnose('','Error: not signed in'),/AGY_NOT_SIGNED_IN/);
});

test('grok: 편집·셸·비밀 읽기를 막고 프롬프트는 파일로, 세션을 확인한다',()=>{
 const r=grok.command({repo:'/r',prompt:'P',options:{},dir:'/d'});
 const deny=r.args.flatMap((a,i)=>a==='--deny'?[r.args[i+1]]:[]);
 assert.ok(deny.includes('Edit(**)')&&deny.includes('Bash(*)')&&deny.includes('Read(./.env)'));
 assert.equal(r.files[0].content,'P');
 assert.equal(arg(r.args,'--session-id'),r.session);
 const out=s=>JSON.stringify({sessionId:s,stopReason:'end_turn',text:'ok {"a":1}'});
 assert.deepEqual(grok.parse(out(r.session),r).result,{a:1});
 assert.throws(()=>grok.parse(out('other'),r),/세션/);
 assert.throws(()=>grok.parse(JSON.stringify({sessionId:r.session,stopReason:'max_turns',text:''}),r),/멈춤/);
});

test('codex: 켜진 MCP 서버를 이름으로 모두 끄고, 목록을 못 얻으면 막는다',()=>{
 const list=JSON.stringify([{name:'asset_pipeline',enabled:true},{name:'godot-ai',enabled:true},{name:'off',enabled:false},{name:'a.b',enabled:true}]);
 const names=codex.enabledMcpServers(cli,{spawn:()=>({status:0,stdout:list}),env:{}});
 assert.deepEqual(names,['asset_pipeline','godot-ai','a.b']);
 assert.deepEqual(codex.disableMcpArgs(names),['-c','mcp_servers.asset_pipeline.enabled=false','-c','mcp_servers.godot-ai.enabled=false','-c','mcp_servers."a.b".enabled=false']);
 const r=codex.command({repo:'/r',prompt:'P',schema,cli:{...cli,mcp_servers:['asset_pipeline']},dir:'/d'});
 assert.ok(r.args.includes('mcp_servers.asset_pipeline.enabled=false'));
 assert.throws(()=>codex.enabledMcpServers(cli,{spawn:()=>({status:2,stdout:''}),env:{}}),/MCP 서버 목록/);
 assert.deepEqual(codex.enabledMcpServers(cli,{spawn:()=>{throw Error('불리면 안 됨');},env:{[codex.ALLOW_MCP_ENV]:'1'}}),[]);
});

test('codex: 성공한 명령의 출력에 샌드박스 오류 문구가 있어도 실패로 보지 않는다',()=>{
 const ev=exit=>[{type:'item.completed',item:{type:'command_execution',exit_code:exit,aggregated_output:'// (CreateProcessAsUserW failed: 5 등) 주석'}},{type:'item.completed',item:{type:'agent_message',text:'{"summary":"s"}'}},{type:'turn.completed'}].map(JSON.stringify).join('\n');
 assert.deepEqual(codex.parse(ev(0)).result,{summary:'s'});
 assert.throws(()=>codex.parse(ev(1)),/CODEX_WINDOWS_SANDBOX/);
});

test('agy: 켜진 MCP 서버 이름을 표에서 읽는다',()=>{
 const out='NAME             TYPE   STATUS   COMMAND/URL\nasset_pipeline   stdio  enabled  c:/x.exe\nold   http  disabled  http://x\n';
 assert.deepEqual(agy.enabledMcpServers(cli,{spawn:()=>({status:0,stdout:out})}),['asset_pipeline']);
 assert.deepEqual(agy.enabledMcpServers(cli,{spawn:()=>({status:1})}),[]);
});
