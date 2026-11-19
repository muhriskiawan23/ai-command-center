// Isolated sandbox payment stream guards. No Midtrans request or D1 mutation.
import test from "node:test";
import assert from "node:assert/strict";
import {handleSandboxPayment} from "../src/midtrans-sandbox-worker.js";

const endpoint="https://payments.example.test/webhook";
function sandbox(){
  return {PAYMENT_SANDBOX_ENABLED:"true",SANDBOX_DB:{},
    MIDTRANS_SANDBOX_SERVER_KEY:"SB-Mid-server-FAKE-TEST-ONLY",
    MIDTRANS_SANDBOX_MERCHANT_ID:"M_TEST",
    MIDTRANS_SANDBOX_SIGNATURE_SECRET_KEY:"SB-Mid-server-FAKE-TEST-ONLY",
    SANDBOX_OPERATOR_TOKEN:"sandbox-only-"+"x".repeat(40)};
}
function webhook(body,{signal,headers}={}){
  return new Request(endpoint,{method:"POST",body,duplex:"half",signal,headers});
}
test("aborted stalled Midtrans notification stops promptly before verification or credit",{
  timeout:2000
},async()=>{
  let cancelled=false,providerCalls=0;
  const controller=new AbortController();
  const stream=new ReadableStream({
    start(queue){queue.enqueue(new TextEncoder().encode("{"));},
    cancel(){cancelled=true;}
  });
  const promise=handleSandboxPayment(webhook(stream,{signal:controller.signal}),sandbox(),async()=>{
    providerCalls++;throw Error("External status must not be called");
  });
  // Let the Worker begin its pending body read before disconnecting.
  await new Promise(resolve=>setImmediate(resolve));
  controller.abort();
  const response=await promise;
  assert.equal(response.status,503);
  assert.equal((await response.json()).error,"Sandbox notification interrupted; provider retry required");
  assert.equal(providerCalls,0);
  assert.equal(cancelled,true);
});
test("oversized chunked notification is rejected and its stream cancelled",async()=>{
  let cancelled=false,providerCalls=0;
  const stream=new ReadableStream({
    start(queue){queue.enqueue(new Uint8Array(16385));},
    cancel(){cancelled=true;}
  });
  const result=await handleSandboxPayment(webhook(stream),sandbox(),async()=>{
    providerCalls++;throw Error("External status must not be called");
  });
  assert.equal(result.status,400);
  assert.equal(providerCalls,0);
  assert.equal(cancelled,true);
});
test("oversized declared notification fails before consuming its body",async()=>{
  let readCalls=0,providerCalls=0;
  const stream=new ReadableStream({pull(queue){
    readCalls++;queue.enqueue(new TextEncoder().encode("{}"));queue.close();
  }},{highWaterMark:0});
  const response=await handleSandboxPayment(webhook(stream,{
    headers:{"Content-Length":"16385"}
  }),sandbox(),async()=>{providerCalls++;throw Error("External status must not be called");});
  assert.equal(response.status,400);
  assert.equal(providerCalls,0);
  assert.equal(readCalls,0);
});
test("invalid UTF-8 is rejected instead of replacing bytes in signed notification",async()=>{
  let calls=0;
  const response=await handleSandboxPayment(webhook(new Uint8Array([0xc3,0x28])),sandbox(),async()=>{
    calls++;throw Error("External status must not be called");
  });
  assert.equal(response.status,400);
  assert.equal(calls,0);
});

test("unresponsive stream cancellation cannot block interrupted webhook retry response",{
  timeout:2000
},async()=>{
  let cancelAttempted=false,upstream=0;
  const controller=new AbortController();
  const stream=new ReadableStream({
    start(queue){queue.enqueue(new TextEncoder().encode("{"));},
    cancel(){cancelAttempted=true;return new Promise(()=>{});}
  });
  const pending=handleSandboxPayment(webhook(stream,{signal:controller.signal}),sandbox(),async()=>{
    upstream++;throw Error("No provider verification allowed");
  });
  await new Promise(resolve=>setImmediate(resolve));
  controller.abort();
  const response=await pending;
  assert.equal(response.status,503);
  assert.equal(cancelAttempted,true);
  assert.equal(upstream,0);
});
test("malformed but fully received sandbox callback remains non-retryable 400",async()=>{
  const response=await handleSandboxPayment(webhook(new TextEncoder().encode("{")),sandbox(),async()=>{
    throw Error("No provider call should be attempted");
  });
  assert.equal(response.status,400);
  assert.equal((await response.json()).error,"Invalid JSON notification");
});
