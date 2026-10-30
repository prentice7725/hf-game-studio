// 대사 JSON → Dialogic 타임라인 변환 테스트.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {toDtl,lint,glossaryIds,convert} from '../tools/dialogue-to-dtl.mjs';
import {validate} from '../tools/validate-data.mjs';
import {STUDIO_ROOT} from '../scripts/brief.mjs';

const SCHEMA=path.join(STUDIO_ROOT,'templates','design','schemas','dialogue.schema.json');
const GLOSSARY=path.join(STUDIO_ROOT,'templates','design','glossary.md');
const schema=JSON.parse(fs.readFileSync(SCHEMA,'utf8'));
const doc={id:'contract-grain-cart',start:'intro',nodes:[
 {id:'refuse',speaker:'ash',text:'다른 사람 알아봐.'},
 {id:'intro',speaker:'client',enter:[{character:'client',portrait:'worried',position:'center'}],text:'곡물 수레를 지켜 주시오: 급하오.',choices:[
  {text:'맡겠다',next:'accept'},
  {text:'선금부터',next:'accept',if:{var:'Player.gold',op:'<',value:10}},
  {text:'거절한다',next:'refuse'}]},
 {id:'accept',speaker:'ash',portrait:'smirk',set:[{var:'Contracts.grain',op:'=',value:true},{var:'Player.gold',op:'+=',value:5}],text:'좋아. 출발하지.',next:'road'},
 {id:'road',exit:['client'],text:'join 직전의 길은 조용했다.'}
]};

test('템플릿 스키마로 예시 대사가 통과하고, Dialogic 문법 기호는 막힌다',()=>{
 assert.deepEqual(validate(schema,doc),[]);
 const bad=structuredClone(doc);bad.nodes[0].text='금화 {gold}개';bad.nodes[1].choices[0].text='예 | 아니오';bad.nodes[2].speaker='애쉬';
 const errors=validate(schema,bad).join('\n');
 assert.match(errors,/nodes\[0\]\.text: 패턴/);
 assert.match(errors,/choices\[0\]\.text: 패턴/);
 assert.match(errors,/nodes\[2\]\.speaker: 패턴/);
});

test('toDtl: start가 먼저, 노드는 label, 선택지는 들여쓴 jump, 끝은 end_timeline',()=>{
 assert.equal(toDtl(doc,{source:'data/dialogue/x.json'}),[
  '# data/dialogue/x.json에서 tools/hfgs/dialogue-to-dtl.mjs로 만든 파일. 직접 고치지 말고 원본 JSON을 고칠 것.',
  'label intro',
  'join client (worried) center',
  '\\client: 곡물 수레를 지켜 주시오\\: 급하오.',
  '- 맡겠다','\tjump accept',
  '- 선금부터 | [if {Player.gold} < 10]','\tjump accept',
  '- 거절한다','\tjump refuse',
  'label refuse',
  '\\ash: 다른 사람 알아봐.',
  '[end_timeline]',
  'label accept',
  'set {Contracts.grain} = true',
  'set {Player.gold} += 5',
  '\\ash (smirk): 좋아. 출발하지.',
  'jump road',
  'label road',
  '\\join 직전의 길은 조용했다.',
  'leave client',
  '[end_timeline]',''].join('\n'));
});

test('lint: next·exit와 choices 동시 사용, 화자 없는 표정, 용어집에 없는 인물, 닿지 않는 노드',()=>{
 const bad=structuredClone(doc);
 bad.nodes[1].next='road';
 bad.nodes[1].exit=['client'];
 bad.nodes[3].portrait='sad';
 bad.nodes[0].speaker='bo';
 bad.nodes.push({id:'orphan',text:'아무도 안 옴'});
 const {errors,warnings}=lint(bad,{glossaryIds:new Set(['ash','client'])});
 assert.ok(errors.some(e=>/intro: next와 choices/.test(e)));
 assert.ok(errors.some(e=>/road: speaker 없는 서술에는 portrait/.test(e)));
 assert.ok(errors.some(e=>/intro: exit와 choices/.test(e)));
 assert.ok(errors.some(e=>/refuse: 인물 ID "bo"가 용어집에 없음/.test(e)));
 assert.deepEqual(warnings,['orphan: start에서 닿지 않는 노드']);
 assert.deepEqual(lint(doc,{glossaryIds:new Set(['ash','client'])}),{errors:[],warnings:[]});
});

test('glossaryIds: ID 열이 있는 표에서만 읽는다',()=>{
 const ids=glossaryIds(fs.readFileSync(GLOSSARY,'utf8')+'\n| 이름 | 뜻 |\n|---|---|\n| nope | x |\n');
 assert.ok(ids.has('ash')&&ids.has('client')&&ids.has('gold'));
 assert.ok(!ids.has('nope')&&!ids.has('---'));
});

test('convert: 통과한 파일만 id.dtl로 쓰고, --check는 쓰지 않는다',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-dtl-'));
 const good=path.join(dir,'good.json'),broken=path.join(dir,'broken.json');
 fs.writeFileSync(good,JSON.stringify(doc));
 fs.writeFileSync(broken,JSON.stringify({...doc,nodes:[{...doc.nodes[0],speaker:'bo'}],start:'refuse'}));
 const out=path.join(dir,'timelines');
 const checked=convert([good,broken],{schema:SCHEMA,glossary:GLOSSARY,outDir:out,check:true});
 assert.equal(checked[0].errors.length,0);
 assert.match(checked[1].errors.join(),/"bo"가 용어집에 없음/);
 assert.ok(!fs.existsSync(out));
 convert([good],{schema:SCHEMA,glossary:GLOSSARY,outDir:out});
 assert.match(fs.readFileSync(path.join(out,'contract-grain-cart.dtl'),'utf8'),/^label intro$/m);
 assert.equal(convert([good],{schema:SCHEMA,glossary:null,outDir:out,check:true})[0].errors.length,0);
});
