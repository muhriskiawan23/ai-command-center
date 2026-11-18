import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { planFeedbackForm } from "../src/form-draft.js";

const ctx=vm.createContext({});
vm.runInContext(readFileSync(new URL("../public/google-forms.js",import.meta.url),"utf8"),ctx);
const forms=ctx.BORGoogleForms;
const draft=planFeedbackForm("Buatkan formulir feedback dan saran BOR AI");
test("Google Forms client validates form draft and creates strictly bounded items",()=>{
 assert.equal(forms.validDraft(draft),true);
 assert.equal(forms.validDraft({...draft,items:[{title:"a",type:"unknown",required:false}]}),false);
 const request=forms.batch(draft);
 assert.equal(request.requests.length,draft.items.length+1);
 assert.equal(request.requests[1].createItem.item.questionItem.question.choiceQuestion.type,"RADIO");
 assert.equal(request.requests[2].createItem.item.questionItem.question.choiceQuestion.type,"CHECKBOX");
 assert.equal(request.requests[3].createItem.item.questionItem.question.scaleQuestion.high,5);
 assert.equal(request.requests[4].createItem.item.questionItem.question.textQuestion.paragraph,true);
 assert.deepEqual(JSON.parse(JSON.stringify(request.requests.slice(1).map(x=>x.createItem.location.index))),
  [0,1,2,3,4,5,6,7]);
});
test("direct Google Forms creation requests are not sent until explicitly called, and always unpublished",async()=>{
 const calls=[];const mock=async(url,opts)=>{
  calls.push({url,opts});
  return {ok:true,json:async()=>({formId:"abc123456789"})};
 };
 assert.equal(calls.length,0);
 const result=await forms.createUnpublishedForm(draft,"fake_access_token_12345",mock);
 assert.equal(result.complete,true);
 assert.equal(result.published,false);
 assert.equal(result.editUrl,"https://docs.google.com/forms/d/abc123456789/edit");
 assert.equal(calls.length,2);
 assert.equal(calls[0].url,"https://forms.googleapis.com/v1/forms?unpublished=true");
 assert.equal(JSON.parse(calls[0].opts.body).info.title,draft.title);
 assert.equal(calls[1].url,"https://forms.googleapis.com/v1/forms/abc123456789:batchUpdate");
 assert.equal(JSON.parse(calls[1].opts.body).requests.length,9);
 assert.equal(calls[0].opts.headers.Authorization,"Bearer fake_access_token_12345");
});
test("partial Google Forms failure returns real existing unpublished editor URL, never a fictional responder link",async()=>{
 const calls=[];
 const mock=async(url,opts)=>{
  calls.push(url);
  if(calls.length===1)return {ok:true,json:async()=>({formId:"abc123456789"})};
  return {ok:false,status:403};
 };
 const result=await forms.createUnpublishedForm(draft,"fake_access_token_12345",mock);
 assert.equal(result.complete,false);
 assert.equal(result.published,false);
 assert.match(result.editUrl,/\/edit$/);
 assert.equal(calls.length,2);
 const denied=async()=>({ok:false,status:403});
 await assert.rejects(forms.createUnpublishedForm(draft,"fake_access_token_12345",denied),/forms_api_creation_failed/);
});
test("Google token is requested only via explicit user call and least-privilege Forms scope",async()=>{
 let requested=0,clientId="",scope="";
 const oauth={
  initTokenClient(options){
   clientId=options.client_id;scope=options.scope;
   return {requestAccessToken(){requested++;options.callback({access_token:"fake_token_12345",scope:scope})}};
  },
  hasGrantedAllScopes(response,s){return response.scope===s;}
 };
 assert.equal(requested,0);
 const token=await forms.requestFormsAccess("123.apps.googleusercontent.com",oauth);
 assert.equal(token,"fake_token_12345");
 assert.equal(requested,1);
 assert.equal(clientId,"123.apps.googleusercontent.com");
 assert.equal(scope,"https://www.googleapis.com/auth/forms.body");
 assert.throws(()=>forms.requestFormsAccess("bad-client-id",oauth),/google_forms_oauth_unavailable/);
 assert.equal(requested,1);
});
