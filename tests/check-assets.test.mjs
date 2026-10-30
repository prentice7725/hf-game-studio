// 애셋 규격 검사 테스트. 실제 이미지 대신 PNG 헤더만 만들어 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readPng,checkAsset} from '../tools/check-assets.mjs';

function png(width,height,colorType,extra=[]){
 const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);return Buffer.concat([len,Buffer.from(type,'latin1'),data,Buffer.alloc(4)]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=colorType;
 return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ihdr),...extra.map(([t,d])=>chunk(t,d)),chunk('IDAT',Buffer.alloc(1)),chunk('IEND',Buffer.alloc(0))]);
}

test('RGBA PNG의 크기와 투명도를 읽는다',()=>{
 assert.deepEqual(readPng(png(256,128,6)),{width:256,height:128,colorType:6,alpha:true});
});

test('팔레트 PNG는 tRNS가 있어야 투명',()=>{
 assert.equal(readPng(png(8,8,3)).alpha,false);
 assert.equal(readPng(png(8,8,3,[['PLTE',Buffer.alloc(3)],['tRNS',Buffer.alloc(1)]])).alpha,true);
});

test('규격 위반을 모두 보고한다',()=>{
 const spec={file:'a.png',width:256,height:256,alpha:true,max_kb:0.01};
 const errors=checkAsset(spec,()=>png(128,256,2));
 assert.equal(errors.length,3);
 assert.match(errors.join(';'),/너비 128, 기대 256/);
 assert.match(errors.join(';'),/투명 채널 없음/);
});

test('파일이 없거나 PNG가 아니면 실패',()=>{
 assert.deepEqual(checkAsset({file:'x'},()=>{throw Object.assign(Error('x'),{code:'ENOENT'});}),['파일 없음']);
 assert.deepEqual(checkAsset({file:'x'},()=>Buffer.from('JFIF not a png at all, padding padding')),['PNG 파일이 아님']);
});

test('규격에 맞으면 통과',()=>{
 assert.deepEqual(checkAsset({file:'a.png',width:64,height:64,alpha:true,max_kb:10},()=>png(64,64,6)),[]);
});
