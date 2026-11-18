// Fail-closed Worker adapter for a dedicated, authenticated, pinned egress proxy.
// Bind EGRESS_PROXY to a private Cloudflare VPC Service after security review.
// Never substitute global fetch or an arbitrary public endpoint.
const MAX_BODY_BASE64 = 1_400_000;
// Cap the JSON envelope BEFORE parsing/base64 decoding. A page-size cap
// checked after response.json() did not bound the private-hop response.
export const MAX_PROXY_RESPONSE_BYTES = 1_500_000;
async function readProxyJson(response,signal){
  const cancel=()=>{try{void response.body?.cancel().catch(()=>{});}catch{}};
  const length=response.headers.get("content-length");
  if(length!==null&&(!/^[0-9]+$/.test(length)||Number(length)>MAX_PROXY_RESPONSE_BYTES)){
    cancel();throw Error("proxy_envelope_too_large");
  }
  if(signal?.aborted){cancel();throw Error("proxy_request_aborted");}
  const reader=response.body?.getReader();
  if(!reader)throw Error("proxy_empty_envelope");
  let abort,timer;
  const stopped=new Promise((_,reject)=>{
    abort=()=>reject(Error("proxy_request_aborted"));
    signal?.addEventListener("abort",abort,{once:true});
    timer=setTimeout(()=>reject(Error("proxy_envelope_timeout")),10000);
  });
  let total=0;
  const parts=[];
  try{
    for(;;){
      const {done,value}=await Promise.race([reader.read(),stopped]);
      if(done)break;
      total+=value.byteLength;
      if(total>MAX_PROXY_RESPONSE_BYTES)throw Error("proxy_envelope_too_large");
      parts.push(value);
    }
    const bytes=new Uint8Array(total);let offset=0;
    for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
    return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  }catch(error){
    // A stalled source may also stall cancel(); never await it on failure.
    void reader.cancel().catch(()=>{});throw error;
  }finally{clearTimeout(timer);signal?.removeEventListener("abort",abort);reader.releaseLock();}
}
function decodeBase64(value) {
  if (typeof value !== "string" || value.length > MAX_BODY_BASE64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw Error("invalid_proxy_body");
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

export function createVerifiedLinkFetcher(env) {
  // Provisioning credentials must never implicitly activate production URL reading.
  if (env?.URL_READER_ENABLED !== "true") return null;
  const binding = env?.EGRESS_PROXY;
  const token = env?.EGRESS_PROXY_TOKEN;
  if (!binding || typeof binding.fetch !== "function" || typeof token !== "string" || token.length < 32) return null;
  return async (url, { signal } = {}) => {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw Error("invalid_scheme");
    const response = await binding.fetch("http://egress.internal/fetch", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ url: parsed.toString() }),
      redirect: "manual",
      signal
    });
    if (!response.ok) {
      try{void response.body?.cancel().catch(()=>{});}catch{}
      throw Error("proxy_unavailable");
    }
    const data = await readProxyJson(response,signal);
    if (!data || !Number.isInteger(data.status) || data.status < 100 || data.status > 599 ||
        typeof data.peerIp !== "string" || !data.transport ||
        data.transport.peerIpVerified !== true ||
        data.transport.selectedPeerIp !== data.transport.observedPeerIp ||
        data.transport.selectedPeerIp !== data.peerIp ||
        (parsed.protocol === "https:" &&
          (data.transport.tlsAuthorized !== true || data.transport.tlsIdentityVerified !== true ||
           data.transport.tlsServername !== parsed.hostname))) throw Error("proxy_security_proof_missing");
    const bytes = decodeBase64(data.bodyBase64);
    if (bytes.length > 1_000_000) throw Error("proxy_body_too_large");
    const headers = new Headers();
    for (const key of ["content-type", "location"]) {
      if (typeof data.headers?.[key] === "string") headers.set(key, data.headers[key]);
    }
    return new Response(bytes, { status: data.status, headers });
  };
}
