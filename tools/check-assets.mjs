#!/usr/bin/env node
// 이미지 애셋이 매니페스트 규격에 맞는지 검사한다. 생성 모델(Grok 등)의 결과를 사람이 보기 전에 기계적으로 거른다.
// 사용법: node tools/hfgs/check-assets.mjs <매니페스트.json> [--only <파일 경로> ...]
// 매니페스트 형식:
//   {"assets":[{"file":"assets/merc/idle.png","width":128,"height":128,"alpha":true,"max_kb":256}]}
// PNG만 지원한다. 크기는 IHDR 헤더에서 읽고, 투명도는 색 형식(회색+알파, RGBA) 또는 tRNS 청크로 판단한다.
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

export function checkAsset(spec,read=f=>fs.readFileSync(f)){
 const errors=[];
 let buf;
 try{buf=read(spec.file);}catch(e){return [e.code==='ENOENT'?'파일 없음':e.message];}
 let png;
 try{png=readPng(buf);}catch(e){return [e.message];}
 if(spec.width!==undefined&&png.width!==spec.width)errors.push(`너비 ${png.width}, 기대 ${spec.width}`);
 if(spec.height!==undefined&&png.height!==spec.height)errors.push(`높이 ${png.height}, 기대 ${spec.height}`);
 if(spec.alpha===true&&!png.alpha)errors.push('투명 채널 없음(배경 제거 필요)');
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
