// Vertex AI를 글 작가로 직접 부른다. agy 같은 에이전트 CLI를 거치지 않고 모델 API만 쓴다.
// 서비스 계정 키(GOOGLE_APPLICATION_CREDENTIALS)로 인증하므로 요금은 Google Cloud 결제 계정으로 나간다.
// 구독 로그인(agy의 oauth-personal)을 쓰지 않으니 "서드파티 도구가 agy를 구동"하는 모양이 아니다.
//
// 이 작가는 파일을 읽지 못한다(reader 'inline'). 필요한 설계 문서는 consult.mjs가 프롬프트에 본문으로 넣는다.
// 그래서 글쓰기 전용이다. 리뷰는 바뀐 파일을 직접 읽어야 하므로 맡기지 않는다.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {extractResult} from '../cli.mjs';
import {loadKey} from '../vertex-call.mjs';

export const name='vertex';
// HFGS_VERTEX_: 모델·주소 설정. 자식 프로세스에는 이 접두사와 구글 인증 변수만 넘어간다.
export const auth=['GOOGLE_','HFGS_VERTEX_'];
export const reader='inline';
// 기본 모델을 두지 않는다. Vertex의 모델 ID는 agy의 이름(gemini-4-argon)과 같다는 보장이 없고,
// 틀린 ID를 기본값으로 두면 누가 썼는지 기록이 틀린다. --model이나 HFGS_VERTEX_MODEL로 정한다.
export const DEFAULT_MODEL=null;
export const MODEL_ENV='HFGS_VERTEX_MODEL';
const CALLER=fileURLToPath(new URL('../vertex-call.mjs',import.meta.url));

export function selectModel(options={},env=process.env){
 const model=options.model??env[MODEL_ENV];
 if(!model)throw Error(`VERTEX_NO_MODEL: vertex 작가는 모델을 정해야 함. --model <Vertex 모델 ID>나 ${MODEL_ENV}를 쓸 것`);
 if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(model))throw Error(`vertex 모델 ID 형식이 아님: ${model}`);
 // 생각 강도를 정하는 요청 필드는 모델 세대마다 달라서 확인 없이 넣지 않는다.
 if(options.reasoning_effort)throw Error('vertex 작가는 --effort를 받지 않음(모델 기본값으로 돈다)');
 return model;
}

// 키 파일과 프로젝트가 준비됐는지만 본다. 네트워크 호출은 하지 않는다.
export function probe(options={},env=process.env){
 selectModel(options,env);
 const key=loadKey(env);
 if(!(env.GOOGLE_CLOUD_PROJECT||key.project_id))throw Error('VERTEX_NO_PROJECT: GOOGLE_CLOUD_PROJECT에 프로젝트 ID를 넣을 것');
 if(!fs.existsSync(CALLER))throw Error('vertex 호출 스크립트가 없음: '+CALLER);
 return {executable:process.execPath,prefix_args:[CALLER],supports:{},warnings:[]};
}

export function command({prompt,schema,options={}}){
 const model=selectModel(options);
 return {args:[],model,stdin:JSON.stringify({model,prompt,schema,timeout_ms:options.timeout_ms})};
}

const HINTS=[
 [/VERTEX_NO_CREDENTIALS|VERTEX_NO_PROJECT|VERTEX_NO_MODEL/,null],
 [/VERTEX_AUTH/,'서비스 계정 키가 유효한지(삭제·만료), 컴퓨터 시계가 맞는지 볼 것'],
 [/HTTP 403/,'서비스 계정에 Vertex AI 사용자 역할(roles/aiplatform.user)이 있는지, 프로젝트에 Vertex AI API와 결제가 켜져 있는지 볼 것'],
 [/HTTP 404/,'모델 ID와 리전(GOOGLE_CLOUD_LOCATION)이 맞는지 볼 것. 모델마다 열려 있는 리전이 다름'],
 [/HTTP 429/,'rate limit: 할당량이나 분당 한도에 걸림']
];
export function diagnose(stdout,stderr){
 const text=String(stderr??'').slice(-2000);
 for(const [pattern,hint] of HINTS)if(pattern.test(text))return [text.trim().split(/\r?\n/).at(-1),hint].filter(Boolean).join('. ');
 return null;
}

export function parse(stdout,request){
 let e;
 try{e=JSON.parse(stdout);}catch{throw Error('vertex 호출이 결과를 내지 못함');}
 if(e.finish_reason&&e.finish_reason!=='STOP')throw Error('vertex가 끝내지 못하고 멈춤: '+e.finish_reason);
 return {session_id:null,result:extractResult(e.text),usage:e.usage??null,model_version:e.model_version??request?.model??null};
}
