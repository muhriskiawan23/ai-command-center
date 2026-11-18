// Disposable loopback-only workerd proof. Never deployed or production-routed.
import {normalizePngDataUri} from "../../src/png-preflight.js";
export default {
  async fetch(request){
    if(request.method!=="POST")return new Response("method",{status:405});
    try{
      const text=await request.text();if(text.length>1024*1024)return new Response("limit",{status:413});
      const {imageDataUri}=JSON.parse(text);
      return Response.json(await normalizePngDataUri(imageDataUri));
    }catch{return Response.json({ok:false},{status:422});}
  }
};
