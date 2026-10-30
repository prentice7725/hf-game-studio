#!/usr/bin/env node
// 이미지·효과음 애셋이 매니페스트 규격에 맞는지 검사한다. 생성 모델(Grok, asset-pipeline 등)의 결과를 사람이 보기 전에 기계적으로 거른다.
// 사용법: node tools/hfgs/check-assets.mjs <매니페스트.json> [--only <파일 경로> ...]
// 매니페스트 형식:
//   {"assets":[{"file":"assets/merc/idle.png","width":128,"height":128,"alpha":true,"max_kb":256},
//              {"file":"assets/sfx/sword.wav","min_seconds":0.5,"max_seconds":2,"channels":2,"sample_rate":44100,"max_kb":512}]}
// PNG와 WAV(PCM)만 지원한다. PNG는 IHDR 헤더에서 크기를, 색 형식(회색+알파, RGBA) 또는 tRNS 청크로 투명도를 읽는다.
// WAV는 fmt·data 청크에서 채널·샘플레이트·길이를 읽는다. 소리 품질은 사람이 들어서 확인한다.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

const SIGNATURE=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);

export function readPng(buf){
 if(buf.length<33||!buf.subarray(0,8).equals(SIGNATURE))throw Error('PNG 파일이 아님');
 if(buf.toString('latin1',12,16)!=='IHDR')throw Error('IHDR 청크가 없음');
 const width=buf.readUInt32BE(16),height=buf.readUInt32BE(20),colorType=buf[25];
 let alpha=colorType===4||colorType===6;
 // 청크를 훑어 tRNS(팔레트·RGB 투명색)가 있는지 본다.
 for(let at=8;at+8<=buf.length;){
  const len=buf.readUInt32BE(at),type=buf.toString('latin1',at+4,at+8);
  if(type==='tRNS')alpha=true;
  if(type==='IDAT'||type==='IEND')break;
  at+=12+len;
 }
 return {width,height,colorType,alpha};
}

export function readWav(buf){
 if(buf.length<12||buf.toString('latin1',0,4)!=='RIFF'||buf.toString('latin1',8,12)!=='WAVE')throw Error('WAV 파일이 아님');
 let fmt,dataBytes;
 for(let at=12;at+8<=buf.length;){
  const type=buf.toString('latin1',at,at+4),len=buf.readUInt32LE(at+4);
  if(type==='fmt '&&len>=16)fmt={channels:buf.readUInt16LE(at+10),sampleRate:buf.readUInt32LE(at+12),byteRate:buf.readUInt32LE(at+16)};
  // 길이를 모르고 녹음한 스트림은 data 크기가 0xFFFFFFFF로 남으므로 파일에 실제로 있는 만큼만 센다.
  if(type==='data'){dataBytes=Math.min(len,buf.length-at-8);break;}
  at+=8+len+(len&1);
 }
 if(!fmt)throw Error('fmt 청크가 없음');
 if(dataBytes===undefined)throw Error('data 청크가 없음');
 if(!fmt.byteRate)throw Error('fmt 청크의 byteRate가 0');
 return {channels:fmt.channels,sampleRate:fmt.sampleRate,seconds:dataBytes/fmt.byteRate};
}

function checkPng(spec,buf){
 let png;
 try{png=readPng(buf);}catch(e){return [e.message];}
 const errors=[];
 if(spec.width!==undefined&&png.width!==spec.width)errors.push(`너비 ${png.width}, 기대 ${spec.width}`);
 if(spec.height!==undefined&&png.height!==spec.height)errors.push(`높이 ${png.height}, 기대 ${spec.height}`);
 if(spec.alpha===true&&!png.alpha)errors.push('투명 채널 없음(배경 제거 필요)');
 return errors;
}

function checkWav(spec,buf){
 let wav;
 try{wav=readWav(buf);}catch(e){return [e.message];}
 const errors=[];
 if(spec.min_seconds!==undefined&&wav.seconds<spec.min_seconds)errors.push(`길이 ${wav.seconds.toFixed(2)}초 < ${spec.min_seconds}초`);
 if(spec.max_seconds!==undefined&&wav.seconds>spec.max_seconds)errors.push(`길이 ${wav.seconds.toFixed(2)}초 > ${spec.max_seconds}초`);
 if(spec.channels!==undefined&&wav.channels!==spec.channels)errors.push(`채널 ${wav.channels}, 기대 ${spec.channels}`);
 if(spec.sample_rate!==undefined&&wav.sampleRate!==spec.sample_rate)errors.push(`샘플레이트 ${wav.sampleRate}, 기대 ${spec.sample_rate}`);
 return errors;
}

export function checkAsset(spec,read=f=>fs.readFileSync(f)){
 let buf;
 try{buf=read(spec.file);}catch(e){return [e.code==='ENOENT'?'파일 없음':e.message];}
 const errors=spec.file.toLowerCase().endsWith('.wav')?checkWav(spec,buf):checkPng(spec,buf);
 if(spec.max_kb!==undefined&&buf.length>spec.max_kb*1024)errors.push(`용량 ${Math.ceil(buf.length/1024)}KB > ${spec.max_kb}KB`);
 return errors;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const args=process.argv.slice(2),manifestFile=args[0],only=[];
 for(let i=1;i<args.length;i++){if(args[i]==='--only'&&args[i+1])only.push(args[++i]);else{console.error(`알 수 없는 인자: ${args[i]}`);process.exit(2);}}
 if(!manifestFile){console.error('사용법: check-assets.mjs <매니페스트.json> [--only <파일>]');process.exit(2);}
 let manifest;
 try{manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));}catch(e){console.error(`매니페스트를 읽을 수 없음: ${e.message}`);process.exit(2);}
 if(!Array.isArray(manifest.assets)){console.error('매니페스트에 assets 배열이 없음');process.exit(2);}
 const targets=only.length?manifest.assets.filter(a=>only.includes(a.file)):manifest.assets;
 const missing=only.filter(f=>!manifest.assets.some(a=>a.file===f));
 if(missing.length){console.error(`매니페스트에 없는 파일: ${missing.join(', ')}`);process.exit(2);}
 let failed=false;
 for(const spec of targets){
  const errors=checkAsset(spec);
  if(errors.length){failed=true;console.error(`FAIL ${spec.file}: ${errors.join('; ')}`);}
  else console.log(`OK ${spec.file}`);
 }
 process.exit(failed?1:0);
}
