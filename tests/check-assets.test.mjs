// 애셋 규격 검사 테스트. 실제 이미지 대신 PNG 헤더만 만들어 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readPng,readWav,checkAsset} from '../tools/check-assets.mjs';

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

function wav({channels=2,sampleRate=44100,seconds=1,dataLen}={}){
 const byteRate=sampleRate*channels*2,data=Buffer.alloc(Math.round(seconds*byteRate));
 const fmt=Buffer.alloc(16);fmt.writeUInt16LE(1,0);fmt.writeUInt16LE(channels,2);fmt.writeUInt32LE(sampleRate,4);fmt.writeUInt32LE(byteRate,8);fmt.writeUInt16LE(channels*2,12);fmt.writeUInt16LE(16,14);
 const chunk=(type,body,len=body.length)=>{const h=Buffer.alloc(8);h.write(type,0,'latin1');h.writeUInt32LE(len,4);return Buffer.concat([h,body,Buffer.alloc(body.length&1)]);};
 const list=chunk('LIST',Buffer.from('INFOxyz'));
 const body=Buffer.concat([Buffer.from('WAVE'),chunk('fmt ',fmt),list,chunk('data',data,dataLen??data.length)]);
 const riff=Buffer.alloc(8);riff.write('RIFF',0,'latin1');riff.writeUInt32LE(body.length,4);
 return Buffer.concat([riff,body]);
}

test('WAV의 채널·샘플레이트·길이를 읽는다(홀수 길이 청크는 건너뜀)',()=>{
 assert.deepEqual(readWav(wav({channels:1,sampleRate:22050,seconds:0.5})),{channels:1,sampleRate:22050,seconds:0.5});
});

test('data 크기를 모르는 WAV는 파일에 있는 만큼만 센다',()=>{
 assert.equal(readWav(wav({seconds:1,dataLen:0xffffffff})).seconds,1);
});

test('효과음 규격 위반을 모두 보고한다',()=>{
 const errors=checkAsset({file:'a.wav',min_seconds:2,channels:1,sample_rate:48000,max_kb:1},()=>wav({seconds:1}));
 assert.equal(errors.length,4);
 assert.match(errors.join(';'),/길이 1\.00초 < 2초/);
 assert.match(errors.join(';'),/채널 2, 기대 1/);
 assert.match(errors.join(';'),/샘플레이트 44100, 기대 48000/);
 assert.match(errors.join(';'),/용량 \d+KB > 1KB/);
 assert.match(checkAsset({file:'a.wav',max_seconds:0.5},()=>wav({seconds:1}))[0],/길이 1\.00초 > 0\.5초/);
});

test('WAV가 아니거나 청크가 빠지면 실패',()=>{
 assert.deepEqual(checkAsset({file:'a.WAV'},()=>Buffer.from('fLaC not a wav file at all')),['WAV 파일이 아님']);
 assert.deepEqual(checkAsset({file:'a.wav'},()=>Buffer.from('RIFF\0\0\0\0WAVE')),['fmt 청크가 없음']);
});

test('효과음 규격에 맞으면 통과',()=>{
 assert.deepEqual(checkAsset({file:'a.wav',min_seconds:0.5,max_seconds:2,channels:2,sample_rate:44100,max_kb:512},()=>wav({seconds:1.5})),[]);
});
