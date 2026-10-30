// 데이터 스키마 검사기 테스트. 템플릿 스키마로 맞는 데이터와 틀린 데이터를 모두 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validate,collect,parseExpect,checkExpect} from '../tools/validate-data.mjs';

const schema=name=>JSON.parse(fs.readFileSync(new URL(`../templates/design/schemas/${name}.schema.json`,import.meta.url)));

test('collect는 * 경로로 값을 모은다',()=>{
 assert.deepEqual(collect({nodes:[{id:'a'},{id:'b'}]},'/nodes/*/id'),['a','b']);
});

test('맞는 용병 데이터는 통과',()=>{
 const data={version:1,mercenaries:[{id:'ash',name:'애쉬',hire_cost:100,stats:{might:5,wits:5,grit:5}}]};
 assert.deepEqual(validate(schema('mercenaries'),data),[]);
});

test('범위 밖 수치, 중복 id, 정의 안 된 필드를 잡는다',()=>{
 const data={version:1,mercenaries:[
  {id:'ash',name:'애쉬',hire_cost:100,stats:{might:11,wits:5,grit:5}},
  {id:'ash',name:'둘',hire_cost:1.5,stats:{might:1,wits:1,grit:1},extra:true}
 ]};
 const errors=validate(schema('mercenaries'),data).join('\n');
 assert.match(errors,/might: 11 > 최댓값 10/);
 assert.match(errors,/id 중복/);
 assert.match(errors,/hire_cost: integer/);
 assert.match(errors,/정의되지 않은 필드: extra/);
});

test('대사 선택지가 없는 노드를 가리키면 실패',()=>{
 const ok={id:'d',start:'n1',nodes:[{id:'n1',speaker:'의뢰인',text:'도와주시오',choices:[{text:'좋다',next:'n2'}]},{id:'n2',speaker:'애쉬',text:'가자'}]};
 assert.deepEqual(validate(schema('dialogue'),ok),[]);
 const bad=structuredClone(ok);bad.nodes[0].choices[0].next='n9';
 assert.match(validate(schema('dialogue'),bad).join('\n'),/"n9"는 \/nodes\/\*\/id에 없는 값/);
});

test('대사 길이 제한',()=>{
 const data={id:'d',start:'n1',nodes:[{id:'n1',speaker:'의뢰인',text:'가'.repeat(41)}]};
 assert.match(validate(schema('dialogue'),data).join('\n'),/길이 41 > 40/);
});

test('[키=값] 경로로 배열 원소를 고른다',()=>{
 const data={mercenaries:[{id:'ash',hire_cost:100},{id:'bo',hire_cost:50}]};
 assert.deepEqual(collect(data,'/mercenaries/[id=ash]/hire_cost'),[100]);
 assert.deepEqual(collect(data,'/mercenaries/[id=zz]/hire_cost'),[]);
});

test('--expect 값 확인: 같으면 통과, 다르거나 없으면 실패',()=>{
 const data={mercenaries:[{id:'ash',hire_cost:100,name:'애쉬'}]};
 assert.deepEqual(parseExpect('/mercenaries/[id=ash]/hire_cost=120'),{pointer:'/mercenaries/[id=ash]/hire_cost',value:120});
 assert.deepEqual(checkExpect(data,parseExpect('/mercenaries/[id=ash]/name="애쉬"')),[]);
 assert.match(checkExpect(data,parseExpect('/mercenaries/[id=ash]/hire_cost=120'))[0],/100, 기대 120/);
 assert.match(checkExpect(data,parseExpect('/mercenaries/[id=zz]/hire_cost=1'))[0],/값이 없음/);
 assert.throws(()=>parseExpect('/a/b=애쉬'),/JSON이 아님/);
 assert.throws(()=>parseExpect('hire_cost=1'),/형식/);
});

test('CLI: 이미 있는 파일 수정 작업은 --expect로 시작 전 실패(red-first)를 만든다',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hfgs-vd-')),file=path.join(dir,'m.json');
 const schemaFile=fileURLToPath(new URL('../templates/design/schemas/mercenaries.schema.json',import.meta.url));
 const run=(...extra)=>spawnSync(process.execPath,[fileURLToPath(new URL('../tools/validate-data.mjs',import.meta.url)),schemaFile,file,...extra],{encoding:'utf8'});
 fs.writeFileSync(file,JSON.stringify({version:1,mercenaries:[{id:'ash',name:'애쉬',hire_cost:100,stats:{might:5,wits:5,grit:5}}]}));
 assert.equal(run().status,0,'스키마만으로는 처음부터 통과');
 assert.equal(run('--expect','/mercenaries/[id=ash]/hire_cost=120').status,1,'바뀔 값 확인은 수정 전에 실패');
 fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('"hire_cost":100','"hire_cost":120'));
 assert.equal(run('--expect','/mercenaries/[id=ash]/hire_cost=120').status,0,'수정 후 통과');
});
