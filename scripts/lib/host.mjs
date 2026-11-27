// 리드 호스트. 이 스킬을 읽고 스크립트를 부르는 쪽(Claude Code, Codex, Antigravity, Gemini CLI)이다.
// 호스트가 정하는 것은 셋이다: 리드의 모델 계열(누가 리뷰할 수 있는지, 글을 따로 맡길지), 리드 스킬을 까는 폴더, 리뷰 보고서의 작성자 기본값.
//
// 정하는 순서: --host 인자 → HFGS_HOST 환경변수 → 감지(Claude Code는 셸에 CLAUDECODE=1을 넣는다) → 기본값 claude.
// Codex와 Antigravity는 믿을 만한 표식을 확인하지 못해 감지하지 않는다. 그 호스트에서는 HFGS_HOST를 두고 쓴다.

export const HOSTS={
 claude:{label:'Claude Code',family:'anthropic',skills:'.claude/skills'},
 codex:{label:'Codex',family:'openai',skills:'.codex/skills'},
 agy:{label:'Antigravity',family:'google',skills:'.agents/skills'},
 gemini:{label:'Gemini CLI',family:'google',skills:'.gemini/skills'}
};
const ALIASES={'claude-code':'claude',claudecode:'claude',antigravity:'agy','gemini-cli':'gemini'};
export const HOST_ENV='HFGS_HOST';
export const HOST_MODEL_ENV='HFGS_HOST_MODEL';

export function normalizeHost(value){
 const id=String(value??'').trim().toLowerCase(),host=ALIASES[id]??id;
 if(!HOSTS[host])throw Object.assign(Error(`알 수 없는 호스트: ${value} (가능: ${Object.keys(HOSTS).join(', ')})`),{usage:true});
 return host;
}

// source가 'default'면 근거 없이 claude로 본 것이다. 부르는 쪽이 경고를 낸다.
export function resolveHost({flag,env=process.env}={}){
 if(flag!==undefined&&flag!==null&&flag!=='')return {host:normalizeHost(flag),source:'flag'};
 if(env[HOST_ENV])return {host:normalizeHost(env[HOST_ENV]),source:'env'};
 if(env.CLAUDECODE==='1')return {host:'claude',source:'detected'};
 return {host:'claude',source:'default'};
}
export const hostWarning=({source})=>source==='default'?`호스트를 알 수 없어 claude로 봄. Codex·Antigravity·Gemini CLI에서 쓰면 ${HOST_ENV}=codex|agy|gemini 를 환경에 두거나 --host로 정할 것`:null;

// 모델 계열. 리뷰 독립성은 모델을 만든 회사로 판단한다. 모델 이름을 알면 그것이 먼저다(agy는 Claude 모델도 돌린다).
const FAMILY={claude:'anthropic',codex:'openai',agy:'google',gemini:'google',grok:'xai',vertex:'google'};
export function familyOf(who,model){
 if(/^claude-/.test(model??''))return 'anthropic';
 if(/^gpt-|^o\d/.test(model??''))return 'openai';
 if(/^gemini-/.test(model??''))return 'google';
 if(/^grok-/.test(model??''))return 'xai';
 return FAMILY[who]??null;
}
export const hostFamily=(host,env=process.env)=>familyOf(host,env[HOST_MODEL_ENV]);

// 작성자와 계열이 다른 리뷰어를 고른다. agy는 맨 뒤다: 다른 에이전트가 agy를 구동하는 것은 구글 개인 요금제 약관에 걸린다.
export const REVIEWER_ORDER=['codex','claude','grok','agy'];
export function pickReviewer(authorFamily,available=REVIEWER_ORDER){
 return REVIEWER_ORDER.find(r=>available.includes(r)&&familyOf(r)!==authorFamily)??null;
}
