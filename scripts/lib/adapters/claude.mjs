// Claude Code CLI 헤드리스 모드를 읽기 전용 리뷰어·작가로 부른다. 리드가 Claude가 아닐 때(Codex, Antigravity) 다른 계열 의견으로 쓴다.
// 출처: hyperfusion scripts/adapters/claude.mjs (MIT). 구현 모드·재개·Bash 허용 목록은 뺐다.
// 플래그 출처: https://code.claude.com/docs/en/headless, https://code.claude.com/docs/en/cli-reference
import crypto from 'node:crypto';
import {probe as probeCli,SECRET_READ_PATHS} from '../cli.mjs';

export const name='claude';
export const auth=['ANTHROPIC_','CLAUDE_'];
export const reader='generic';
export const DEFAULT_MODEL='claude-opus-5-5';
export const binary=(env=process.env)=>env.HFGS_CLAUDE_BIN||'claude';
export const requiredFlags=['--model','--output-format','--json-schema','--session-id','--safe-mode','--tools','--allowedTools','--disallowedTools','--permission-mode'];
export const probe=(options={})=>probeCli('Claude Code',binary(),[...requiredFlags,...(options.reasoning_effort?['--effort']:[])],[],{auth});

// 읽기 도구만 준다. Bash·편집·하위 에이전트·MCP가 없으면 트리를 바꿀 수단이 없다. 그래도 호출하는 쪽이 전후로 작업 트리를 비교한다.
export const TOOLS='Read,Glob,Grep';
export const DENY=['Agent','Task','Skill','mcp__*','Edit','Write','Bash',...SECRET_READ_PATHS.map(p=>`Read(${p})`)];

export function command({prompt,schema,options={}}){
 const session=crypto.randomUUID();
 // safe-mode로 사용자 플러그인·훅·메모리를 끄고, dontAsk로 허용 목록 밖은 묻지 않고 거절한다.
 const args=['-p','--model',options.model??DEFAULT_MODEL,...(options.reasoning_effort?['--effort',options.reasoning_effort]:[]),
  '--safe-mode','--output-format','json','--json-schema',JSON.stringify(schema),'--permission-mode','dontAsk',
  '--tools',TOOLS,'--allowedTools',TOOLS,'--disallowedTools',DENY.join(','),'--max-turns',String(options.max_turns??40),'--session-id',session];
 return {args,session,stdin:prompt};
}

// 한도에 걸린 Claude는 is_error 결과 하나를 내고 0이 아닌 코드로 끝난다. 그 문구만 꺼낸다.
export function diagnose(stdout){
 let e;try{e=JSON.parse(String(stdout??'').trim());}catch{return null;}
 const text=e?.is_error===true&&typeof e.result==='string'?e.result.replace(/\s+/g,' ').trim():'';
 return text?`Claude가 보고함: ${text.slice(0,300)}`:null;
}

export function parse(stdout,request){
 let e;
 try{e=JSON.parse(stdout);}catch{throw Error('Claude가 JSON이 아닌 응답을 냄');}
 if(!e||e.type!=='result'||e.is_error===true||e.subtype!=='success')throw Error('Claude가 성공하지 못한 결과를 냄'+(e?.subtype?`: ${e.subtype}`:''));
 if(request?.session&&e.session_id!==request.session)throw Error('Claude 세션이 요청과 다름');
 // 거부된 도구 호출이 있으면 읽으려던 것을 못 읽고 낸 답일 수 있다.
 if(e.permission_denials?.length)throw Error(`Claude가 허용되지 않은 도구를 쓰려 함(${e.permission_denials.map(d=>d.tool_name).filter(Boolean).join(', ')||'알 수 없음'}): 답을 받지 않음`);
 if(!e.structured_output||typeof e.structured_output!=='object')throw Error('Claude 응답에 결과 JSON이 없음');
 return {session_id:e.session_id,result:e.structured_output,usage:e.usage??null};
}
