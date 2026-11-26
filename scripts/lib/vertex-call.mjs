#!/usr/bin/env node
// Vertex AI generateContent를 한 번 부르는 자식 프로세스. 어댑터(adapters/vertex.mjs)가 띄운다.
// 다른 어댑터가 모두 동기 프로세스 실행(spawnSync)이라, 비동기 HTTP 호출을 같은 틀에 넣으려고 따로 뺐다.
// 외부 패키지 없이 Node 내장 기능만 쓴다: 서비스 계정 키로 JWT를 서명해 액세스 토큰을 받고, 그 토큰으로 모델을 부른다.
//
// 입력(stdin, JSON): {model, prompt, schema?, timeout_ms?}
// 출력(stdout, JSON): {text, finish_reason, usage, model_version}
// 환경변수:
//   GOOGLE_APPLICATION_CREDENTIALS  서비스 계정 키 JSON 파일 경로(필수)
//   GOOGLE_CLOUD_PROJECT            프로젝트 ID(없으면 키 파일의 project_id)
//   GOOGLE_CLOUD_LOCATION           리전(기본 global)
//   HFGS_VERTEX_ENDPOINT            API 주소를 바꾼다(시험용. https이거나 이 컴퓨터 주소여야 한다)
// 키 파일 내용, 서명한 JWT, 액세스 토큰은 어디에도 출력하지 않는다.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';

const SCOPE='https://www.googleapis.com/auth/cloud-platform';
const b64=v=>Buffer.from(v).toString('base64url');

// 인증 정보가 평문 http로 나가지 않게 한다. 시험은 이 컴퓨터의 가짜 서버(127.0.0.1)를 쓴다.
export function assertSafeUrl(url,what){
 let u;
 try{u=new URL(url);}catch{throw Error(`${what} 주소가 올바르지 않음`);}
 const local=['127.0.0.1','localhost','[::1]'].includes(u.hostname);
 if(u.protocol!=='https:'&&!(u.protocol==='http:'&&local))throw Error(`${what} 주소는 https여야 함: ${u.origin}`);
 return u;
}

export function loadKey(env=process.env){
 const file=env.GOOGLE_APPLICATION_CREDENTIALS;
 if(!file)throw Error('VERTEX_NO_CREDENTIALS: GOOGLE_APPLICATION_CREDENTIALS에 서비스 계정 키 JSON 파일 경로를 넣을 것');
 let key;
 try{key=JSON.parse(fs.readFileSync(file,'utf8'));}
 catch(e){throw Error(`VERTEX_NO_CREDENTIALS: 키 파일을 읽지 못함(${e.code??'JSON 형식 오류'}): ${file}`);}
 if(key.type!=='service_account'||typeof key.client_email!=='string'||typeof key.private_key!=='string')
  throw Error(`VERTEX_NO_CREDENTIALS: 서비스 계정 키가 아님(type: ${key.type??'없음'}). gcloud 사용자 로그인 파일(authorized_user)은 지원하지 않음`);
 return key;
}

export function signedJwt(key,now=Date.now()){
 const iat=Math.floor(now/1000);
 const head=b64(JSON.stringify({alg:'RS256',typ:'JWT',...(key.private_key_id?{kid:key.private_key_id}:{})}));
 const body=b64(JSON.stringify({iss:key.client_email,scope:SCOPE,aud:key.token_uri??'https://oauth2.googleapis.com/token',iat,exp:iat+600}));
 const signature=crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(key.private_key).toString('base64url');
 return `${head}.${body}.${signature}`;
}

// Vertex의 responseSchema는 OpenAPI 부분집합이다. 타입 이름은 대문자이고 additionalProperties는 받지 않는다.
export function toVertexSchema(s){
 if(Array.isArray(s))return s.map(toVertexSchema);
 if(!s||typeof s!=='object')return s;
 const out={};
 for(const [k,v] of Object.entries(s)){
  if(k==='additionalProperties'||k==='$schema')continue;
  if(k==='type'&&typeof v==='string')out.type=v.toUpperCase();
  else if(k==='properties')out.properties=Object.fromEntries(Object.entries(v).map(([name,sub])=>[name,toVertexSchema(sub)]));
  else if(k==='required'||k==='enum')out[k]=v;
  else out[k]=toVertexSchema(v);
 }
 return out;
}

export function endpoint({project,location,model},env=process.env){
 const base=env.HFGS_VERTEX_ENDPOINT??(location==='global'?'https://aiplatform.googleapis.com':`https://${location}-aiplatform.googleapis.com`);
 assertSafeUrl(base,'Vertex');
 return `${base.replace(/\/+$/,'')}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
}

// 오류 본문에서 사람이 읽을 부분만 꺼낸다. 길이를 자른다.
const apiError=async r=>{
 const text=await r.text().catch(()=>'');
 let message=text;
 try{const j=JSON.parse(text);message=[j.error?.status,j.error?.message??j.error_description??j.error].filter(v=>typeof v==='string').join(': ')||text;}catch{/* JSON이 아님 */}
 return `HTTP ${r.status} ${String(message).replace(/\s+/g,' ').slice(0,400)}`;
};

export async function call({model,prompt,schema,timeout_ms=20*60*1000},{env=process.env,fetch:doFetch=fetch}={}){
 if(typeof model!=='string'||!model)throw Error('VERTEX_NO_MODEL: 모델 ID가 없음');
 const key=loadKey(env);
 const project=env.GOOGLE_CLOUD_PROJECT||key.project_id;
 if(!project)throw Error('VERTEX_NO_PROJECT: GOOGLE_CLOUD_PROJECT에 프로젝트 ID를 넣을 것(키 파일에 project_id가 없음)');
 const location=env.GOOGLE_CLOUD_LOCATION||'global';
 const signal=AbortSignal.timeout(Math.max(1000,timeout_ms-5000));
 const tokenUrl=assertSafeUrl(key.token_uri??'https://oauth2.googleapis.com/token','토큰');
 const t=await doFetch(tokenUrl,{method:'POST',signal,headers:{'content-type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:signedJwt(key)})});
 if(!t.ok)throw Error('VERTEX_AUTH: 액세스 토큰을 받지 못함: '+await apiError(t));
 const token=(await t.json()).access_token;
 if(typeof token!=='string'||!token)throw Error('VERTEX_AUTH: 토큰 응답에 access_token이 없음');
 const r=await doFetch(endpoint({project,location,model},env),{method:'POST',signal,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
  body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],
   generationConfig:{responseMimeType:'application/json',...(schema?{responseSchema:toVertexSchema(schema)}:{})}})});
 if(!r.ok)throw Error('VERTEX_API: '+await apiError(r));
 const body=await r.json();
 const candidate=body.candidates?.[0];
 if(!candidate)throw Error('VERTEX_API: 응답에 후보가 없음'+(body.promptFeedback?.blockReason?` (차단 사유: ${body.promptFeedback.blockReason})`:''));
 // 생각 과정(thought) 조각은 결과가 아니다.
 const text=(candidate.content?.parts??[]).filter(p=>typeof p.text==='string'&&p.thought!==true).map(p=>p.text).join('');
 return {text,finish_reason:candidate.finishReason??null,usage:body.usageMetadata??null,model_version:body.modelVersion??null};
}

async function main(){
 let input='';
 for await(const chunk of process.stdin)input+=chunk;
 console.log(JSON.stringify(await call(JSON.parse(input))));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(fs.realpathSync(process.argv[1])).href)
 main().catch(e=>{console.error(e.name==='TimeoutError'?'VERTEX_API: 시간 초과':e.message);process.exit(1);});
