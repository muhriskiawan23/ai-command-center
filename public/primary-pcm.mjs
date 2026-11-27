export function createPcmEncoder(rate,emit){
 if(!Number.isFinite(rate)||rate<8000||rate>192000||typeof emit!=='function')throw Error('invalid_sample_rate');
 // Streaming box resampler, preserving fractional time across worklet blocks.
 const target=24000,ratio=rate/target;
 let remaining=ratio,sum=0,frame=new Uint8Array(960),at=0;
 function sample(value){
  const v=Math.max(-1,Math.min(1,Number.isFinite(value)?value:0));
  const n=Math.round(v<0?v*32768:v*32767);
  frame[at++]=n&255;frame[at++]=(n>>8)&255;
  if(at===frame.length){const out=frame;frame=new Uint8Array(960);at=0;emit(out)}
 }
 return {
  push(samples){
   for(let i=0;i<samples.length;i++){
    let amount=1;const value=Number.isFinite(samples[i])?samples[i]:0;
    while(amount>1e-9){
     const take=Math.min(amount,remaining);sum+=value*take;remaining-=take;amount-=take;
     if(remaining<=1e-9){sample(sum/ratio);remaining=ratio;sum=0}
    }
   }
  },
  reset(){remaining=ratio;sum=0;at=0}
 };
}
export function decodePcm(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length%2||!bytes.length||bytes.length>98304)throw Error('invalid_pcm');
 const result=new Float32Array(bytes.length/2);
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 for(let i=0;i<result.length;i++)result[i]=view.getInt16(i*2,true)/32768;
 return result;
}
