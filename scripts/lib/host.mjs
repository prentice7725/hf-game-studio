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

// 호스트별 리드 모델 하한(Claude Opus 이상·Codex Sol 이상·Gemini Neon 이상).
// HFGS_HOST_MODEL이 명시돼 있을 때만 검사하며, 알 수 없는 최신 모델 이름은 막지 않는다.
const HOST_CHOSEN=new Set(['auto','default']);
const EFFORT_SUFFIX=/-(?:low|medium|high|xhigh|max)$/i;
const EFFORT_PARENS=/\s*\((?:low|medium|high|xhigh|max)\)$/i;
const LEAD_MODELS={
 'claude-fable-5-2':{family:'anthropic',lead:true,aliases:['Claude Fable 5.2']},
 'claude-opus-5-5':{family:'anthropic',lead:true,aliases:['Claude Opus 5.5']},
 'claude-sonnet-5-5':{family:'anthropic',lead:false,aliases:['Claude Sonnet 5.5']},
 'claude-haiku-5-5':{family:'anthropic',lead:false,aliases:['Claude Haiku 5.5']},
 'gpt-6.1-astra':{family:'openai',lead:true,aliases:['GPT 6.1 Astra']},
 'gpt-6.1-sol':{family:'openai',lead:true,aliases:['GPT 6.1 Sol']},
 'gpt-6.1-terra':{family:'openai',lead:false,aliases:['GPT 6.1 Terra']},
 'gpt-6-luna':{family:'openai',lead:false,aliases:['GPT 6 Luna']},
 'gemini-4-neon':{family:'google',lead:true,aliases:['Gemini 4 Neon']},
 'gemini-pro-orchestrator-neon':{family:'google',lead:true,aliases:['Orchestrator (Neon)']},
 'gemini-4-argon':{family:'google',lead:false,aliases:['Gemini 4 Argon']},
 'gemini-pro-orchestrator-g1-pro':{family:'google',lead:false,aliases:['Orchestrator (Argon)']},
 'gemini-4-hydrogen':{family:'google',lead:false,aliases:['Gemini 4 Hydrogen']},
 'gemini-3.8-flash':{family:'google',lead:false,aliases:['Gemini 3.8 Flash']},
 'gpt-oss-120b':{family:'unknown',lead:false,aliases:['GPT-OSS 120B']}
};
const LEAD_ELIGIBLE_PATTERNS=[
 /^claude-(?:opus|fable)-/i,
 /^gpt-[\d.]+-(?:sol|astra)(?:-|$)/i,
 /^gemini-(?:\d+(?:\.\d+)*-neon|pro-orchestrator-neon)(?:-|$)/i
];
const LEAD_INELIGIBLE_PATTERNS=[
 /^claude-(?:sonnet|haiku)-/i,
 /^gpt-[\d.]+-(?:luna|terra|mini|nano)(?:-|$)/i,
 /^gemini-(?:\d+(?:\.\d+)*-(?:argon|hydrogen|flash)|pro-orchestrator-g1-pro)(?:-|$)/i,
 /^gpt-oss-/i
];
function matchLeadModel(candidate){
 const low=candidate.toLowerCase();
 return Object.keys(LEAD_MODELS).find(k=>k.toLowerCase()===low||LEAD_MODELS[k].aliases?.some(a=>a.toLowerCase()===low))??null;
}
function leadModelBase(reported){
 if(typeof reported!=='string')return null;
 const raw=reported.trim();
 if(!raw||HOST_CHOSEN.has(raw.toLowerCase()))return null;
 const exact=matchLeadModel(raw);
 if(exact)return exact;
 const stripped=raw.replace(EFFORT_SUFFIX,'').replace(EFFORT_PARENS,'').trim();
 return stripped&&stripped!==raw?matchLeadModel(stripped):null;
}
export function leadEligibility(model){
 if(typeof model!=='string'||!model.trim()||HOST_CHOSEN.has(model.trim().toLowerCase()))
  return {eligible:true,known:false,base:null,family:null};
 const trimmed=model.trim(),base=leadModelBase(trimmed);
 if(base){
  const entry=LEAD_MODELS[base];
  return {eligible:entry.lead,known:true,base,family:entry.family==='unknown'?null:entry.family};
 }
 if(LEAD_ELIGIBLE_PATTERNS.some(re=>re.test(trimmed)))return {eligible:true,known:true,base:null,family:familyOf(null,trimmed)};
 if(LEAD_INELIGIBLE_PATTERNS.some(re=>re.test(trimmed)))return {eligible:false,known:true,base:null,family:familyOf(null,trimmed)};
 return {eligible:true,known:false,base:null,family:familyOf(null,trimmed)};
}
export function assertLeadModel(model){
 if(typeof model!=='string'||!model.trim())return null;
 const r=leadEligibility(model);
 if(!r.eligible)
  throw Error(`LEAD_MODEL_BELOW_MINIMUM: 리드 모델(${model.trim()})이 하한 미만임. 호스트별 최상위 모델(Claude Opus 이상·Codex Sol 이상·Gemini Neon 이상)만 리드가 될 수 있음`);
 return r;
}
