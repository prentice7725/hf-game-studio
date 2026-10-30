// Google Antigravity CLI(agy) 헤드리스 모드를 읽기 전용 작가·리뷰어로 부른다. 기본 모델은 Gemini Argon(high)이다.
// 출처: hyperfusion scripts/adapters/antigravity.mjs, agy-model.mjs (MIT). 구현 모드·재개·셸 허용 목록은 뺐다.
// 모든 플래그는 -p 앞에 와야 한다.
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {probe as probeCli,extractResult} from '../cli.mjs';
import {assertCommandLine} from '../platform.mjs';
import {cliEnv} from '../env.mjs';

export const name='agy';
export const auth=['GOOGLE_','GEMINI_','AGY_','ANTIGRAVITY_'];
export const reader='tools';
export const DEFAULT_MODEL='gemini-4-argon';
export const DEFAULT_EFFORT='high';
export const binary=(env=process.env)=>env.HFGS_AGY_BIN||'agy';
// --sandbox는 agy의 터미널만 제한하고 파일 쓰기 도구(write_to_file)는 막지 못한다(hyperfusion 실측). 그래서 plan 모드와 함께 쓰고,
// 쓰기를 맡기지 않는다. 결과는 JSON으로만 받는다.
export const requiredFlags=['--output-format','--json-schema','--mode','--add-dir','--print','--sandbox','--model'];

// ── 모델 고르기 ──
// agy에서 강도는 모델 ID에 붙은 접미사가 정본이다(gemini-4-argon-high). Gemini가 아닌 모델만 --effort를 쓴다.
const GEMINI=/^gemini-\d+(?:\.\d+)*-[a-z0-9][a-z0-9-]*$/;
const SUFFIX=/-(low|medium|high)$/;
export const GEMINI_EFFORTS=['low','medium','high'];
export const supportedEfforts=model=>/^claude-(?:opus|sonnet)-/.test(model??'')?[...GEMINI_EFFORTS,'max']:GEMINI_EFFORTS;
export const modelEffort=model=>typeof model==='string'&&GEMINI.test(model)?SUFFIX.exec(model)?.[1]??null:null;
export function selectModel({model=DEFAULT_MODEL,reasoning_effort:effort=model===DEFAULT_MODEL?DEFAULT_EFFORT:undefined}={}){
 const pin=modelEffort(model),effective=pin??effort??null;
 if(effort!=null&&!supportedEfforts(model).includes(effort))throw Error(`agy 모델 ${model}의 강도는 ${supportedEfforts(model).join(', ')} 중 하나`);
 if(pin&&effort!=null&&pin!==effort)throw Error(`agy 모델 ${model}은 강도 ${pin}로 고정인데 reasoning_effort가 ${effort}`);
 const gemini=GEMINI.test(model);
 return {model:gemini&&!pin&&effective?`${model}-${effective}`:model,effort_flag:gemini?null:effort??null};
}

// agy는 모르는 --model을 받으면 오류 없이 기본 모델로 돈다(hyperfusion 실측). 누가 썼는지가 중요하므로
// 고른 모델이 `agy models` 목록에 없으면 실행 전에 막는다. 목록을 못 얻으면(옛 agy, 로그인 전) 막지 않고 unverified로 남긴다.
export const ALLOW_UNLISTED_ENV='HFGS_AGY_ALLOW_UNLISTED_MODEL';
const modelKey=v=>String(v).toLowerCase().replace(/[^0-9a-z]/g,'');
// 출력 형식이 버전마다 달랐다(표시 이름만, slug<TAB>표시 이름). 줄 전체, 탭 열, 공백 낱말을 모두 후보로 본다.
export function listedModels(text){
 return String(text??'').split(/\r?\n/).map(l=>l.trim()).filter(Boolean)
  .flatMap(l=>[l,...l.split('\t'),...l.split(/\s+/)].map(x=>x.trim()).filter(x=>modelKey(x)));
}
export function checkModel(cli,model,{spawn=spawnSync,env=process.env}={}){
 if(env[ALLOW_UNLISTED_ENV]==='1')return {model,status:'skipped'};
 const r=spawn(cli.executable,[...(cli.prefix_args??[]),'models'],{encoding:'utf8',timeout:15000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe'],windowsHide:true,env:cliEnv(auth)});
 if(r.error||r.status!==0)return {model,status:'unverified',reason:'agy models '+(r.error?.code==='ETIMEDOUT'?'시간 초과':r.error?.message??`종료 코드 ${r.status}`)};
 const names=listedModels(r.stdout);
 if(!names.length)return {model,status:'unverified',reason:'agy models 목록이 비어 있음'};
 if(names.some(n=>modelKey(n)===modelKey(model)))return {model,status:'listed'};
 throw Error(`MODEL_UNLISTED: agy 모델 "${model}"이 \`agy models\` 목록에 없음. agy는 조용히 기본 모델로 돈다. 모델 이름을 고치거나 ${ALLOW_UNLISTED_ENV}=1로 검사를 끌 것`);
}

export const probe=(options={})=>{
 const choice=selectModel(options);
 const cli=probeCli('Antigravity',binary(),[...requiredFlags,...(choice.effort_flag?['--effort']:[])],['--print-timeout','--new-project'],{auth});
 return {...cli,model_check:checkModel(cli,choice.model)};
};

// agy가 스스로 먼저 끝내도록 프로세스 시간 제한보다 30초 짧게 잡는다. 그래야 강제 종료 대신 정상 응답이 남는다.
export const printTimeout=timeoutMs=>Math.max(30,Math.floor(((timeoutMs??1200000)-30000)/1000))+'s';

// agy는 텍스트 print 모드에서 프롬프트를 -p 인자로만 받는다(-p -는 글자 "-"를 프롬프트로 쓴다). 그래서 명령줄 길이를 확인한다.
export function command({repo,prompt,schema,options={},cli,dir}){
 const choice=selectModel(options);
 const schemaFile=path.join(dir,'schema.json');
 const args=['--output-format','json','--json-schema',schemaFile,'--model',choice.model,...(choice.effort_flag?['--effort',choice.effort_flag]:[]),
  '--mode','plan','--add-dir',repo,'--sandbox',
  ...(cli.supports?.['--print-timeout']?['--print-timeout',printTimeout(options.timeout_ms)]:[]),
  // 새 대화는 --new-project로 연다. 없으면 agy가 전역으로 활성화된 다른 프로젝트의 플러그인·훅을 읽는다.
  ...(cli.supports?.['--new-project']?['--new-project']:[]),'-p',prompt];
 assertCommandLine(cli.executable,[...(cli.prefix_args??[]),...args],{hint:()=>'agy는 프롬프트를 명령줄로만 받는다. 넘기는 문서를 섹션 단위로 줄이거나 파일 경로만 주고 읽게 할 것'});
 return {args,files:[{path:schemaFile,content:JSON.stringify(schema)}]};
}

// agy에는 로그인 상태를 묻는 하위 명령이 없고, 로그아웃 상태에서는 빈 응답으로 끝난다. 실패한 출력에서 원인을 알아본다.
const SIGNED_OUT=/not (?:signed|logged)[ -]?in|(?:sign|log)[ -]?in (?:is )?required|please (?:sign|log)[ -]?in|unauthenticated|not authenticated|authentication (?:required|failed)|no (?:active )?(?:google )?(?:session|credentials)|invalid api key/i;
export function diagnose(stdout,stderr){
 const text=String(stderr??'').slice(-4000)+'\n'+String(stdout??'').slice(-4000);
 return SIGNED_OUT.test(text)?'AGY_NOT_SIGNED_IN: agy가 로그인되어 있지 않음. agy를 한 번 직접 실행해 로그인한 뒤 다시 시도':null;
}

export function parse(stdout){
 let e;
 try{e=JSON.parse(stdout);}catch{throw Error('agy가 JSON이 아닌 응답을 냄');}
 if(!e||e.error)throw Error('agy 오류 응답: '+JSON.stringify(e?.error??null).slice(0,300));
 if(typeof e.status==='string'&&/error|fail|cancel|timeout|denied|abort/i.test(e.status))throw Error('agy 실행 상태: '+e.status);
 const result=e.structured_output??extractResult(e.response);
 return {session_id:e.conversation_id??null,result,usage:e.usage??null};
}
