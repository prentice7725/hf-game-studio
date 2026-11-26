// Vertex AI 작가: 인증 서명, 요청 모양, 응답 해석, 본문을 넣어 주는 글쓰기 경로. 실제 구글 서버는 부르지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as vertex from '../scripts/lib/adapters/vertex.mjs';
import {call,signedJwt,toVertexSchema,endpoint,assertSafeUrl,loadKey} from '../scripts/lib/vertex-call.mjs';
import {write,review,familyOf,WRITE_SCHEMA} from '../scripts/consult.mjs';
import {cliEnv} from '../scripts/lib/env.mjs';

const CALLER=fileURLToPath(new URL('../scripts/lib/vertex-call.mjs',import.meta.url));
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-vertex-'));
const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const pem=privateKey.export({type:'pkcs8',format:'pem'});
function keyFile(extra={}){
 const file=path.join(tmp(),'key.json');
 fs.writeFileSync(file,JSON.stringify({type:'service_account',project_id:'proj-from-key',private_key_id:'kid1',private_key:pem,client_email:'writer@proj.iam.gserviceaccount.com',token_uri:'https://oauth2.googleapis.com/token',...extra}));
 return file;
}
const jwtOk=jwt=>{const [h,b,s]=jwt.split('.');return crypto.createVerify('RSA-SHA256').update(`${h}.${b}`).verify(publicKey,Buffer.from(s,'base64url'));};
const answer=text=>({candidates:[{content:{parts:[{text:'thinking...',thought:true},{text}]},finishReason:'STOP'}],usageMetadata:{totalTokenCount:42},modelVersion:'m-001'});
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});

test('JWT는 서비스 계정 키로 서명되고 범위와 대상이 맞다',()=>{
 const key=loadKey({GOOGLE_APPLICATION_CREDENTIALS:keyFile()});
 const jwt=signedJwt(key,1_700_000_000_000);
 assert.ok(jwtOk(jwt));
 const claims=JSON.parse(Buffer.from(jwt.split('.')[1],'base64url'));
 assert.equal(claims.iss,'writer@proj.iam.gserviceaccount.com');
 assert.equal(claims.aud,'https://oauth2.googleapis.com/token');
 assert.equal(claims.scope,'https://www.googleapis.com/auth/cloud-platform');
 assert.equal(claims.exp-claims.iat,600);
});

test('키 파일이 없거나 서비스 계정 키가 아니면 이유와 함께 멈춘다',()=>{
 assert.throws(()=>loadKey({}),/VERTEX_NO_CREDENTIALS.*GOOGLE_APPLICATION_CREDENTIALS/);
 assert.throws(()=>loadKey({GOOGLE_APPLICATION_CREDENTIALS:'/no/such/key.json'}),/VERTEX_NO_CREDENTIALS.*ENOENT/);
 assert.throws(()=>loadKey({GOOGLE_APPLICATION_CREDENTIALS:keyFile({type:'authorized_user'})}),/authorized_user/);
});

test('스키마는 Vertex 형식으로 바뀐다: 대문자 타입, additionalProperties 제거, 속성 이름은 그대로',()=>{
 const s=toVertexSchema({...WRITE_SCHEMA,properties:{...WRITE_SCHEMA.properties,type:{type:'string'}}});
 assert.equal(s.type,'OBJECT');
 assert.equal('additionalProperties' in s,false);
 assert.equal(s.properties.new_terms.type,'ARRAY');
 assert.equal(s.properties.new_terms.items.type,'OBJECT');
 assert.equal('additionalProperties' in s.properties.new_terms.items,false);
 assert.deepEqual(s.required,['content','new_terms','notes']);
 assert.deepEqual(s.properties.type,{type:'STRING'},'type이라는 이름의 속성을 타입으로 착각하지 않는다');
});

test('주소: global은 리전 없는 호스트, 리전은 리전 호스트. 평문 http는 이 컴퓨터 주소만',()=>{
 assert.equal(endpoint({project:'p',location:'global',model:'m-1'},{}),'https://aiplatform.googleapis.com/v1/projects/p/locations/global/publishers/google/models/m-1:generateContent');
 assert.match(endpoint({project:'p',location:'us-central1',model:'m-1'},{}),/^https:\/\/us-central1-aiplatform\.googleapis\.com\/v1\/projects\/p\/locations\/us-central1\//);
 assert.throws(()=>endpoint({project:'p',location:'global',model:'m'},{HFGS_VERTEX_ENDPOINT:'http://evil.example'}),/https여야 함/);
 assert.doesNotThrow(()=>assertSafeUrl('http://127.0.0.1:9/x','시험'));
});

test('call: 토큰을 받아 모델을 부르고, 생각 조각을 뺀 글만 돌려준다',async()=>{
 const seen=[];
 const fake=async(url,init)=>{
  seen.push({url:String(url),init});
  if(String(url).includes('oauth2'))return json(200,{access_token:'tok-123'});
  return json(200,answer('{"content":"글","new_terms":[],"notes":""}'));
 };
 const out=await call({model:'m-1',prompt:'P',schema:WRITE_SCHEMA},{env:{GOOGLE_APPLICATION_CREDENTIALS:keyFile(),GOOGLE_CLOUD_PROJECT:'proj-env',GOOGLE_CLOUD_LOCATION:'asia-northeast3'},fetch:fake});
 assert.equal(out.text,'{"content":"글","new_terms":[],"notes":""}');
 assert.equal(out.finish_reason,'STOP');
 assert.equal(out.usage.totalTokenCount,42);
 assert.ok(jwtOk(seen[0].init.body.get('assertion')));
 assert.match(seen[1].url,/asia-northeast3-aiplatform\.googleapis\.com\/v1\/projects\/proj-env\/locations\/asia-northeast3\/publishers\/google\/models\/m-1:generateContent$/);
 assert.equal(seen[1].init.headers.authorization,'Bearer tok-123');
 const body=JSON.parse(seen[1].init.body);
 assert.equal(body.contents[0].parts[0].text,'P');
 assert.equal(body.generationConfig.responseMimeType,'application/json');
 assert.equal(body.generationConfig.responseSchema.type,'OBJECT');
});

test('call: 프로젝트는 환경변수가 없으면 키 파일에서 읽고, 오류는 상태와 사유만 남긴다',async()=>{
 const env={GOOGLE_APPLICATION_CREDENTIALS:keyFile()};
 let url;
 await call({model:'m-1',prompt:'P'},{env,fetch:async u=>{if(String(u).includes('oauth2'))return json(200,{access_token:'t'});url=String(u);return json(200,answer('{}'));}});
 assert.match(url,/projects\/proj-from-key\/locations\/global\//);
 const denied=async u=>String(u).includes('oauth2')?json(200,{access_token:'secret-token'}):json(403,{error:{status:'PERMISSION_DENIED',message:'Permission denied on resource'}});
 await assert.rejects(()=>call({model:'m-1',prompt:'P'},{env,fetch:denied}),e=>/VERTEX_API: HTTP 403 PERMISSION_DENIED: Permission denied/.test(e.message)&&!e.message.includes('secret-token'));
 await assert.rejects(()=>call({model:'m-1',prompt:'P'},{env,fetch:async()=>json(400,{error:'invalid_grant',error_description:'Invalid JWT Signature.'})}),/VERTEX_AUTH.*HTTP 400.*Invalid JWT/);
 await assert.rejects(()=>call({model:'m-1',prompt:'P'},{env,fetch:async u=>String(u).includes('oauth2')?json(200,{access_token:'t'}):json(200,{promptFeedback:{blockReason:'SAFETY'}})}),/후보가 없음.*SAFETY/);
 await assert.rejects(()=>call({prompt:'P'},{env}),/VERTEX_NO_MODEL/);
});

test('어댑터: 모델은 --model이나 환경변수로 정해야 하고 강도는 받지 않는다',()=>{
 assert.throws(()=>vertex.selectModel({},{}),/VERTEX_NO_MODEL/);
 assert.equal(vertex.selectModel({model:'m-1'},{}),'m-1');
 assert.equal(vertex.selectModel({},{HFGS_VERTEX_MODEL:'m-env'}),'m-env');
 assert.throws(()=>vertex.selectModel({model:'a/b'},{}),/형식이 아님/);
 assert.throws(()=>vertex.selectModel({model:'m-1',reasoning_effort:'high'},{}),/--effort를 받지 않음/);
 const cli=vertex.probe({model:'m-1'},{GOOGLE_APPLICATION_CREDENTIALS:keyFile()});
 assert.equal(cli.executable,process.execPath);
 assert.equal(cli.prefix_args[0],CALLER);
 const r=vertex.command({prompt:'P',schema:WRITE_SCHEMA,options:{model:'m-1',timeout_ms:1000}});
 assert.deepEqual(r.args,[]);
 assert.deepEqual(JSON.parse(r.stdin),{model:'m-1',prompt:'P',schema:WRITE_SCHEMA,timeout_ms:1000});
});

test('어댑터: 응답 해석과 실패 원인 안내',()=>{
 const ok=JSON.stringify({text:'{"content":"글","new_terms":[],"notes":""}',finish_reason:'STOP',usage:{totalTokenCount:1},model_version:'m-001'});
 assert.deepEqual(vertex.parse(ok).result,{content:'글',new_terms:[],notes:''});
 assert.equal(vertex.parse(ok).model_version,'m-001');
 assert.throws(()=>vertex.parse(JSON.stringify({text:'{"content":"잘린',finish_reason:'MAX_TOKENS'})),/끝내지 못하고 멈춤: MAX_TOKENS/);
 assert.throws(()=>vertex.parse(''),/결과를 내지 못함/);
 assert.match(vertex.diagnose('','VERTEX_API: HTTP 403 PERMISSION_DENIED: x'),/aiplatform\.user/);
 assert.match(vertex.diagnose('','VERTEX_API: HTTP 404 NOT_FOUND: x'),/모델 ID와 리전/);
 assert.equal(vertex.diagnose('','something else'),null);
});

test('자식 프로세스에는 구글 인증과 Vertex 설정만 넘어간다',()=>{
 const env=cliEnv(vertex.auth,{PATH:'/bin',GOOGLE_APPLICATION_CREDENTIALS:'/k.json',HFGS_VERTEX_MODEL:'m',OPENAI_API_KEY:'x',GITHUB_TOKEN:'y',HFGS_HOME:'/h'});
 assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS,'/k.json');
 assert.equal(env.HFGS_VERTEX_MODEL,'m');
 assert.equal('OPENAI_API_KEY' in env||'GITHUB_TOKEN' in env||'HFGS_HOME' in env,false);
});

test('호출 스크립트를 실제로 띄운다: stdin으로 받고 stdout으로 돌려주며 키와 토큰은 내보내지 않는다',async t=>{
 const hits=[];
 const server=http.createServer((req,res)=>{
  let body='';req.on('data',c=>body+=c);req.on('end',()=>{
   hits.push({url:req.url,auth:req.headers.authorization??null,body});
   res.setHeader('content-type','application/json');
   if(req.url==='/token'){res.end(JSON.stringify({access_token:'tok-e2e'}));return;}
   res.end(JSON.stringify(answer('{"content":"항구의 밤","new_terms":[],"notes":""}')));
  });
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const run=(input,env)=>new Promise(resolve=>{
  const child=spawn(process.execPath,[CALLER],{env:{...cliEnv(vertex.auth,{PATH:process.env.PATH,...env})},stdio:['pipe','pipe','pipe']});
  let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);
  child.on('close',code=>resolve({code,out,err}));child.stdin.end(JSON.stringify(input));
 });
 const good=await run({model:'m-1',prompt:'쓰기'},{GOOGLE_APPLICATION_CREDENTIALS:keyFile({token_uri:base+'/token'}),HFGS_VERTEX_ENDPOINT:base});
 assert.equal(good.code,0,good.err);
 assert.equal(vertex.parse(good.out).result.content,'항구의 밤');
 assert.equal(hits[0].url,'/token');
 assert.ok(jwtOk(new URLSearchParams(hits[0].body).get('assertion')));
 assert.equal(hits[1].auth,'Bearer tok-e2e');
 assert.equal(hits[1].url,'/v1/projects/proj-from-key/locations/global/publishers/google/models/m-1:generateContent');
 assert.equal((good.out+good.err).includes('tok-e2e')||(good.out+good.err).includes('PRIVATE KEY'),false);
 const bad=await run({model:'m-1',prompt:'쓰기'},{});
 assert.equal(bad.code,1);
 assert.match(bad.err,/VERTEX_NO_CREDENTIALS/);
 assert.match(vertex.diagnose(bad.out,bad.err),/VERTEX_NO_CREDENTIALS/);
});

function gameRepo(){
 const dir=tmp();
 const git=(...a)=>execFileSync('git',['-C',dir,...a],{stdio:'pipe'});
 git('init','-q');git('config','user.email','t@example.com');git('config','user.name','t');
 fs.mkdirSync(path.join(dir,'design'));
 fs.writeFileSync(path.join(dir,'design','glossary.md'),'# 용어\n\n## 인물\n\n애쉬: 떠돌이 용병.\n\n## 장소\n\n잿빛 항구: 북쪽 항구 도시.\n');
 fs.writeFileSync(path.join(dir,'design','big.md'),'# 큰 문서\n\n'+'가'.repeat(50*1024));
 fs.writeFileSync(path.join(dir,'.env'),'KEY=1\n');
 git('add','-A');git('commit','-qm','init');
 return dir;
}

test('vertex 작가에게는 읽으라는 지시 대신 문서 본문이 가고, 고른 섹션만 간다',()=>{
 const dir=gameRepo(),seen={};
 const invoke=(adapter,{prompt,options})=>{seen.adapter=adapter.name;seen.prompt=JSON.parse(prompt);seen.options=options;return {result:{content:'글',new_terms:[],notes:''},redacted:0};};
 const {report}=write({task:'애쉬의 첫 등장',context_docs:['design/glossary.md']},{repo:dir,writer:'vertex',model:'m-1'},{invoke,dir:tmp()});
 assert.equal(seen.adapter,'vertex');
 assert.deepEqual(seen.prompt.design_docs,[{path:'design/glossary.md',content:fs.readFileSync(path.join(dir,'design','glossary.md'),'utf8')}]);
 assert.ok(seen.prompt.instructions.some(i=>/no file access and no tools/.test(i)));
 assert.equal(seen.prompt.instructions.some(i=>/Read files|READ-ONLY consultation/.test(i)),false,'파일 읽기 지시는 가지 않는다');
 assert.equal(report.adapter,'vertex');
 assert.equal(report.model,'m-1');
 write({task:'항구 묘사',context_docs:[],context_sections:{'design/glossary.md':['장소']}},{repo:dir,writer:'vertex',model:'m-1'},{invoke,dir:tmp()});
 assert.deepEqual(seen.prompt.design_docs,[{path:'design/glossary.md',sections:[{title:'장소',content:'## 장소\n\n잿빛 항구: 북쪽 항구 도시.'}]}]);
});

test('vertex 작가: 큰 문서는 섹션을 적어야 하고, 비밀 파일은 보내지 않으며, 리뷰는 맡기지 않는다',()=>{
 const dir=gameRepo();
 const invoke=()=>{throw Error('불려서는 안 됨');};
 assert.throws(()=>write({task:'x',context_docs:['design/big.md']},{repo:dir,writer:'vertex',model:'m-1'},{invoke,dir:tmp()}),/context_sections에 필요한 섹션/);
 assert.throws(()=>write({task:'x',context_docs:['.env']},{repo:dir,writer:'vertex',model:'m-1'},{invoke,dir:tmp()}),/비밀 파일은 작가에게 보내지 않음/);
 assert.throws(()=>review({repo:dir,base:'HEAD',reviewer:'vertex',criteria:['AC1: x']},{invoke}),/리뷰를 맡길 수 없음/);
 assert.equal(familyOf('vertex'),'google');
});
