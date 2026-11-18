import {deflateSync} from "node:zlib";
export function pngChunk(type,payload=Buffer.alloc(0)) {
  const name=Buffer.from(type), data=Buffer.concat([name,payload]);
  let crc=0xffffffff;
  for(const byte of data) {
    crc^=byte;
    for(let i=0;i<8;i++) crc=(crc&1)?0xedb88320^(crc>>>1):crc>>>1;
  }
  const size=Buffer.alloc(4), tail=Buffer.alloc(4);
  size.writeUInt32BE(payload.length); tail.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([size,data,tail]);
}
export function pngBytes({width=64,height=64,extra=0}={}) {
  const header=Buffer.alloc(13);
  header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),pngChunk("IHDR",header),
    ...(extra?[pngChunk("tEXt",Buffer.alloc(extra,65))]:[]),
    pngChunk("IDAT",deflateSync(Buffer.alloc((width*3+1)*height))),pngChunk("IEND")
  ]);
}
export const pngDataUri=options=>"data:image/png;base64,"+pngBytes(options).toString("base64");
