// Grok Build CLI 헤드리스 모드를 읽기 전용 리뷰어로 부른다(xAI 계열 세 번째 의견).
// 출처: hyperfusion scripts/adapters/grok.mjs (MIT). 편집 허용·재개는 뺐다.
// stdin을 프롬프트로 읽지 않으므로 --prompt-file을 쓴다. 플래그 출처: xai-org/grok-build user-guide 14-headless-mode.md
import crypto from 'node:crypto';
import path from 'node:path';
import {probe as probeCli,extractResult,SECRET_READ_PATHS} from '../cli.mjs';

export const name='grok';
export const auth=['XAI_','GROK_'];
export const reader='generic';
export const binary=(env=process.env)=>env.HFGS_GROK_BIN||'grok';
export const requiredFlags=['--prompt-file','--output-format','--session-id','--cwd','--max-turns','--deny'];
export const probe=(options={})=>probeCli('Grok',binary(),[...requiredFlags,...(options.model?['--model']:[]),...(options.reasoning_effort?['--reasoning-effort']:[])],[],{auth});
// 편집과 셸을 모두 막는다. 규칙 문법이 버전마다 다를 수 있어 보증은 아니다. 호출하는 쪽이 전후로 작업 트리를 비교한다.
export const DENY=['Edit(**)','Bash(*)',...SECRET_READ_PATHS.map(p=>`Read(${p})`)];

export function command({repo,prompt,options={},dir}){
 const promptFile=path.join(dir,'prompt.txt'),session=crypto.randomUUID();
 const args=['--prompt-file',promptFile,'--output-format','json','--cwd',repo,'--max-turns',String(options.max_turns??40),
  ...(options.model?['--model',options.model]:[]),...(options.reasoning_effort?['--reasoning-effort',options.reasoning_effort]:[]),
  '--session-id',session,...DENY.flatMap(r=>['--deny',r])];
 return {args,session,files:[{path:promptFile,content:prompt}]};
}

export function parse(stdout,request){
 let e;
 try{e=JSON.parse(stdout);}catch{throw Error('Grok이 JSON이 아닌 응답을 냄');}
 if(!e||e.type==='error')throw Error('Grok 오류 응답: '+(e?.message??'알 수 없음'));
 if(request?.session&&e.sessionId!==request.session)throw Error('Grok 세션이 요청과 다름');
 if(e.stopReason!=='end_turn')throw Error('Grok이 끝내지 못하고 멈춤: '+e.stopReason);
 return {session_id:e.sessionId,result:extractResult(e.text),usage:e.usage??null};
}
