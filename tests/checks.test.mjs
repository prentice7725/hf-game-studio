// 수용 검사 실행기 테스트. 명령은 셸 없이 인자 배열로 돌고, 셸 문법이 따옴표 밖에 있는 명령만 셸로 돈다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {splitCommand,runChecks,mergeEnv} from '../scripts/lib/checks.mjs';
import {quote} from '../scripts/task.mjs';

test('splitCommand: bash와 같은 따옴표 규칙, 앞의 NAME=값은 환경변수',()=>{
 assert.deepEqual(splitCommand('node tools/hfgs/godot-check.mjs all'),{env:{},argv:['node','tools/hfgs/godot-check.mjs','all']});
 assert.deepEqual(splitCommand('node a.mjs --expect "/p=\\"A&B\\"" \'x y\''),{env:{},argv:['node','a.mjs','--expect','/p="A&B"','x y']});
 assert.deepEqual(splitCommand('GODOT_AI_PORT=8001 GODOT_AI_WS_PORT=9501 node t.mjs'),{env:{GODOT_AI_PORT:'8001',GODOT_AI_WS_PORT:'9501'},argv:['node','t.mjs']});
 assert.deepEqual(splitCommand('node C:\\tools\\x.mjs "C:\\a b\\c"').argv,['node','C:\\tools\\x.mjs','C:\\a b\\c'],'Windows 경로의 역슬래시는 그대로');
 assert.deepEqual(splitCommand('node v.mjs \\\\server\\share\\d.json --expect "/p=\\"A&B\\""').argv,['node','v.mjs','\\\\server\\share\\d.json','--expect','/p="A&B"'],'UNC 경로도 그대로');
 assert.deepEqual(splitCommand('node -e "console.log(\'hi\');process.exit(1)"').argv,['node','-e',"console.log('hi');process.exit(1)"]);
 for(const shell of ['node -e "process.exit(0)"\nnode -e "process.exit(1)"','npm test | tail','node v.mjs data/[ab].json','node check.mjs "$HOME"','node check.mjs a\\ b','node check.mjs value\\ ','node check.mjs\n','node check.mjs say\\"hi\\"','node check.mjs "`date`"','a && b','a > out.txt','ls data/*.json','echo $HOME','a; b','echo %PATH%','node "unclosed','# comment','A=1'])
  assert.equal(splitCommand(shell),null,shell);
});

test('mergeEnv: Windows에서는 이름의 대소문자를 가리지 않고 새 값 하나만 남긴다',()=>{
 assert.deepEqual(mergeEnv({HFGS_T:'old',Path:'a'},{hfgs_t:'new',path:'b'},{windows:true}),{hfgs_t:'new',PATH:'b'});
 assert.deepEqual(mergeEnv({HFGS_T:'old'},{hfgs_t:'new'},{windows:false}),{HFGS_T:'old',hfgs_t:'new'});
 // 대소문자를 섞어 같은 변수를 여러 번 지정하면 마지막 값이 이긴다.
 assert.deepEqual(mergeEnv({},splitCommand('PATH=first Path=second PATH=third tool').env,{windows:true}),{PATH:'third'});
});

test('splitCommand: task.mjs의 quote로 만든 인자는 원래 글자로 돌아온다',()=>{
 for(const v of ['/mercenaries/0/name="A&B"','/p="x|y<z>"','/p="50% 할인"','/p="큰 \\"따옴표\\""','C:\\workspace\\merc guild','plain','"줄\n바꿈"\t탭\r'])
  assert.deepEqual(splitCommand(`node v.mjs --expect ${quote(v)}`).argv,['node','v.mjs','--expect',v],v);
});

test('runChecks: 셸 없이 인자를 그대로 넘기고, 셸이 필요한 명령만 셸로 돈다',()=>{
 const echo=`node -e "console.log(JSON.stringify(process.argv.slice(1)));console.log(process.env.HFGS_T??'')"`;
 const [r]=runChecks(process.cwd(),[`HFGS_T=ok ${echo} ${quote('/p="A&B" %PATH% $HOME')}`]);
 assert.equal(r.exit_code,0,r.output_tail);
 assert.equal(r.shell,false);
 assert.deepEqual(r.output_tail.split('\n').map(s=>s.trim()),[JSON.stringify(['/p="A&B" %PATH% $HOME']),'ok']);
 const [s]=runChecks(process.cwd(),['node -e "process.exit(3)" || node -e "process.exit(0)"']);
 assert.equal(s.shell,true);
 assert.equal(s.exit_code,0);
 // npm은 Windows에서 풀 수 없는 배치 래퍼(npm.cmd)라 지금 node 곁의 npm-cli.js로 셸 없이 돈다.
 const [npm]=runChecks(process.cwd(),['npm --version']);
 assert.deepEqual([npm.shell,npm.exit_code],[false,0],npm.output_tail);
 // 실행 파일이 없으면(셸 내장 명령 등) 셸로 돌고, 셸이 못 찾으면 실패다.
 const [builtin]=runChecks(process.cwd(),['exit 0']);
 assert.deepEqual([builtin.shell,builtin.exit_code],[true,0]);
 const [missing]=runChecks(process.cwd(),['no-such-tool-hfgs --x']);
 assert.equal(missing.shell,true);
 assert.notEqual(missing.exit_code,0);
});

test('runChecks: 경로로 적은 실행 파일은 저장소 기준, 앞의 PATH는 실행 파일 찾기에도 쓴다',t=>{
 const repo=fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-checks-'));
 t.after(()=>fs.rmSync(repo,{recursive:true,force:true}));
 fs.mkdirSync(path.join(repo,'bin'));
 fs.writeFileSync(path.join(repo,'bin','hfgs-probe.mjs'),'console.log("probe "+process.argv.slice(2).join(","))\n');
 if(process.platform!=='win32')fs.chmodSync(path.join(repo,'bin','hfgs-probe.mjs'),0o755);
 const [rel]=runChecks(repo,['./bin/hfgs-probe.mjs "A&B"']);
 assert.deepEqual([rel.shell,rel.exit_code,rel.output_tail],[false,0,'probe A&B']);
 const [onPath]=runChecks(repo,[`PATH=${quote(path.join(repo,'bin'))} hfgs-probe.mjs x`]);
 assert.deepEqual([onPath.shell,onPath.exit_code,onPath.output_tail],[false,0,'probe x']);
 // 상대 PATH 항목은 컨트롤러의 현재 폴더가 아니라 저장소 기준이다(repo ≠ cwd).
 assert.notEqual(path.resolve(repo),process.cwd());
 const [relPath]=runChecks(repo,['PATH=bin hfgs-probe.mjs y']);
 assert.deepEqual([relPath.shell,relPath.exit_code,relPath.output_tail],[false,0,'probe y']);
 // 물려받은 PATH의 상대 항목도 저장소 기준이다.
 const inherited={...Object.fromEntries(Object.entries(process.env).filter(([k])=>k.toUpperCase()!=='PATH')),PATH:'bin'};
 const [inh]=runChecks(repo,['hfgs-probe.mjs z'],{env:inherited});
 assert.deepEqual([inh.shell,inh.exit_code,inh.output_tail],[false,0,'probe z']);
 // 빈 PATH 항목은 현재 폴더(저장소)다.
 fs.copyFileSync(path.join(repo,'bin','hfgs-probe.mjs'),path.join(repo,'hfgs-root.mjs'));
 const [empty]=runChecks(repo,[`PATH=${quote(path.delimiter+'bin')} hfgs-root.mjs w`]);
 assert.deepEqual([empty.shell,empty.exit_code,empty.output_tail],[false,0,'probe w']);
 if(process.platform==='win32'){
  // Windows는 이름의 대소문자를 가리지 않는다: Path=bin도 물려받은 PATH를 대신한다.
  const [lower]=runChecks(repo,['Path=bin hfgs-probe.mjs v'],{env:{...inherited,PATH:'C:\\nowhere'}});
  assert.deepEqual([lower.shell,lower.exit_code,lower.output_tail],[false,0,'probe v']);
  // 물려받은 키가 path·pAtH여도 같은 PATH다.
  const {PATH:_,...rest}=inherited;
  const [mixed]=runChecks(repo,['hfgs-probe.mjs u'],{env:{...rest,pAtH:'bin'}});
  assert.deepEqual([mixed.shell,mixed.exit_code,mixed.output_tail],[false,0,'probe u']);
 }
});
