#!/usr/bin/env node
// 이미지·효과음을 asset-pipeline MCP 서버로 만든다(v2 5단계). 리드는 그림을 그리거나 소리를 합성하지 않고
// 이 스크립트가 MCP 서버를 stdio로 직접 띄워 asset_build_brief → asset_route → asset_generate → asset_inspect_run을
// 한 프로세스 수명 안에서 돈다(서버가 죽으면 STARTING인 run의 자식 프로세스를 더 추적할 수 없다).
// 프롬프트는 작업 파일이 아니라 애셋 매니페스트 항목(prompt, negative_prompt)에서 읽는다. 매니페스트는 검사 기준 파일이라
// 작업 범위 밖에 있고, 무엇을 만들지와 어떤 규격이어야 하는지가 한 곳에 있게 된다.
//
//   generate TASK.json   후보를 만든다. 결과는 HFGS_HOME/assets/<task_id>/에 모이고 게임 저장소에는 쓰지 않는다.
//   pick     TASK.json N 사용자가 보고 들어 고른 후보 N을 매니페스트 경로로 복사한다(--approved 필수).
//   status   TASK.json   run_id·상태·검토 상태가 적힌 작업 노트를 보여 준다.
// 사용법:
//   node scripts/assets.mjs generate TASK.json [--repo DIR] [--candidates N] [--seed S] [--interval SEC] [--timeout MIN] [--json]
//   node scripts/assets.mjs pick TASK.json <N> --approved [--from FILE] [--repo DIR]
//   node scripts/assets.mjs status TASK.json
// MCP 서버는 HFGS_ASSET_MCP(JSON {"command":..,"args":[..],"env":{..}})가 있으면 그것을, 없으면 현재 호스트 우선으로
// Antigravity·Gemini(~/.gemini/config/mcp_config.json 및 활성 플러그인, ~/.gemini/settings.json)·Claude(~/.claude.json)·Codex(~/.codex/config.toml)에서 찾는다.
// 종료 코드: 성공 0, 생성 실패·차단 1, 사용법·환경 오류 2.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {spawn as spawnChild} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {plan,loadKinds,homeDir} from './task.mjs';
import {resolveHost,normalizeHost} from './lib/host.mjs';
import {checkAsset} from '../tools/check-assets.mjs';

function fail(m,usage=true){throw Object.assign(Error(m),{usage});}
const str=v=>typeof v==='string'&&v.trim().length>0;
export const PENDING=['STARTING','RUNNING'];
const SERVER_KEYS=['asset_pipeline','asset-pipeline','assetpipe'];

// Antigravity의 plugin.json은 JSONC(주석·후행 쉼표)를 허용한다. 문자열 안의 "//"나 쉼표는 건드리지 않는다.
export function parseJsonc(text){
 const src=String(text??'').replace(/^\uFEFF/,'');
 let noComments='',inString=false;
 for(let i=0;i<src.length;i++){
  const c=src[i],n=src[i+1];
  if(inString){
   noComments+=c;
   if(c==='\\'){if(i+1<src.length)noComments+=src[++i];}
   else if(c==='"')inString=false;
   continue;
  }
  if(c==='"'){inString=true;noComments+=c;continue;}
  if(c==='/'&&n==='/'){while(i<src.length&&src[i]!=='\n')i++;if(i<src.length)noComments+='\n';continue;}
  if(c==='/'&&n==='*'){i+=2;while(i<src.length&&!(src[i]==='*'&&src[i+1]==='/'))i++;i++;continue;}
  noComments+=c;
 }
 let cleaned='',str2=false;
 for(let i=0;i<noComments.length;i++){
  const c=noComments[i];
  if(str2){
   cleaned+=c;
   if(c==='\\'){if(i+1<noComments.length)cleaned+=noComments[++i];}
   else if(c==='"')str2=false;
   continue;
  }
  if(c==='"'){str2=true;cleaned+=c;continue;}
  if(c===','){
   let j=i+1;
   while(j<noComments.length&&/\s/.test(noComments[j]))j++;
   if(noComments[j]==='}'||noComments[j]===']')continue;
  }
  cleaned+=c;
 }
 return JSON.parse(cleaned);
}
const readJsonc=file=>{try{return parseJsonc(fs.readFileSync(file,'utf8'));}catch{return null;}};
const pickServer=file=>{
 const servers=readJsonc(file)?.mcpServers??{};
 const key=SERVER_KEYS.find(k=>servers[k]&&servers[k].disabled!==true);
 return key?{entry:servers[key],source:`${file} mcpServers.${key}`}:null;
};

// Codex config.toml에서 [mcp_servers.*] 및 [mcp_servers.*.env] 테이블만 읽는다.
export function parseCodexMcpToml(text){
 const src=String(text??'').replace(/^\uFEFF/,''),servers={};
 const skipInline=(s,i)=>{while(i<s.length&&(s[i]===' '||s[i]==='\t'))i++;return i;};
 const skipAll=(s,i)=>{
  while(i<s.length){
   const c=s[i];
   if(c===' '||c==='\t'||c==='\r'||c==='\n'){i++;continue;}
   if(c==='#'){while(i<s.length&&s[i]!=='\n')i++;continue;}
   break;
  }
  return i;
 };
 const skipLine=(s,i)=>{while(i<s.length&&s[i]!=='\n')i++;return i<s.length?i+1:i;};
 const readStr=(s,i)=>{
  const q=s[i++];
  let out='';
  if(q==="'"){
   while(i<s.length&&s[i]!=="'"&&s[i]!=='\n')out+=s[i++];
   if(s[i]==="'")i++;
   return {value:out,next:i};
  }
  const ESC={b:'\b',t:'\t',n:'\n',f:'\f',r:'\r','"':'"','\\':'\\'};
  while(i<s.length&&s[i]!=='"'){
   if(s[i]==='\\'&&i+1<s.length){
    const e=s[++i];
    if(ESC[e]!==undefined){out+=ESC[e];i++;}
    else if(e==='u'&&/^[0-9a-fA-F]{4}$/.test(s.slice(i+1,i+5))){out+=String.fromCodePoint(parseInt(s.slice(i+1,i+5),16));i+=5;}
    else if(e==='U'&&/^[0-9a-fA-F]{8}$/.test(s.slice(i+1,i+9))){out+=String.fromCodePoint(parseInt(s.slice(i+1,i+9),16));i+=9;}
    else{out+=e;i++;}
    continue;
   }
   out+=s[i++];
  }
  if(s[i]==='"')i++;
  return {value:out,next:i};
 };
 const readKeyParts=(s,i)=>{
  const parts=[];
  for(;;){
   i=skipInline(s,i);
   if(s[i]==='"'||s[i]==="'"){const r=readStr(s,i);parts.push(r.value);i=r.next;}
   else{
    const start=i;
    while(i<s.length&&/[A-Za-z0-9_-]/.test(s[i]))i++;
    if(i===start)break;
    parts.push(s.slice(start,i));
   }
   i=skipInline(s,i);
   if(s[i]==='.')i++;else break;
  }
  return {parts,next:i};
 };
 const readVal=(s,i)=>{
  i=skipInline(s,i);
  if(s[i]==='"'||s[i]==="'")return readStr(s,i);
  if(s[i]==='['){
   const arr=[];i++;
   for(;;){
    i=skipAll(s,i);
    if(i>=s.length||s[i]===']')return {value:arr,next:i<s.length?i+1:i};
    const item=readVal(s,i);
    arr.push(item.value);
    i=skipAll(s,item.next);
    if(s[i]===',')i++;
    else if(s[i]===']')return {value:arr,next:i+1};
    else break;
   }
   return {value:arr,next:i};
  }
  if(s[i]==='{'){
   const obj={};i++;
   for(;;){
    i=skipAll(s,i);
    if(i>=s.length||s[i]==='}')return {value:obj,next:i<s.length?i+1:i};
    const k=readKeyParts(s,i);
    i=skipInline(s,k.next);
    if(!k.parts.length||s[i]!=='=')break;
    const v=readVal(s,i+1);
    obj[k.parts.join('.')]=String(v.value);
    i=skipAll(s,v.next);
    if(s[i]===',')i++;
    else if(s[i]==='}')return {value:obj,next:i+1};
    else break;
   }
   return {value:obj,next:i};
  }
  const start=i;
  while(i<s.length&&!/[\s,\[\]{}#]/.test(s[i]))i++;
  const raw=s.slice(start,i);
  if(raw==='true')return {value:true,next:i};
  if(raw==='false')return {value:false,next:i};
  return {value:raw,next:i};
 };

 let cur=null,i=0;
 while(i<src.length){
  i=skipAll(src,i);
  if(i>=src.length)break;
  if(src[i]==='['){
   if(src[i+1]==='['){cur=null;i=skipLine(src,i);continue;}
   const {parts,next}=readKeyParts(src,i+1);
   i=skipInline(src,next);
   if(src[i]===']')i=skipLine(src,i+1);else{cur=null;i=skipLine(src,i);continue;}
   if(parts[0]==='mcp_servers'&&parts.length===2){
    cur={name:parts[1],sub:null};
    servers[cur.name]??={env:{}};
   }else if(parts[0]==='mcp_servers'&&parts.length===3&&parts[2]==='env'){
    cur={name:parts[1],sub:'env'};
    servers[cur.name]??={env:{}};
   }else cur=null;
   continue;
  }
  const {parts,next}=readKeyParts(src,i);
  i=skipInline(src,next);
  if(!parts.length||src[i]!=='='){i=skipLine(src,i);continue;}
  const {value,next:after}=readVal(src,i+1);
  i=after;
  if(!cur)continue;
  const entry=servers[cur.name];
  if(cur.sub==='env'&&parts.length===1){entry.env[parts[0]]=String(value);continue;}
  if(cur.sub!==null)continue;
  if(parts.length===2&&parts[0]==='env'){entry.env[parts[1]]=String(value);continue;}
  if(parts.length!==1)continue;
  const k=parts[0];
  if(k==='enabled')entry.disabled=!value;
  else if(k==='disabled')entry.disabled=Boolean(value);
  else if(k==='env'&&value&&typeof value==='object'&&!Array.isArray(value))entry.env={...entry.env,...value};
  else if(['command','args','url','serverUrl','type'].includes(k))entry[k]=value;
 }
 return servers;
}

function findAntigravityServer(home){
 const configDir=path.join(home,'.gemini','config');
 const hit=pickServer(path.join(configDir,'mcp_config.json'));
 if(hit)return hit;
 const pluginsDir=path.join(configDir,'plugins');
 const pluginStates=readJsonc(path.join(configDir,'config.json'))?.plugins??{};
 let dirs=[];
 try{dirs=fs.readdirSync(pluginsDir).sort();}catch{}
 for(const dir of dirs){
  const pluginPath=path.join(pluginsDir,dir);
  try{if(!fs.statSync(pluginPath).isDirectory())continue;}catch{continue;}
  const manifest=readJsonc(path.join(pluginPath,'plugin.json'));
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))continue;
  const override=pluginStates[dir]?.enabled;
  const enabled=typeof override==='boolean'?override:manifest.disabled!==true;
  if(!enabled)continue;
  const pluginHit=pickServer(path.join(pluginPath,'mcp_config.json'));
  if(pluginHit)return pluginHit;
 }
 return pickServer(path.join(home,'.gemini','settings.json'));
}

function findClaudeServer(home){
 return pickServer(path.join(home,'.claude.json'));
}

function findCodexServer(home,env){
 const file=path.join(env.CODEX_HOME||path.join(home,'.codex'),'config.toml');
 let text;
 try{text=fs.readFileSync(file,'utf8');}catch{return null;}
 const servers=parseCodexMcpToml(text);
 const key=SERVER_KEYS.find(k=>servers[k]&&servers[k].disabled!==true);
 return key?{entry:servers[key],source:`${file} mcp_servers.${key}`}:null;
}

// MCP 서버 명령. 스크립트가 서버를 직접 띄우므로 현재 호스트를 우선해 등록된 설정을 읽는다.
export function serverCommand({env=process.env,home=os.homedir(),host}={}){
 let found,source;
 if(env.HFGS_ASSET_MCP){
  try{found=JSON.parse(env.HFGS_ASSET_MCP);}catch{fail('HFGS_ASSET_MCP는 {"command": "...", "args": [...]} JSON');}
  source='HFGS_ASSET_MCP';
 }else{
  const resolved=host!==undefined&&host!==null?{host:normalizeHost(host),source:'flag'}:resolveHost({env});
  const mapped=resolved.source==='default'?null:(resolved.host==='gemini'?'agy':resolved.host);
  const order=mapped?[mapped,...['agy','claude','codex'].filter(h=>h!==mapped)]:['agy','claude','codex'];
  const finders={
   agy:()=>findAntigravityServer(home),
   claude:()=>findClaudeServer(home),
   codex:()=>findCodexServer(home,env)
  };
  for(const h of order){
   const hit=finders[h]();
   if(hit){found=hit.entry;source=hit.source;break;}
  }
  if(!found)fail(`asset-pipeline MCP 서버를 찾지 못함: ~/.gemini/config/mcp_config.json(및 활성 플러그인), ~/.claude.json, ~/.codex/config.toml에 ${SERVER_KEYS[0]}가 없음. `
   +'사용 중인 호스트(Antigravity·Claude Code·Codex)에 asset_pipeline MCP를 등록하거나 HFGS_ASSET_MCP에 명령을 JSON으로 적을 것');
 }
 if((found.type!==undefined&&found.type!=='stdio')||found.url!==undefined||found.serverUrl!==undefined)
  fail(`${source}: stdio 서버만 띄울 수 있음(type: ${found.type??'http'})`);
 if(!str(found.command))fail(`${source}: command가 없음`);
 const args=found.args??[];
 if(!Array.isArray(args)||!args.every(str))fail(`${source}: args는 문자열 배열`);
 return {command:found.command,args,env:found.env??{},source};
}

// 최소 MCP 클라이언트(stdio, 줄 단위 JSON-RPC). 도구 호출 하나가 요청 하나다.
export class McpClient{
 constructor(server,{spawn=spawnChild,env=process.env}={}){
  this.server=server;this.spawn=spawn;this.env=env;this.pending=new Map();this.id=0;this.stderr='';
 }
 start(){
  const {command,args,env}=this.server;
  this.child=this.spawn(command,args,{env:{...this.env,...env},stdio:['pipe','pipe','pipe'],windowsHide:true});
  this.child.on('error',e=>this.abort(Error(`MCP 서버를 띄우지 못함(${command}): ${e.message}`)));
  this.child.on('exit',(code,signal)=>this.abort(Error(`MCP 서버가 끝남(${signal??code})${this.stderr?': '+this.stderr.trim().slice(-800):''}`)));
  this.child.stderr.on('data',d=>{this.stderr=(this.stderr+d).slice(-4000);});
  readline.createInterface({input:this.child.stdout}).on('line',line=>{
   if(!line.trim())return;
   let msg;
   try{msg=JSON.parse(line);}catch{return;}
   const p=this.pending.get(msg.id);
   if(!p)return;
   this.pending.delete(msg.id);
   if(msg.error)p.reject(Error(`MCP ${p.method}: ${msg.error.message??JSON.stringify(msg.error)}`));else p.resolve(msg.result);
  });
  return this.request('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'hf-game-studio',version:'0.1.0'}})
   .then(r=>{this.notify('notifications/initialized');return r;});
 }
 abort(err){
  this.exited=err;
  for(const p of this.pending.values())p.reject(err);
  this.pending.clear();
 }
 send(msg){
  if(this.exited)throw this.exited;
  this.child.stdin.write(JSON.stringify(msg)+'\n');
 }
 notify(method,params){this.send({jsonrpc:'2.0',method,...(params?{params}:{})});}
 request(method,params,{timeoutMs=5*60*1000}={}){
  const id=++this.id;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending.delete(id);reject(Error(`MCP ${method}: ${Math.round(timeoutMs/1000)}초 안에 응답이 없음`));},timeoutMs);
   this.pending.set(id,{method,resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});
   try{this.send({jsonrpc:'2.0',id,method,params});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}
  });
 }
 // 도구 결과는 structuredContent가 있으면 그것, 없으면 첫 텍스트를 JSON으로 읽는다. isError는 서버 쪽 예외다.
 async call(name,args={}){
  const r=await this.request('tools/call',{name,arguments:args});
  const text=(r.content??[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
  if(r.isError)throw Object.assign(Error(`${name}: ${text||'도구 오류'}`),{usage:false,tool:name});
  if(r.structuredContent!==undefined)return r.structuredContent;
  try{return JSON.parse(text);}catch{return text;}
 }
 close(){
  if(!this.child||this.exited)return;
  try{this.child.stdin.end();}catch{}
  this.child.kill();
 }
}

export const noteFile=(taskId,env=process.env)=>path.join(homeDir(env),'assets',`${taskId}.json`);
export const candidateDir=(taskId,env=process.env)=>path.join(homeDir(env),'assets',taskId);
export function readNote(taskId,env=process.env){
 const f=noteFile(taskId,env);
 if(!fs.existsSync(f))fail(`작업 노트가 없음: ${f} (먼저 generate를 돌릴 것)`);
 return JSON.parse(fs.readFileSync(f,'utf8'));
}
function writeNote(note,env){
 const f=noteFile(note.task_id,env);
 fs.mkdirSync(path.dirname(f),{recursive:true});
 fs.writeFileSync(f,JSON.stringify(note,null,1)+'\n');
 return f;
}

// 작업이 만들 애셋과 그 매니페스트 항목. 애셋 작업은 파일 하나를 만든다(후보가 여럿이어도 고르는 것은 하나).
export function target(task,{repo}){
 const kind=loadKinds().kinds[task.kind];
 if(!kind?.pipeline)fail(`${task.kind}는 asset-pipeline 작업이 아님`);
 const files=task.asset_files??task.scope.paths.filter(p=>/\.(png|wav)$/i.test(p));
 if(files.length!==1)fail(`애셋 작업은 PNG·WAV 하나를 만든다: scope.paths(또는 asset_files)에 ${files.length}개`);
 const [file]=files;
 const manifestPath=path.join(repo,task.assets_manifest);
 let manifest;
 try{manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));}catch(e){fail(`매니페스트를 읽을 수 없음(${task.assets_manifest}): ${e.message}`);}
 const spec=(manifest.assets??[]).find(a=>a.file===file);
 if(!spec)fail(`매니페스트(${task.assets_manifest})에 ${file} 항목이 없음`);
 if(!str(spec.prompt))fail(`매니페스트 항목 ${file}에 prompt가 없음: 무엇을 만들지는 매니페스트에 적는다(검사 기준과 한 곳)`);
 if(spec.negative_prompt!==undefined&&!str(spec.negative_prompt))fail(`매니페스트 항목 ${file}의 negative_prompt는 비지 않은 문자열`);
 const sfx=task.asset_pipeline.output_class==='SFX';
 if(sfx!==/\.wav$/i.test(file))fail(`output_class ${task.asset_pipeline.output_class}와 파일 ${file}의 형식이 맞지 않음`);
 const assetId=path.basename(file).replace(/\.[^.]+$/,'').replace(/[^A-Za-z0-9_-]/g,'-').slice(0,64)||'asset';
 return {file,spec,assetId,sfx,ext:path.extname(file).toLowerCase()};
}

// asset_build_brief 인자. task.mjs의 pipelineDirectives가 리드에게 시키는 것과 같은 값이다.
export function briefArgs(task,{file,spec,assetId},{repo}){
 const p=task.asset_pipeline;
 const args={request_text:spec.prompt,requested_output_type:p.output_class,asset_id:assetId,project_id:p.project_id};
 if(p.duration_seconds!==undefined)args.duration_seconds=p.duration_seconds;
 if(p.workflow_id)args.workflow_id=p.workflow_id;
 if(p.reference_image)args.reference_image=path.resolve(repo,p.reference_image);
 return args;
}
// 매니페스트 규격을 brief의 constraints로 넘긴다. asset-pipeline(PR 43 이후)은 resolution과 transparency가 있으면
// 리사이즈·배경 제거를 돌리고 max_file_kb를 넘는 파일은 QA에서 FAIL로 처리한다. 그래서 후보가 처음부터 매니페스트에 맞게 나온다.
// 단 PIXEL_STATIC에는 resolution을 넘기지 않는다. asset-pipeline이 그 크기로 바로 그려서(128×128) 픽셀 워크플로가 캐릭터 대신
// 색 덩어리를 냈다(마일스톤 3 실측). 워크플로 기본 크기로 생성하고, 매니페스트보다 크면 리드가 최근접 축소만 해 pick --from으로 넘긴다.
export function prepareBrief(brief,task,spec){
 const out={...brief};
 if(task.asset_pipeline.workflow_id)out.workflow_preferences={...(brief.workflow_preferences??{}),id:task.asset_pipeline.workflow_id,allow_experimental:true};
 if(spec.negative_prompt)out.negative_prompt=spec.negative_prompt;
 if(!/\.wav$/i.test(spec.file)){
  const c={...(brief.constraints??{})};
  if(task.asset_pipeline.output_class==='PIXEL_STATIC')delete c.resolution;
  else if(spec.width!==undefined&&spec.height!==undefined)c.resolution=[spec.width,spec.height];
  if(spec.alpha===true)c.transparency=true;
  if(spec.max_kb!==undefined)c.max_file_kb=spec.max_kb;
  out.constraints=c;
 }
 return out;
}

// 생성 단계 원본(asset-pipeline run 폴더의 010_generation). 후처리(정제·양자화·리사이즈) 전 그림이라, 후보가 엉터리일 때
// 생성부터 망가졌는지 후처리에서 망가졌는지 사용자와 함께 바로 가를 수 있다. 규격 검사와 Pixel Gate는 그림 내용을 보지 않는다.
export function rawOutput(manifest){
 if(!manifest)return null;
 const dir=path.join(path.dirname(manifest),'010_generation');
 if(!fs.existsSync(dir))return null;
 const png=fs.readdirSync(dir).filter(f=>/\.png$/i.test(f)).sort()[0];
 return png?path.join(dir,png):null;
}

// inspect 결과의 outputs 중 매니페스트 파일과 같은 형식인 것. SFX는 flac 원본과 wav 변환본이 함께 나오므로 wav를 고른다.
export function pickOutput(outputs,ext){
 const list=(outputs??[]).map(o=>typeof o==='string'?o:o?.path).filter(Boolean);
 return list.find(f=>f.toLowerCase().endsWith(ext))??null;
}

const sleepMs=ms=>new Promise(r=>setTimeout(r,ms));
const relSafe=(repo,f)=>path.relative(repo,f).split(path.sep).join('/');

export async function generate(task,{repo=process.cwd(),client,candidates=1,seed,intervalMs=5000,timeoutMs=30*60*1000,env=process.env,log=()=>{},sleep=sleepMs}={}){
 if(!Number.isInteger(candidates)||candidates<1||candidates>8)fail('--candidates는 1~8');
 if(seed!==undefined&&(!Number.isInteger(seed)||seed<0))fail('--seed는 0 이상의 정수');
 plan(task,{repo,warn:m=>log(`경고: ${m}`),baselineWarning:false});
 const t=target(task,{repo});
 const dir=candidateDir(task.task_id,env);
 fs.mkdirSync(dir,{recursive:true});
 let note;
 try{note=readNote(task.task_id,env);}catch{note={task_id:task.task_id,file:t.file,project_id:task.asset_pipeline.project_id,output_class:task.asset_pipeline.output_class,candidates:[]};}
 note.file=t.file;
 const save=()=>writeNote(note,env);

 const built=await client.call('asset_build_brief',briefArgs(task,t,{repo}));
 if(built.status!=='BRIEF_READY'||!built.brief)fail(`asset_build_brief가 brief를 만들지 못함(${built.status}): ${(built.review_items??[]).join('; ')}`,false);
 const brief=prepareBrief(built.brief,task,t.spec);
 const route=await client.call('asset_route',{brief});
 if(route.status!=='ROUTED')fail(`asset_route 차단(${route.status}): ${(route.missing_requirements??[route.reason]).filter(Boolean).join('; ')}`,false);
 log(`경로: ${route.selected_workflow} (${route.selected_pipeline})`);

 const started=note.candidates.length;
 for(let i=0;i<candidates;i++){
  const n=started+i+1,runSeed=seed===undefined?null:seed+i;
  const g=await client.call('asset_generate',{brief,seed:runSeed});
  const cand={n,run_id:g.run_id??null,seed:runSeed,workflow_id:g.workflow_id??route.selected_workflow,status:g.status,engine_status:null,review_items:g.review_items??[],qa:[],output:null,candidate:null,spec_errors:null,error:g.error??null,started_at:new Date().toISOString()};
  note.candidates.push(cand);save();
  if(!g.run_id||!PENDING.includes(g.status)){
   cand.error=cand.error??(cand.review_items.join('; ')||g.status);
   log(`후보 ${n}: 시작 못 함(${g.status}): ${cand.error}`);
   break;
  }
  log(`후보 ${n}: run ${g.run_id} 시작${runSeed===null?'':` (seed ${runSeed})`}`);
  const deadline=Date.now()+timeoutMs;
  let r;
  for(;;){
   r=await client.call('asset_inspect_run',{run_id:g.run_id});
   if(!PENDING.includes(r.status))break;
   if(Date.now()>=deadline){r={...r,status:'TIMEOUT',error:`${Math.round(timeoutMs/60000)}분 안에 끝나지 않음. asset-pipeline 쪽에서는 계속 돌 수 있다`};break;}
   await sleep(intervalMs);
  }
  Object.assign(cand,{status:r.status,engine_status:r.engine_status??null,review_items:r.review_items??[],qa:r.qa??[],error:r.error??null,manifest:r.manifest??null,game_ready:r.game_ready??false,finished_at:new Date().toISOString()});
  const out=pickOutput(r.outputs,t.ext);
  if(out&&fs.existsSync(out)){
   const copy=path.join(dir,`${String(n).padStart(2,'0')}-${g.run_id}${t.ext}`);
   fs.copyFileSync(out,copy);
   cand.output=out;cand.candidate=copy;
   cand.spec_errors=checkAsset({...t.spec,file:copy});
   const raw=t.sfx?null:rawOutput(r.manifest);
   if(raw&&path.resolve(raw)!==path.resolve(out)){
    cand.raw=path.join(dir,`${String(n).padStart(2,'0')}-${g.run_id}-raw${path.extname(raw).toLowerCase()}`);
    fs.copyFileSync(raw,cand.raw);
   }
  }else if(r.status!=='FAILED'&&r.status!=='TIMEOUT')cand.error=cand.error??`outputs에 ${t.ext} 파일이 없음`;
  save();
  log(`후보 ${n}: ${cand.status}${cand.engine_status?` (${cand.engine_status})`:''}${cand.candidate?` → ${cand.candidate}`:''}${cand.raw?` (생성 원본 ${cand.raw})`:''}${cand.spec_errors?.length?` 규격 불일치: ${cand.spec_errors.join('; ')}`:cand.spec_errors?' 규격 OK':''}${cand.error?` 오류: ${cand.error}`:''}`);
  // 실패하면 재시도 없이 멈추고 사용자와 상의한다(SKILL 규칙).
  if(r.status==='FAILED'||r.status==='TIMEOUT')break;
 }
 return {note,file:save(),dir};
}

export function pick(task,n,{repo=process.cwd(),approved=false,from,env=process.env}={}){
 if(!approved)fail('pick에는 --approved가 필요함: 사용자가 후보를 직접 보고(들고) 승인했을 때만 매니페스트 경로로 옮긴다');
 const note=readNote(task.task_id,env);
 const cand=note.candidates.find(c=>c.n===n||c.run_id===String(n));
 if(!cand)fail(`후보 ${n}이 없음(있는 번호: ${note.candidates.map(c=>c.n).join(', ')||'없음'})`);
 if(!cand.candidate&&!from)fail(`후보 ${cand.n}에는 결과 파일이 없음(${cand.status}${cand.error?': '+cand.error:''})`);
 const t=target(task,{repo});
 const source=from?path.resolve(repo,from):cand.candidate;
 if(from&&path.resolve(source)===path.resolve(repo,t.file))fail('--from이 매니페스트 경로 자체임: 변환한 파일은 저장소 밖(후보 폴더 등)에 두고 pick이 옮기게 할 것');
 if(!fs.existsSync(source))fail(`파일이 없음: ${source}`);
 const errors=checkAsset({...t.spec,file:source});
 if(errors.length)fail(`매니페스트 규격에 맞지 않음: ${errors.join('; ')}. 형식 변환·리사이즈만 해서 저장소 밖에 둔 뒤 --from으로 넘길 것(다시 그리거나 편집하지 않는다)`,false);
 const dest=path.join(repo,t.file);
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 fs.copyFileSync(source,dest);
 note.picked={n:cand.n,run_id:cand.run_id,from:from?relSafe(repo,source):null,approved_by_user:true,at:new Date().toISOString()};
 writeNote(note,env);
 return {dest,candidate:cand,note};
}

function parseArgs(argv){
 const [command,taskFile,...rest]=argv,opts={positional:[]};
 const FLAGS={'--repo':'repo','--candidates':'candidates','--seed':'seed','--interval':'interval','--timeout':'timeout','--from':'from'};
 for(let i=0;i<rest.length;i++){
  const a=rest[i];
  if(a==='--json')opts.json=true;
  else if(a==='--approved')opts.approved=true;
  else if(FLAGS[a]){if(rest[i+1]===undefined)fail(`${a}에 값이 없음`);opts[FLAGS[a]]=rest[++i];}
  else if(a.startsWith('--'))fail(`알 수 없는 옵션: ${a}`);
  else opts.positional.push(a);
 }
 return {command,taskFile,opts};
}
const int=(v,name)=>{const n=Number(v);if(!Number.isInteger(n))fail(`${name}는 정수`);return n;};

async function main(argv){
 const {command,taskFile,opts}=parseArgs(argv);
 if(!['generate','pick','status'].includes(command)||!taskFile)fail('사용법: assets.mjs <generate|pick|status> TASK.json [...]');
 const task=JSON.parse(fs.readFileSync(taskFile,'utf8'));
 const repo=path.resolve(opts.repo??process.cwd());
 if(command==='status'){
  const note=readNote(task.task_id);
  console.log(JSON.stringify(note,null,1));
  return 0;
 }
 if(command==='pick'){
  const [n]=opts.positional;
  if(n===undefined)fail('pick에는 후보 번호가 필요함');
  const {dest,candidate}=pick(task,/^\d+$/.test(n)?Number(n):n,{repo,approved:opts.approved===true,from:opts.from});
  console.log(`후보 ${candidate.n}(run ${candidate.run_id}) → ${relSafe(repo,dest)}. 다음: task.mjs verify`);
  return 0;
 }
 const client=new McpClient(serverCommand());
 await client.start();
 try{
  const {note,file}=await generate(task,{repo,client,
   candidates:opts.candidates===undefined?1:int(opts.candidates,'--candidates'),
   seed:opts.seed===undefined?undefined:int(opts.seed,'--seed'),
   intervalMs:opts.interval===undefined?5000:Number(opts.interval)*1000,
   timeoutMs:opts.timeout===undefined?30*60*1000:Number(opts.timeout)*60*1000,
   log:m=>console.error(m)});
  if(opts.json)console.log(JSON.stringify(note,null,1));
  else{
   for(const c of note.candidates)console.log(`${c.n}\t${c.run_id??'-'}\t${c.status}${c.engine_status?`(${c.engine_status})`:''}\t${c.spec_errors===null?'-':c.spec_errors.length?'규격 불일치':'규격 OK'}\t${c.candidate??c.error??''}`);
   console.log(`노트: ${file}`);
   console.log('후보는 사용자가 보고(들고) 고른다. 이미지는 생성 원본(-raw)도 함께 보여 줄 것(규격 OK는 그림 내용을 보증하지 않음). 고르면: assets.mjs pick TASK.json <번호> --approved');
  }
  const last=note.candidates.at(-1);
  return last&&!['FAILED','TIMEOUT','BLOCKED'].includes(last.status)&&last.run_id?0:1;
 }finally{client.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(fs.realpathSync(process.argv[1])).href){
 main(process.argv.slice(2)).then(code=>process.exit(code),e=>{console.error(e.message);process.exit(e.usage===false?1:2);});
}
