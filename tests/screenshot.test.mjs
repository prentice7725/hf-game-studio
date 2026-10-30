// 스크린샷 도구의 인자 처리 테스트. 브라우저 실행은 여기서 하지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseArgs} from '../tools/screenshot.mjs';

test('대상은 하나만, 선택자는 필수',()=>{
 assert.deepEqual(parseArgs(['--url','http://x','--selector','#a']),{timeout:15000,url:'http://x',selector:'#a'});
 assert.throws(()=>parseArgs(['--url','http://x','--file','a.html','--selector','#a']),/하나만/);
 assert.throws(()=>parseArgs(['--url','http://x']),/--selector/);
 assert.throws(()=>parseArgs(['--bogus','1']),/알 수 없는 인자/);
});

test('숫자 인자는 숫자로',()=>{
 assert.equal(parseArgs(['--file','a.html','--selector','canvas','--timeout','500']).timeout,500);
});
