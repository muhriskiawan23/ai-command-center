import {createPcmEncoder,decodePcm} from '../../../public/primary-pcm.mjs';
function runPcmTests(create,decode){
 const assert=(v)=>{if(!v)throw Error('assertion failed')};
 const fixtures=[24000,48000,44100,16000,8000];
 for(const rate of fixtures){
  const frames=[];const enc=create(rate,f=>frames.push(f));
  const samples=new Float32Array(rate).fill(0.5);
  for(let i=0;i<samples.length;i+=128)enc.push(samples.subarray(i,i+128));
  assert(frames.length===50&&frames.every(f=>f.length===960));
  assert(decode(frames[0]).every(v=>Math.abs(v-0.5)<0.001));
 }
 let frames=[];let enc=create(24000,f=>frames.push(f));enc.push(new Float32Array(480).fill(-1));assert(decode(frames[0]).every(v=>v===-1));
 enc.push(new Float32Array(480).fill(2));assert(decode(frames[1]).every(v=>v===32767/32768));
 enc.push(new Float32Array(200).fill(1));enc.reset();enc.push(new Float32Array(480));assert(decode(frames[2]).every(v=>v===0));
 let bad=false;try{decode(new Uint8Array(3))}catch{bad=true}assert(bad);
 return{passed:9,total:9};
}
console.log(runPcmTests(createPcmEncoder,decodePcm));
