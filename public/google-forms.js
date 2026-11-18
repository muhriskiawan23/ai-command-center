/* Optional, user-initiated Google Forms REST client.
 * This file NEVER runs requests on page load. Google OAuth token stays only in
 * the callback closure, and is never sent to BOR AI's own backend.
 */
(function () {
  "use strict";
  const scope="https://www.googleapis.com/auth/forms.body";
  const endpoint="https://forms.googleapis.com/v1/forms";
  function validDraft(draft) {
    if(!draft||draft.kind!=="google-forms-apps-script"||
      typeof draft.title!=="string"||draft.title.length<1||draft.title.length>150||
      !Array.isArray(draft.items)||draft.items.length<1||draft.items.length>20)return false;
    return draft.items.every(item=>item&&typeof item.title==="string"&&item.title.length>0&&item.title.length<=200&&
      ["choice","checkbox","scale","paragraph"].includes(item.type)&&typeof item.required==="boolean"&&
      (!["choice","checkbox"].includes(item.type)||(Array.isArray(item.choices)&&item.choices.length>=2&&item.choices.length<=12&&
        item.choices.every(choice=>typeof choice==="string"&&choice.length>0&&choice.length<=120))));
  }
  function batch(draft) {
    if(!validDraft(draft))throw Error("invalid_form_draft");
    const requests=[
      {updateFormInfo:{info:{description:"Masukan bersifat sukarela. Jangan bagikan kata sandi, dokumen identitas, atau data sensitif."},updateMask:"description"}}
    ];
    draft.items.forEach((q,index)=>{
      const question={required:q.required};
      if(q.type==="choice"||q.type==="checkbox"){
        question.choiceQuestion={type:q.type==="choice"?"RADIO":"CHECKBOX",options:q.choices.map(value=>({value}))};
      }else if(q.type==="scale")question.scaleQuestion={low:1,high:5};
      else question.textQuestion={paragraph:true};
      requests.push({createItem:{item:{title:q.title,questionItem:{question}},location:{index}}});
    });
    return {requests};
  }
  async function createUnpublishedForm(draft,token,fetcher) {
    if(!validDraft(draft)||typeof token!=="string"||token.length<8)throw Error("invalid_authorization");
    if(typeof fetcher!=="function")throw Error("network_unavailable");
    const headers={Authorization:"Bearer "+token,"Content-Type":"application/json"};
    const created=await fetcher(endpoint+"?unpublished=true",{
      method:"POST",headers,body:JSON.stringify({info:{title:draft.title,documentTitle:draft.title}}),redirect:"error"
    });
    if(!created?.ok)throw Error("forms_api_creation_failed");
    const data=await created.json();
    const id=data?.formId;
    if(typeof id!=="string"||!/^[A-Za-z0-9_-]{8,200}$/.test(id))throw Error("invalid_forms_response");
    const editUrl="https://docs.google.com/forms/d/"+encodeURIComponent(id)+"/edit";
    try {
      const updated=await fetcher(endpoint+"/"+encodeURIComponent(id)+":batchUpdate",{
        method:"POST",headers,body:JSON.stringify(batch(draft)),redirect:"error"
      });
      if(!updated?.ok)throw Error("forms_api_items_failed");
      return {formId:id,editUrl,published:false,complete:true};
    }catch{
      // A form was actually created. Preserve its editor link so the owner
      // can finish manually and avoid duplicate form creation on retry.
      return {formId:id,editUrl,published:false,complete:false};
    }
  }
  function requestFormsAccess(clientId,oauth) {
    if(typeof clientId!=="string"||!clientId.endsWith(".apps.googleusercontent.com")||
      typeof oauth?.initTokenClient!=="function")throw Error("google_forms_oauth_unavailable");
    // Must be called synchronously from a click handler so Google can show
    // its account and consent prompt without a popup blocker.
    let settled=false;
    return new Promise((resolve,reject)=>{
      const client=oauth.initTokenClient({
        client_id:clientId,scope,
        callback:(reply)=>{
          if(settled)return;
          settled=true;
          if(reply?.error||typeof reply?.access_token!=="string"||reply.access_token.length<8){
            reject(Error("google_forms_access_denied"));return;
          }
          if(typeof oauth.hasGrantedAllScopes==="function"&&!oauth.hasGrantedAllScopes(reply,scope)){
            reject(Error("google_forms_scope_not_granted"));return;
          }
          resolve(reply.access_token);
        },
        error_callback:()=>{
          if(settled)return;settled=true;reject(Error("google_forms_popup_failed"));
        }
      });
      client.requestAccessToken({prompt:"consent"});
    });
  }
  globalThis.BORGoogleForms=Object.freeze({validDraft,batch,createUnpublishedForm,requestFormsAccess});
})();
