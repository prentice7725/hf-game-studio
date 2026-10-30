// 수용 검사 명령을 직접 돌린다. task.mjs(start·check·verify)와 consult.mjs(리뷰어에게 검사 결과 전달)가 같이 쓴다.
// 리뷰어와 리드는 "테스트 통과" 주장 대신 이 결과를 본다.
import {spawnSync} from 'node:child_process';

export function runChecks(repo,commands,{spawn=spawnSync,timeoutMs=10*60*1000}={}){
 return commands.map(command=>{
  const r=spawn(command,{cwd:repo,shell:true,encoding:'utf8',timeout:timeoutMs,maxBuffer:64*1024*1024,windowsHide:true});
  const out=`${r.stdout??''}${r.stderr?'\n'+r.stderr:''}`.trim();
  return {command,exit_code:r.error?.code==='ETIMEDOUT'?'timeout':r.status,output_tail:out.slice(-2000)};
 });
}
export const passed=r=>r.exit_code===0;
