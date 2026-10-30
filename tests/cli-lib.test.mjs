// hyperfusion에서 옮겨 온 외부 CLI 공통 부분 테스트. 실제 CLI는 부르지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {hasOption,extractResult,readOnlyOrders,invoke} from '../scripts/lib/cli.mjs';
import {cliEnv} from '../scripts/lib/env.mjs';
import {redactText,redactValue} from '../scripts/lib/redaction.mjs';
import {windowsCommandLineLength,assertCommandLine,unwrapShim} from '../scripts/lib/platform.mjs';

test('hasOption은 다른 플래그의 일부를 플래그로 보지 않는다',()=>{
 const help='  --model <M>\n  --sandbox-mode\n  -c, --config';
 assert.ok(hasOption(help,'--model'));
 assert.ok(hasOption(help,'--config'));
 assert.ok(!hasOption(help,'--sandbox'));
});

test('extractResult: 본문 전체, 마지막 json 블록, 끝에 붙은 객체만 받는다',()=>{
 assert.deepEqual(extractResult(' {"a":1} '),{a:1});
 assert.deepEqual(extractResult('설명\n```json\n{"a":1}\n```\n다시\n```json\n{"a":2}\n```'),{a:2});
 assert.deepEqual(extractResult('untouched.{"a":{"b":"}"}}'),{a:{b:'}'}});
 assert.throws(()=>extractResult('결과 없음'),/결과 JSON이 없음/);
 assert.throws(()=>extractResult('  '),/비어 있음/);
});

test('readOnlyOrders: 읽는 방법에 따라 셸 허용 문장이 다르다',()=>{
 assert.match(readOnlyOrders('shell').join(' '),/MAY run read-only commands/);
 assert.match(readOnlyOrders('tools').join(' '),/Run no shell commands at all/);
 for(const r of ['shell','tools','generic'])assert.match(readOnlyOrders(r).join(' '),/READ-ONLY.*\.env/s);
});

test('cliEnv: 기본 변수와 그 벤더 인증값, 지정한 이름만 넘긴다',()=>{
 const env={PATH:'/bin',OPENAI_API_KEY:'o',XAI_API_KEY:'x',GITHUB_TOKEN:'g',AWS_SECRET:'a',LC_ALL:'C',MY_PROXY:'p',HFGS_ENV_PASS:'my_proxy'};
 const out=cliEnv(['OPENAI_'],env);
 assert.deepEqual(Object.keys(out).sort(),['LC_ALL','MY_PROXY','OPENAI_API_KEY','PATH','PYTHONDONTWRITEBYTECODE']);
});

test('redaction: 키·토큰·이메일은 가리고 이미지 해상도 파일명은 남긴다',()=>{
 const counts={};
 const out=redactText('key sk-proj-abcdefghijklmnopqrstu, mail a@b.com, icon@2x.png, password: hunter2',counts);
 assert.doesNotMatch(out,/sk-proj|a@b\.com|hunter2/);
 assert.match(out,/icon@2x\.png/);
 assert.ok(counts['api-key']&&counts.email&&counts.secret);
 assert.deepEqual(redactValue({api_key:'zzz',note:'ok'}),{api_key:'[REDACTED:secret]',note:'ok'});
 assert.throws(()=>redactValue({paths:['me@corp.com/x.md']}),/rename it/);
});

test('Windows 명령줄 길이는 따옴표·역슬래시까지 센다',()=>{
 assert.equal(windowsCommandLineLength('a',['b c']),1+1+5);
 assert.equal(windowsCommandLineLength('a',['x"y']),1+1+6);
 assert.throws(()=>assertCommandLine('a',['x'.repeat(33000)],{windows:true,hint:()=>'줄일 것'}),/한도.*줄일 것/);
 assert.doesNotThrow(()=>assertCommandLine('a',['x'.repeat(33000)],{windows:false}));
});

test('npm .cmd 래퍼에서 진입점을 꺼낸다',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-shim-'));
 fs.mkdirSync(path.join(dir,'node_modules','x','bin'),{recursive:true});
 fs.writeFileSync(path.join(dir,'node_modules','x','bin','x.js'),'');
 fs.writeFileSync(path.join(dir,'x.cmd'),'@"%~dp0\\node_modules\\x\\bin\\x.js" %*');
 assert.equal(unwrapShim(path.join(dir,'x.cmd')),path.join(dir,'node_modules','x','bin','x.js'));
 fs.writeFileSync(path.join(dir,'y.cmd'),'@echo hi');
 assert.equal(unwrapShim(path.join(dir,'y.cmd')),null);
});

test('invoke: 프롬프트의 비밀값을 가려 보내고, 실패하면 진단 문구를 붙인다',()=>{
 const seen={};
 const adapter={name:'fake',auth:[],
  command:({prompt,dir})=>({args:['run'],stdin:prompt,files:[{path:path.join(dir,'s.json'),content:'{}'}]}),
  parse:out=>({result:JSON.parse(out)}),diagnose:()=>'로그인 필요'};
 const cli={executable:'fake',prefix_args:[]};
 const spawn=(exe,args,opts)=>{seen.input=opts.input;seen.env=opts.env;return {status:0,stdout:'{"ok":true}',stderr:''};};
 const r=invoke(adapter,{repo:'.',prompt:'token=abc123secret 요약해줘',schema:{},probed:cli,spawn});
 assert.deepEqual(r.result,{ok:true});
 assert.equal(r.redacted,1);
 assert.doesNotMatch(seen.input,/abc123secret/);
 assert.throws(()=>invoke(adapter,{repo:'.',prompt:'x',schema:{},probed:cli,spawn:()=>({status:1,stdout:'not json',stderr:'boom'})}),/fake: .*로그인 필요.*boom/);
});
