import {createPcmEncoder} from './primary-pcm.mjs';
class BorCapture extends AudioWorkletProcessor {
 constructor(){super();this.enabled=false;this.encoder=createPcmEncoder(sampleRate,bytes=>this.port.postMessage(bytes,[bytes.buffer]));this.port.onmessage=({data})=>{this.enabled=data===true;this.encoder.reset()}}
 process(inputs,outputs){for(const channel of outputs[0]??[])channel.fill(0);const channel=inputs[0]?.[0];if(this.enabled&&channel)this.encoder.push(channel);return true}
}
registerProcessor('bor-primary-capture',BorCapture);
