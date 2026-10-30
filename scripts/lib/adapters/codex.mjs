// OpenAI Codex CLI(codex exec)를 읽기 전용 리뷰어로 부른다. 기본 모델은 리뷰 전담 Sol이다.
// 출처: hyperfusion scripts/adapters/codex.mjs, scripts/codex-sandbox.mjs (MIT). 쓰기 샌드박스·재개·APEX 승인은 뺐다.
// 플래그 출처: https://developers.openai.com/codex/noninteractive
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {probe as probeCli} from '../cli.mjs';
import {cliEnv} from '../env.mjs';

export const name='codex';
export const auth=['OPENAI_','CODEX_'];
export const reader='shell';
export const DEFAULT_MODEL='gpt-6.1-sol';
export const EFFORTS=['minimal','low','medium','high','xhigh'];
export const binary=(env=process.env)=>env.HFGS_CODEX_BIN||'codex';
export const requiredFlags=['--sandbox','--output-schema','--cd','--json'];
export const probe=()=>{
 const cli=probeCli('Codex',binary(),requiredFlags,['--ephemeral'],{help:['exec','--help'],auth});
 return {...cli,mcp_off_args:mcpOffArgs(cli)};
};

// MCP 도구는 read-only 샌드박스 밖에서 돈다. 사용자 설정의 asset_pipeline 같은 서버가 켜져 있으면 리뷰어가 애셋을 만들 수 있다.
// 그래서 켜진 서버를 모두 끈다. codex 0.164.0 실측:
// - mcp_servers={}로는 지워지지 않는다(설정이 합쳐진다).
// - config.toml에 정의된 서버는 mcp_servers.<이름>.enabled=false로 꺼진다. 이름에 따옴표를 붙이면 다른 표로 읽혀 "invalid transport"가 난다.
// - 플러그인이 넣은 서버(cua_repl 등)는 그렇게 하면 "invalid transport"가 나고, 플러그인을 꺼도 남는다. 같은 이름의 꺼진 가짜 서버로 덮어야 꺼진다.
// 끈 뒤 목록을 다시 받아 켜진 서버가 남았으면 실행을 막는다. 운영자는 HFGS_CODEX_ALLOW_MCP=1로 이 검사를 건너뛸 수 있다.
export const ALLOW_MCP_ENV='HFGS_CODEX_ALLOW_MCP';
const BARE=/^[A-Za-z0-9_-]+$/;
export function configServerNames(text){
 return new Set([...String(text??'').matchAll(/^\s*\[mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))\]\s*$/gm)].map(m=>m[1]??m[2]));
}
export function disableMcpArgs(names,configured){
 return names.flatMap(n=>{
  if(!BARE.test(n))throw Error(`CLI_UNAVAILABLE: MCP 서버 이름 "${n}"은 -c로 끌 수 없음. ${ALLOW_MCP_ENV}=1이면 건너뜀`);
  return ['-c',configured.has(n)?`mcp_servers.${n}.enabled=false`:`mcp_servers.${n}={command="hfgs-disabled",enabled=false}`];
 });
}
const codexHome=env=>env.CODEX_HOME||path.join(os.homedir(),'.codex');
export function mcpOffArgs(cli,{spawn=spawnSync,env=process.env,readConfig=()=>{try{return fs.readFileSync(path.join(codexHome(env),'config.toml'),'utf8');}catch{return '';}}}={}){
 if(env[ALLOW_MCP_ENV]==='1')return [];
 const list=extra=>{
  const r=spawn(cli.executable,[...(cli.prefix_args??[]),...extra,'mcp','list','--json'],{encoding:'utf8',timeout:15000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe'],windowsHide:true,env:cliEnv(auth)});
  let out;try{out=JSON.parse(r.stdout);}catch{out=null;}
  if(r.error||r.status!==0||!Array.isArray(out))throw Error(`CLI_UNAVAILABLE: codex mcp list --json 실패(${String(r.stderr??'').trim().split(/\r?\n/).slice(-2).join(' ').slice(0,300)}). MCP 서버를 끌 수 없어 실행하지 않음. ${ALLOW_MCP_ENV}=1이면 건너뜀`);
  return out.filter(s=>s?.enabled!==false&&typeof s?.name==='string').map(s=>s.name);
 };
 const args=disableMcpArgs(list([]),configServerNames(readConfig()));
 const left=args.length?list(args):[];
 if(left.length)throw Error(`CLI_UNAVAILABLE: MCP 서버를 끄지 못함: ${left.join(', ')}. ${ALLOW_MCP_ENV}=1이면 건너뜀`);
 return args;
}

// OpenAI의 구조화 출력은 모든 객체에서 properties의 모든 키를 required로 요구한다(아니면 400 invalid_json_schema).
// 선택 항목도 필수로 바꿔 보낸다. 모델은 없으면 빈 값을 낸다.
export function strictSchema(schema){
 if(Array.isArray(schema))return schema.map(strictSchema);
 if(!schema||typeof schema!=='object')return schema;
 const out=Object.fromEntries(Object.entries(schema).map(([k,v])=>[k,strictSchema(v)]));
 if(out.type==='object'&&out.properties)out.required=Object.keys(out.properties);
 return out;
}

// ── Windows 샌드박스 ──
// Codex는 Windows에서 셸 명령을 전용 샌드박스 사용자로 실행한다. 그 사용자로 프로세스를 띄우지 못하면
// (CreateProcessAsUserW failed: 5 등) 읽기 명령도 못 하고 "못 했다"는 답만 돌아온다. Store판(MSIX) pwsh가 흔한 원인이다.
export const SANDBOX_FAILURE=/CreateProcess(?:AsUser|WithLogon)W failed: (?:5|1312)\b|setup refresh (?:failed|had errors)|helper_unknown_error/i;
export const WINDOWS_SANDBOX_ENV='HFGS_CODEX_WINDOWS_SANDBOX';
export const SANDBOX_HINT='pwsh가 WindowsApps 아래의 패키지판(Store/MSIX)이면 제거하고(Get-AppxPackage Microsoft.PowerShell | Remove-AppxPackage) '
 +`PowerShell GitHub 릴리스의 MSI판을 설치할 것. 또는 ${WINDOWS_SANDBOX_ENV}=unelevated로 다시 시도(격리가 약해짐). 그대로 다시 돌리면 같은 이유로 실패한다`;
export function windowsSandboxArgs(env=process.env){
 const v=env[WINDOWS_SANDBOX_ENV];
 if(v===undefined||v==='')return [];
 if(!['elevated','unelevated'].includes(v))throw Error(`${WINDOWS_SANDBOX_ENV}는 elevated 또는 unelevated`);
 return ['-c',`windows.sandbox="${v}"`];
}

export function command({repo,prompt,schema,options={},cli,dir}){
 if(options.reasoning_effort&&!EFFORTS.includes(options.reasoning_effort))throw Error(`codex reasoning_effort는 ${EFFORTS.join(', ')} 중 하나`);
 const schemaFile=path.join(dir,'schema.json');
 const args=['exec','--sandbox','read-only','--cd',repo,'--output-schema',schemaFile,
  ...(cli.supports?.['--ephemeral']?['--ephemeral']:[]),
  '--model',options.model??DEFAULT_MODEL,
  ...(options.reasoning_effort?['-c',`model_reasoning_effort="${options.reasoning_effort}"`]:[]),
  // 리드용 사용자 훅을 물려받지 않는다.
  '-c','features.hooks=false',
  ...(cli.mcp_off_args??[]),
  ...windowsSandboxArgs(),
  // 프롬프트는 stdin('-')으로 넘긴다. 명령줄 길이 제한과 따옴표 문제를 피한다.
  '--json','-'];
 return {args,stdin:prompt,files:[{path:schemaFile,content:JSON.stringify(strictSchema(schema))}]};
}

export function diagnose(stdout,stderr){
 const text=String(stderr??'').slice(-8000)+'\n'+String(stdout??'').slice(-8000);
 return SANDBOX_FAILURE.test(text)?`CODEX_WINDOWS_SANDBOX: Codex가 Windows 샌드박스에서 프로세스를 띄우지 못함. ${SANDBOX_HINT}`:null;
}

// codex exec --json은 JSONL 이벤트를 낸다. 최종 메시지는 item.completed(agent_message)에 있다.
export function parse(stdout){
 let session=null,text=null,completed=false,usage=null,sandboxFailure=null;
 for(const line of stdout.split(/\r?\n/).filter(s=>s.trim())){
  let e;try{e=JSON.parse(line);}catch{throw Error('Codex가 JSONL이 아닌 줄을 냄');}
  if(!e||typeof e.type!=='string')throw Error('Codex가 알 수 없는 이벤트를 냄');
  // 샌드박스가 셸을 띄우지 못하면 턴은 정상 종료되고 모델은 "못 했다"고만 답한다. 명령 실행 결과에서 직접 찾는다.
  // 실패한 명령만 본다. 성공한 명령의 출력(예: 이 파일을 cat한 내용)에 같은 문구가 있어도 샌드박스 실패가 아니다.
  if(e.type==='item.completed'&&e.item?.type==='command_execution'&&e.item.exit_code!==0){
   const out=String(e.item.aggregated_output??'')+'\n'+String(e.item.error??'');
   const hit=out.split(/\r?\n/).find(l=>SANDBOX_FAILURE.test(l));
   if(hit&&!sandboxFailure)sandboxFailure=hit.trim().slice(0,200);
  }
  if(['turn.failed','error'].includes(e.type))throw Error('Codex 턴 실패: '+JSON.stringify(e.error??e.message??null).slice(0,300));
  if(e.type==='thread.started')session=e.thread_id;
  if(e.type==='item.completed'&&e.item?.type==='agent_message')text=e.item.text;
  if(e.type==='turn.completed'){completed=true;usage=e.usage??null;}
 }
 if(sandboxFailure)throw Error(`CODEX_WINDOWS_SANDBOX: 샌드박스 안에서 명령을 못 돌림("${sandboxFailure}"). ${SANDBOX_HINT}`);
 if(!completed||!text)throw Error('Codex 턴이 끝나지 않았거나 최종 메시지가 없음');
 // Codex의 cached_input_tokens는 input에 포함된 값이다(Claude 캐시 필드와 다름).
 return {session_id:session,result:JSON.parse(text),usage};
}
