// 애셋 스크립트 테스트. asset-pipeline MCP 서버를 흉내 내는 stdio JSON-RPC 서버를 띄워 brief → route → generate → inspect 흐름,
// 후보 저장과 규격 검사, 사용자 승인 뒤 pick까지 본다. 실제 asset-pipeline은 부르지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {serverCommand,McpClient,generate,pick,target,briefArgs,prepareBrief,pickOutput,noteFile,PENDING} from '../scripts/assets.mjs';
import {STUDIO_ROOT} from '../scripts/task.mjs';

const example=name=>JSON.parse(fs.readFileSync(path.join(STUDIO_ROOT,'examples','tasks',name)));

// check-assets가 읽는 최소 PNG(IHDR만 맞으면 됨, CRC는 보지 않음)와 PCM WAV.
export function png(width,height,colorType=6){
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=colorType;
 const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);return Buffer.concat([len,Buffer.from(type,'latin1'),data,Buffer.alloc(4)]);};
 return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ihdr),chunk('IEND',Buffer.alloc(0))]);
}
export function wav(seconds,channels=2,rate=44100){
 const byteRate=rate*channels*2,data=Buffer.alloc(Math.round(seconds*byteRate));
 const fmt=Buffer.alloc(16);fmt.writeUInt16LE(1,0);fmt.writeUInt16LE(channels,2);fmt.writeUInt32LE(rate,4);fmt.writeUInt32LE(byteRate,8);fmt.writeUInt16LE(channels*2,12);fmt.writeUInt16LE(16,14);
 const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
 return Buffer.concat([Buffer.from('RIFF'),u32(36+data.length),Buffer.from('WAVEfmt '),u32(16),fmt,Buffer.from('data'),u32(data.length),data]);
}

// 가짜 MCP 서버. 동작은 환경변수로 정한다: FAKE_DIR(출력·호출 기록), FAKE_ROUTE=BLOCKED, FAKE_RUN=FAILED|BLOCKED, FAKE_PENDING=N(끝나기 전 inspect 횟수), FAKE_EXT=.png|.wav
const FAKE=`
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
const dir=process.env.FAKE_DIR,calls=path.join(dir,'calls.jsonl'),runs={};
const log=(name,args)=>fs.appendFileSync(calls,JSON.stringify({name,args})+'\\n');
const reply=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\\n');
const tool=(id,value,isError=false)=>reply(id,{content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}],...(isError?{isError:true}:{structuredContent:value})});
readline.createInterface({input:process.stdin}).on('line',line=>{
 const msg=JSON.parse(line);
 if(msg.method==='initialize')return reply(msg.id,{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'fake',version:'0'}});
 if(msg.id===undefined)return;
 if(msg.method!=='tools/call')return reply(msg.id,{});
 const {name,arguments:args}=msg.params;log(name,args);
 if(name==='asset_build_brief'){
  if(!args.request_text)return tool(msg.id,'request_text must not be empty',true);
  return tool(msg.id,{status:'BRIEF_READY',brief:{asset_id:args.asset_id,output_class:args.requested_output_type,prompt:args.request_text,project_id:args.project_id,workflow_preferences:{},
   ...(args.duration_seconds?{audio:{duration_seconds:args.duration_seconds}}:{}),...(args.reference_image?{source:{references:[args.reference_image]}}:{})},review_items:['identity']});
 }
 if(name==='asset_route'){
  if(process.env.FAKE_ROUTE==='BLOCKED')return tool(msg.id,{status:'BLOCKED',selected_workflow:null,missing_requirements:['ComfyUI is not reachable']});
  return tool(msg.id,{status:'ROUTED',selected_workflow:args.brief.workflow_preferences?.id??'anima_base',selected_pipeline:args.brief.output_class});
 }
 if(name==='asset_generate'){
  if(process.env.FAKE_RUN==='BLOCKED')return tool(msg.id,{status:'BLOCKED',run_id:null,outputs:[],review_items:['missing provider']});
  const run_id=String(Object.keys(runs).length+1).padStart(32,'0');
  runs[run_id]={left:Number(process.env.FAKE_PENDING??1),seed:args.seed};
  return tool(msg.id,{run_id,status:'RUNNING',workflow_id:'anima_base',outputs:[],review_items:[]});
 }
 if(name==='asset_inspect_run'){
  const run=runs[args.run_id];
  if(!run)return tool(msg.id,'Unknown run_id',true);
  if(run.left-->0)return tool(msg.id,{run_id:args.run_id,status:run.left%2?'STARTING':'RUNNING',outputs:[]});
  const ext=process.env.FAKE_EXT??'.png',out=path.join(dir,args.run_id+ext),other=path.join(dir,args.run_id+'.flac');
  fs.copyFileSync(path.join(dir,'sample'+ext),out);fs.writeFileSync(other,'x');
  if(process.env.FAKE_RUN==='FAILED')return tool(msg.id,{run_id:args.run_id,status:'FAILED',engine_status:'FAILED',outputs:[out],error:'Pixel Gate FAILED: 17951 colors',qa:[{step:'pixel_gate',status:'FAILED'}]});
  return tool(msg.id,{run_id:args.run_id,status:'REVIEW_REQUIRED',engine_status:'CANDIDATE_READY_REVIEW_REQUIRED',outputs:[other,out],review_items:['CANDIDATE_READY_REVIEW_REQUIRED'],qa:[],game_ready:false,manifest:path.join(dir,'run_manifest.json')});
 }
 tool(msg.id,'Unknown tool',true);
});
`;

function fake(t,{ext='.png',env={}}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-fake-mcp-'));
 fs.writeFileSync(path.join(dir,'server.mjs'),FAKE);
 fs.writeFileSync(path.join(dir,'sample.png'),png(256,256));
 fs.writeFileSync(path.join(dir,'sample.wav'),wav(1.5));
 const server={command:process.execPath,args:[path.join(dir,'server.mjs')],env:{FAKE_DIR:dir,FAKE_EXT:ext,...env}};
 const calls=()=>fs.existsSync(path.join(dir,'calls.jsonl'))?fs.readFileSync(path.join(dir,'calls.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l)):[];
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return {dir,server,calls};
}
// 설계 템플릿을 깐 게임 저장소 폴더와 임시 HFGS_HOME.
function repo(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-assets-repo-'));
 fs.cpSync(path.join(STUDIO_ROOT,'templates','design'),path.join(dir,'design'),{recursive:true});
 fs.mkdirSync(path.join(dir,'design','refs'));
 fs.writeFileSync(path.join(dir,'design','refs','merc.png'),png(256,256));
 const env={...process.env,HFGS_HOME:fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-assets-home-'))};
 t.after(()=>{fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(env.HFGS_HOME,{recursive:true,force:true});});
 return {dir,env};
}
async function withClient(server,fn){
 const client=new McpClient(server);
 await client.start();
 try{return await fn(client);}finally{client.close();}
}
const quick={intervalMs:1,sleep:()=>Promise.resolve()};

test('serverCommand: HFGS_ASSET_MCP가 우선, 없으면 ~/.claude.json의 asset_pipeline, 둘 다 없으면 등록 안내',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-home-'));
 assert.throws(()=>serverCommand({env:{},home}),/mcpServers에 asset_pipeline가 없음.*claude mcp add/);
 fs.writeFileSync(path.join(home,'.claude.json'),JSON.stringify({mcpServers:{asset_pipeline:{type:'stdio',command:'python',args:['launch.py'],env:{A:'1'}}}}));
 const s=serverCommand({env:{},home});
 assert.deepEqual([s.command,s.args,s.env],['python',['launch.py'],{A:'1'}]);
 assert.match(s.source,/claude\.json mcpServers\.asset_pipeline/);
 assert.equal(serverCommand({env:{HFGS_ASSET_MCP:'{"command":"x","args":["--config","a.yaml"]}'},home}).args[1],'a.yaml');
 assert.throws(()=>serverCommand({env:{HFGS_ASSET_MCP:'{"command":"x","type":"http"}'},home}),/stdio 서버만/);
 assert.throws(()=>serverCommand({env:{HFGS_ASSET_MCP:'nope'},home}),/JSON/);
 fs.rmSync(home,{recursive:true,force:true});
});

test('McpClient: initialize 뒤 도구를 부르고 structuredContent를 받으며 isError는 예외로',async t=>{
 const {server}=fake(t);
 await withClient(server,async client=>{
  const r=await client.call('asset_build_brief',{request_text:'a sword',requested_output_type:'SFX',asset_id:'x',project_id:'p'});
  assert.equal(r.status,'BRIEF_READY');
  await assert.rejects(client.call('asset_build_brief',{request_text:''}),/asset_build_brief: request_text must not be empty/);
  await assert.rejects(client.call('asset_inspect_run',{run_id:'zz'}),/Unknown run_id/);
 });
});

test('McpClient: 서버를 띄우지 못하거나 서버가 죽으면 기다리는 요청이 모두 실패한다',async()=>{
 const bad=new McpClient({command:path.join(os.tmpdir(),'no-such-mcp-binary-hfgs'),args:[],env:{}});
 await assert.rejects(bad.start(),/MCP 서버를 띄우지 못함/);
 const dies=new McpClient({command:process.execPath,args:['-e','process.stderr.write("boom");process.exit(3)'],env:{}});
 await assert.rejects(dies.start(),/MCP 서버가 끝남\(3\): boom/);
});

test('target·briefArgs·prepareBrief: 매니페스트의 prompt가 brief가 되고 workflow_id·reference_image·duration이 전달된다',t=>{
 const {dir}=repo(t);
 const image=example('merc-portrait-pipeline.json'),sfx=example('sword-swing-sfx.json'),edit=example('merc-portrait-variant.json');
 const ti=target(image,{repo:dir});
 assert.equal(ti.assetId,'merc-ash');assert.equal(ti.ext,'.png');assert.equal(ti.sfx,false);
 const a=briefArgs(image,ti,{repo:dir});
 assert.equal(a.request_text,ti.spec.prompt);assert.equal(a.requested_output_type,'NONPIXEL_IMAGE');assert.equal(a.project_id,'merc-guild');
 assert.ok(!('duration_seconds' in a)&&!('workflow_id' in a)&&!('reference_image' in a));
 const ts=target(sfx,{repo:dir});
 assert.equal(briefArgs(sfx,ts,{repo:dir}).duration_seconds,1.5);
 const te=target(edit,{repo:dir}),ae=briefArgs(edit,te,{repo:dir});
 assert.equal(ae.workflow_id,edit.asset_pipeline.workflow_id);
 assert.equal(ae.reference_image,path.resolve(dir,edit.asset_pipeline.reference_image));
 const b=prepareBrief({workflow_preferences:{preset:'smoke'}},edit,{...te.spec,negative_prompt:'text, watermark'});
 assert.deepEqual(b.workflow_preferences,{preset:'smoke',id:edit.asset_pipeline.workflow_id,allow_experimental:true});
 assert.equal(b.negative_prompt,'text, watermark');
 assert.deepEqual(prepareBrief({workflow_preferences:{}},image,ti.spec).workflow_preferences,{});
});

test('target: prompt 없는 항목, 매니페스트에 없는 파일, 형식이 다른 output_class, 파일 둘은 거절',t=>{
 const {dir}=repo(t);
 const image=example('merc-portrait-pipeline.json'),manifest=path.join(dir,'design','asset-manifest.json');
 const m=JSON.parse(fs.readFileSync(manifest,'utf8'));
 assert.throws(()=>target({...image,scope:{paths:['assets/portraits/nope.png']}},{repo:dir}),/항목이 없음/);
 assert.throws(()=>target({...image,asset_pipeline:{...image.asset_pipeline,output_class:'SFX'}},{repo:dir}),/형식이 맞지 않음/);
 assert.throws(()=>target({...image,scope:{paths:['assets/portraits/merc-ash.png','assets/sfx/sword-swing.wav']}},{repo:dir}),/하나를 만든다/);
 fs.writeFileSync(manifest,JSON.stringify({assets:m.assets.map(({prompt,...rest})=>rest)}));
 assert.throws(()=>target(image,{repo:dir}),/prompt가 없음/);
});

test('pickOutput: 매니페스트 형식과 같은 출력(SFX는 flac이 아니라 wav)을 고른다',()=>{
 assert.equal(pickOutput(['a/x.flac','a/y.wav'],'.wav'),'a/y.wav');
 assert.equal(pickOutput([{path:'a/x.PNG'}],'.png'),'a/x.PNG');
 assert.equal(pickOutput(['a/x.flac'],'.wav'),null);
 assert.equal(pickOutput(undefined,'.png'),null);
});

test('generate: 후보 2개를 seed 순서대로 만들고, STARTING·RUNNING을 기다리며, 후보를 HFGS_HOME에 저장하고 규격을 검사한다',async t=>{
 const {dir,env}=repo(t),{server,calls}=fake(t,{env:{FAKE_PENDING:'3'}});
 const task=example('merc-portrait-pipeline.json'),logs=[];
 const {note,file}=await withClient(server,client=>generate(task,{repo:dir,client,candidates:2,seed:7,env,log:m=>logs.push(m),...quick}));
 assert.equal(file,noteFile(task.task_id,env));
 assert.equal(note.candidates.length,2);
 assert.deepEqual(note.candidates.map(c=>c.seed),[7,8]);
 assert.deepEqual(note.candidates.map(c=>c.status),['REVIEW_REQUIRED','REVIEW_REQUIRED']);
 assert.equal(note.candidates[0].engine_status,'CANDIDATE_READY_REVIEW_REQUIRED');
 assert.deepEqual(note.candidates[0].review_items,['CANDIDATE_READY_REVIEW_REQUIRED']);
 assert.equal(note.candidates[0].game_ready,false);
 for(const c of note.candidates){
  assert.ok(fs.existsSync(c.candidate),c.candidate);
  assert.ok(c.candidate.startsWith(path.join(env.HFGS_HOME,'assets',task.task_id)));
  assert.deepEqual(c.spec_errors,[]);
 }
 assert.ok(!fs.existsSync(path.join(dir,'assets')),'게임 저장소에는 쓰지 않는다');
 const seq=calls().map(c=>c.name);
 assert.deepEqual(seq.slice(0,3),['asset_build_brief','asset_route','asset_generate']);
 assert.equal(seq.filter(n=>n==='asset_inspect_run').length,8,'run마다 STARTING/RUNNING 3번 + 완료 1번');
 assert.deepEqual(calls().filter(c=>c.name==='asset_generate').map(c=>c.args.seed),[7,8]);
 const brief=calls().find(c=>c.name==='asset_route').args.brief;
 assert.equal(brief.prompt,JSON.parse(fs.readFileSync(path.join(dir,'design','asset-manifest.json'),'utf8')).assets[0].prompt);
 assert.match(logs.join('\n'),/경로: anima_base/);
 assert.match(logs.join('\n'),/후보 2: REVIEW_REQUIRED.*규격 OK/);
 // 다시 돌리면 후보 번호가 이어진다.
 const again=await withClient(server,client=>generate(task,{repo:dir,client,env,...quick}));
 assert.deepEqual(again.note.candidates.map(c=>c.n),[1,2,3]);
 assert.equal(again.note.candidates[2].seed,null);
});

test('generate: SFX는 wav 변환본을 후보로 삼고 매니페스트의 길이·채널 규격을 검사한다',async t=>{
 const {dir,env}=repo(t),{server}=fake(t,{ext:'.wav'});
 const task=example('sword-swing-sfx.json');
 const {note}=await withClient(server,client=>generate(task,{repo:dir,client,env,...quick}));
 assert.match(note.candidates[0].candidate,/\.wav$/);
 assert.deepEqual(note.candidates[0].spec_errors,[]);
 // 규격이 틀린 결과는 저장하되 불일치를 적는다.
 const strict={...task};
 const manifest=path.join(dir,'design','asset-manifest.json'),m=JSON.parse(fs.readFileSync(manifest,'utf8'));
 m.assets.find(a=>a.file===note.file).max_seconds=1;
 fs.writeFileSync(manifest,JSON.stringify(m));
 const {note:n2}=await withClient(server,client=>generate(strict,{repo:dir,client,env,...quick}));
 assert.match(n2.candidates[1].spec_errors.join(),/길이 1\.50초 > 1초/);
});

test('generate: 경로가 차단되면 생성 전에 멈추고, 생성이 차단·실패하면 재시도 없이 멈춘다',async t=>{
 const {dir,env}=repo(t),task=example('merc-portrait-pipeline.json');
 const blocked=fake(t,{env:{FAKE_ROUTE:'BLOCKED'}});
 await assert.rejects(withClient(blocked.server,client=>generate(task,{repo:dir,client,env,...quick})),/asset_route 차단\(BLOCKED\): ComfyUI is not reachable/);
 assert.ok(!blocked.calls().some(c=>c.name==='asset_generate'));
 const noRun=fake(t,{env:{FAKE_RUN:'BLOCKED'}});
 const r1=await withClient(noRun.server,client=>generate(task,{repo:dir,client,env,candidates:3,...quick}));
 assert.equal(r1.note.candidates.length,1);
 assert.equal(r1.note.candidates[0].status,'BLOCKED');
 assert.equal(r1.note.candidates[0].run_id,null);
 assert.match(r1.note.candidates[0].error,/missing provider/);
 const failed=fake(t,{env:{FAKE_RUN:'FAILED'}});
 const r2=await withClient(failed.server,client=>generate({...task,task_id:'other'},{repo:dir,client,env,candidates:3,...quick}));
 assert.equal(r2.note.candidates.length,1,'실패 뒤에는 다음 후보를 만들지 않는다');
 assert.equal(r2.note.candidates[0].status,'FAILED');
 assert.match(r2.note.candidates[0].error,/Pixel Gate/);
 assert.ok(r2.note.candidates[0].candidate,'실패한 결과물도 사용자가 볼 수 있게 남긴다');
 assert.equal(failed.calls().filter(c=>c.name==='asset_generate').length,1);
});

test('generate: 시간 안에 끝나지 않으면 TIMEOUT으로 적고 멈춘다',async t=>{
 const {dir,env}=repo(t),{server}=fake(t,{env:{FAKE_PENDING:'1000'}});
 const task=example('merc-portrait-pipeline.json');
 const {note}=await withClient(server,client=>generate(task,{repo:dir,client,env,candidates:2,timeoutMs:0,...quick}));
 assert.equal(note.candidates.length,1);
 assert.equal(note.candidates[0].status,'TIMEOUT');
 assert.match(note.candidates[0].error,/계속 돌 수 있다/);
});

test('generate: 잘못된 작업 파일·옵션은 plan과 같은 기준으로 거절한다',async t=>{
 const {dir,env}=repo(t),{server,calls}=fake(t);
 const task=example('merc-portrait-pipeline.json');
 await withClient(server,async client=>{
  await assert.rejects(generate(task,{repo:dir,client,env,candidates:0}),/--candidates는 1~8/);
  await assert.rejects(generate(task,{repo:dir,client,env,seed:-1}),/--seed/);
  const {asset_pipeline,...without}=task;
  await assert.rejects(generate(without,{repo:dir,client,env}),/asset_pipeline이 필요함/);
  await assert.rejects(generate(example('merc-data.json'),{repo:dir,client,env}),/asset-pipeline 작업이 아님/);
 });
 assert.equal(calls().length,0);
});

test('pick: --approved 없이는 거절하고, 승인된 후보만 매니페스트 경로로 복사하고 노트에 남긴다',async t=>{
 const {dir,env}=repo(t),{server}=fake(t);
 const task=example('merc-portrait-pipeline.json');
 assert.throws(()=>pick(task,1,{repo:dir,env,approved:true}),/작업 노트가 없음/);
 const {note}=await withClient(server,client=>generate(task,{repo:dir,client,env,candidates:2,...quick}));
 assert.throws(()=>pick(task,1,{repo:dir,env}),/--approved가 필요함/);
 assert.throws(()=>pick(task,9,{repo:dir,env,approved:true}),/후보 9이 없음\(있는 번호: 1, 2\)/);
 const dest=path.join(dir,'assets','portraits','merc-ash.png');
 assert.ok(!fs.existsSync(dest));
 const r=pick(task,2,{repo:dir,env,approved:true});
 assert.equal(r.dest,dest);
 assert.ok(fs.readFileSync(dest).equals(fs.readFileSync(note.candidates[1].candidate)));
 const saved=JSON.parse(fs.readFileSync(noteFile(task.task_id,env),'utf8'));
 assert.equal(saved.picked.n,2);
 assert.equal(saved.picked.run_id,note.candidates[1].run_id);
 assert.equal(saved.picked.approved_by_user,true);
 // run_id로도 고를 수 있다.
 assert.equal(pick(task,note.candidates[0].run_id,{repo:dir,env,approved:true}).candidate.n,1);
});

test('pick: 규격에 맞지 않는 후보는 거절하고, 변환한 파일은 --from으로(저장소 밖) 넘긴다',async t=>{
 const {dir,env}=repo(t),{server}=fake(t);
 const task=example('merc-portrait-pipeline.json');
 const manifest=path.join(dir,'design','asset-manifest.json'),m=JSON.parse(fs.readFileSync(manifest,'utf8'));
 m.assets[0].width=128;m.assets[0].height=128;
 fs.writeFileSync(manifest,JSON.stringify(m));
 const {note}=await withClient(server,client=>generate(task,{repo:dir,client,env,...quick}));
 assert.match(note.candidates[0].spec_errors.join(),/너비 256, 기대 128/);
 assert.throws(()=>pick(task,1,{repo:dir,env,approved:true}),/매니페스트 규격에 맞지 않음.*--from/);
 const resized=path.join(env.HFGS_HOME,'resized.png');
 fs.writeFileSync(resized,png(128,128));
 assert.throws(()=>pick(task,1,{repo:dir,env,approved:true,from:'assets/portraits/merc-ash.png'}),/매니페스트 경로 자체/);
 const r=pick(task,1,{repo:dir,env,approved:true,from:resized});
 assert.ok(fs.existsSync(r.dest));
 assert.match(r.note.picked.from,/resized\.png$/);
 // 결과 파일이 없는 후보(차단)는 --from 없이는 고를 수 없다.
 const blocked=fake(t,{env:{FAKE_RUN:'BLOCKED'}});
 const other={...task,task_id:'blocked-task'};
 await withClient(blocked.server,client=>generate(other,{repo:dir,client,env,...quick}));
 assert.throws(()=>pick(other,1,{repo:dir,env,approved:true}),/결과 파일이 없음\(BLOCKED/);
});

test('PENDING은 task.mjs가 리드에게 기다리라고 하는 상태와 같다',()=>{
 assert.deepEqual(PENDING,['STARTING','RUNNING']);
});
