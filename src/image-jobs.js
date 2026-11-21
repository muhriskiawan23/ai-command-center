import { json, sha256Hex } from './http.js';

const MAX_INPUT = 5 * 1024 * 1024;
const MAX_OUTPUT = 12 * 1024 * 1024;
const RETENTION = 7 * 86400;
const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
const nowSeconds = () => Math.floor(Date.now() / 1000);
const uuid = /^[a-f0-9-]{36}$/i;
const positive = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

export function imageConfig(env) {
  const generate = positive(env.IMAGE_CREDITS_GENERATE);
  const edit = positive(env.IMAGE_CREDITS_EDIT);
  const version = typeof env.IMAGE_TARIFF_VERSION === 'string' ? env.IMAGE_TARIFF_VERSION.trim().slice(0,80) : '';
  // Pilot requires a lifetime provider-attempt cap, not merely a per-day quota.
  // Failed/ambiguous upstream requests still consume the cap because they may be billed.
  const totalAttemptLimit = positive(env.IMAGE_PROVIDER_TOTAL_ATTEMPT_LIMIT);
  const safePilot = totalAttemptLimit && totalAttemptLimit <= 10 && env.OPENAI_IMAGE_MODEL === 'gpt-image-2' && env.IMAGE_PILOT_QUALITY === 'low';
  const enabled = env.BOR_IMAGES_ENABLED === 'true' && Boolean(env.OPENAI_API_KEY && env.DB && env.IMAGE_FILES && env.IMAGE_QUEUE && generate && edit && version && safePilot);
  return { enabled, pilotMaxAttempts: safePilot ? totalAttemptLimit : null, credits: { generate, edit }, tariffVersion: version || null, formats: Object.keys(MIME), sizes: ['1024x1024'], retentionDays: 7, provider: 'OpenAI', enhancement: 'generative' };
}

export function imageSignature(bytes, mime) {
  if (mime === MIME.png) return bytes.length > 8 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v);
  if (mime === MIME.jpeg) return bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === MIME.webp) return bytes.length > 12 && String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
  return false;
}
function decodeImage(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(MAX_INPUT / 3) * 4 + 50) throw new Error('invalid_image');
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || match[2].length % 4) throw new Error('invalid_image');
  const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
  if (bytes.length > MAX_INPUT || !imageSignature(bytes, match[1])) throw new Error('invalid_image');
  return { bytes, mime: match[1] };
}
function publicJob(row) {
  const completed = row.status === 'completed' && row.expires_at > nowSeconds();
  return { id: row.id, type: 'image_result', mode: row.mode, prompt: row.prompt, conversationId: row.conversation_id || null, status: row.status === 'completed' && !completed ? 'expired' : row.status,
    jobStatus: row.status, credits: row.credits, tariffVersion: row.tariff_version, createdAt: row.created_at, expiresAt: row.expires_at,
    errorCode: row.error_code || null,
    files: completed ? [{ id: row.id, name: `bor-ai-${row.id}.${row.output_format}`, mimeType: MIME[row.output_format], size: row.output_bytes,
      previewUrl: `/api/files/${row.id}/preview`, downloadUrl: `/api/files/${row.id}/download` }] : [] };
}
// Optional read-only per-chat media view. Do not query an unmigrated production
// database unless an operator explicitly enables the separately reviewed schema.
export async function listChatImageJobs(env,userId,conversationId) {
  if (env.BOR_IMAGE_CHAT_HISTORY_ENABLED !== 'true' || !env.DB) return [];
  const result=await env.DB.prepare(
    "SELECT * FROM image_jobs WHERE user_id=? AND conversation_id=? AND status!='expired' ORDER BY created_at DESC,id DESC LIMIT 50"
  ).bind(userId,conversationId).all();
  return (result.results || []).reverse().map(publicJob);
}
const findJob = (env,id,userId) => env.DB.prepare('SELECT * FROM image_jobs WHERE id = ? AND user_id = ?').bind(id,userId).first();
// Reading existing images is allowed when generation is disabled, but an
// unmigrated D1 must give a stable response rather than leaking a SQL error.
const imageSchemaMissing = error => /\bno such table:\s*(?:main\.)?(?:image_jobs|image_wallets|image_credit_ledger)\b/i.test(String(error?.message || ''));
const imageSchemaUnavailable = () => json({error:'Riwayat gambar belum tersedia. Infrastruktur sedang disiapkan.',code:'image_schema_unavailable'},503);
// Operator-owned aggregate: no user IDs, no user/job foreign key and never
// decremented by account deletion, expiry or retry. Missing/corrupt state halts
// all paid calls rather than falling back to the deletable image_jobs table.
const BILLING_UNVERIFIED = 'image_provider_billing_unverified';
async function pilotState(env) {
  const row = await env.DB.prepare(
    'SELECT admitted_count,unsettled_calls,billing_hold FROM image_pilot_meter WHERE singleton=1'
  ).first();
  if (!row || !Number.isSafeInteger(row.admitted_count) || row.admitted_count < 0 ||
      ![0,1].includes(row.unsettled_calls) || ![0,1].includes(row.billing_hold))
    throw new Error('image_pilot_meter_unavailable');
  return row.billing_hold ? 'billing_reconciliation_pending'
    : row.unsettled_calls ? 'image_pilot_in_flight' : null;
}
const pilotBillingUnverified = async env => Boolean(await pilotState(env));
async function settlePilotCall(env) {
  const result = await env.DB.prepare(
    'UPDATE image_pilot_meter SET unsettled_calls=0,updated_at=? WHERE singleton=1 AND unsettled_calls=1 AND billing_hold=0'
  ).bind(nowSeconds()).run();
  if (result.meta?.changes!==1) throw new Error('image_pilot_meter_unavailable');
}
async function holdPilotBilling(env) {
  const result = await env.DB.prepare(
    'UPDATE image_pilot_meter SET billing_hold=1,updated_at=? WHERE singleton=1'
  ).bind(nowSeconds()).run();
  if (result.meta?.changes!==1) throw new Error('image_pilot_meter_unavailable');
}
async function failJob(env,id,code) {
  await env.DB.prepare("UPDATE image_jobs SET status='failed', error_code=?, updated_at=? WHERE id=? AND status IN ('queued','processing')").bind(code,nowSeconds(),id).run();
}

// All state-changing routes require a real session and a same-origin request.
export async function handleImageRoute(request, env, url, deps) {
  if (url.pathname === '/api/images/config' && request.method === 'GET') {
    const config = imageConfig(env);
    if (!config.enabled) return json(config);
    try {
      const unavailableReason = await pilotState(env);
      if (unavailableReason) return json({...config,enabled:false,unavailableReason});
    } catch {
      // Availability must fail closed rather than advertise a paid service that
      // cannot prove its D1 billing marker state. No raw SQL/provider errors.
      return json({...config,enabled:false,unavailableReason:'image_billing_preflight_unavailable'});
    }
    return json(config);
  }
  const isJobs = url.pathname === '/api/images/jobs';
  const jobMatch = /^\/api\/images\/jobs\/([a-f0-9-]{36})$/i.exec(url.pathname);
  const fileMatch = /^\/api\/files\/([a-f0-9-]{36})\/(preview|download)$/i.exec(url.pathname);
  if (!isJobs && !jobMatch && !fileMatch) return json({error:'Endpoint gambar tidak ditemukan.'},404);
  if (!['GET','POST','DELETE'].includes(request.method) || (fileMatch && request.method !== 'GET') || (isJobs && request.method === 'DELETE') || (jobMatch && request.method === 'POST')) return json({error:'Metode tidak didukung.'},405);
  if (request.method !== 'GET' && !deps.sameOrigin(request)) return json({error:'Origin tidak valid.'},403);
  const user = await deps.getSession(request,env);
  if (!user) return json({error:'Masuk dengan akun Google untuk membuat dan membuka gambar.'},401);
  if (!env.DB) return json({error:'Penyimpanan gambar belum siap.'},503);
  if (isJobs && request.method === 'GET') {
    try {
    const conversationId = url.searchParams.get('conversationId');
    if (conversationId !== null && !/^[a-zA-Z0-9-]{8,80}$/.test(conversationId))
      return json({error:'Percakapan tidak valid.'},400);
    if (conversationId !== null) {
      const owner = await env.DB.prepare('SELECT id FROM conversations WHERE id=? AND user_id=?').bind(conversationId,user.id).first();
      if (!owner) return json({error:'Percakapan tidak ditemukan.'},404);
    }
    const rows = conversationId === null
      ? await env.DB.prepare("SELECT * FROM image_jobs WHERE user_id=? AND status!='expired' ORDER BY created_at DESC LIMIT 50").bind(user.id).all()
      : await env.DB.prepare("SELECT * FROM image_jobs WHERE user_id=? AND conversation_id=? AND status!='expired' ORDER BY created_at DESC LIMIT 50").bind(user.id,conversationId).all();
    const wallet = await env.DB.prepare('SELECT balance FROM image_wallets WHERE user_id=?').bind(user.id).first();
    return json({ jobs: (rows.results || []).map(publicJob), balance: wallet?.balance || 0 });
    } catch (error) {
      if (imageSchemaMissing(error)) return imageSchemaUnavailable();
      throw error;
    }
  }
  if (jobMatch || fileMatch) {
    const id = (jobMatch || fileMatch)[1];
    let row;
    try { row = await findJob(env,id,user.id); }
    catch (error) {
      if (imageSchemaMissing(error)) return imageSchemaUnavailable();
      throw error;
    }
    if (!row) return json({error:'Gambar tidak ditemukan.'},404);
    if (request.method === 'DELETE') {
      // Do not delete in-flight work or refund an ambiguous provider call.
      if (['queued','processing'].includes(row.status)) return json({error:'Tunggu pemrosesan selesai sebelum menghapus gambar.'},409);
      if (!env.IMAGE_FILES) return json({error:'Penyimpanan gambar belum siap.'},503);
      await env.IMAGE_FILES.delete([row.source_key,row.output_key].filter(Boolean));
      await env.DB.prepare("UPDATE image_jobs SET status='expired', prompt='', source_key=NULL, output_key=NULL, usage_json=NULL, updated_at=? WHERE id=? AND user_id=?").bind(nowSeconds(),id,user.id).run();
      return json({deleted:true});
    }
    if (jobMatch) return json(publicJob(row));
    if (row.status !== 'completed' || row.expires_at <= nowSeconds()) return json({error:'File belum tersedia atau sudah kedaluwarsa.'},410);
    const object = await env.IMAGE_FILES?.get(row.output_key);
    if (!object) return json({error:'File tidak ditemukan.'},404);
    return new Response(object.body, {headers:{'Content-Type':MIME[row.output_format], 'Content-Length':String(row.output_bytes),
      'Content-Disposition':`${fileMatch[2] === 'download' ? 'attachment' : 'inline'}; filename="bor-ai-${id}.${row.output_format}"`,
      'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff', 'Cross-Origin-Resource-Policy':'same-origin', 'Content-Security-Policy':"default-src 'none'; sandbox"}});
  }
  const config = imageConfig(env);
  if (!config.enabled) return json({error:'Fitur buat/edit gambar belum aktif di BOR AI saat ini.',code:'images_unavailable'},503);
  if (await pilotBillingUnverified(env)) return json({error:'Pembuatan gambar dihentikan sementara untuk pemeriksaan biaya API. Riwayat gambar tetap tersedia.',code:'image_pilot_suspended'},503);
  if (!env.CHAT_LIMITER?.limit) return json({error:'Pembatasan gambar belum siap.'},503);
  const limited = await env.CHAT_LIMITER.limit({key:'images:'+user.id});
  if (!limited?.success) return json({error:'Terlalu banyak permintaan gambar.'},429,{'Retry-After':'60'});
  const parsed = await deps.readJsonRequest(request,7*1024*1024);
  if (parsed.error) return parsed.error;
  const body = parsed.body || {};
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const {mode,requestId} = body;
  const format = body.outputFormat || 'png', size = body.size || '1024x1024';
  if (!['edit','generate'].includes(mode) || !prompt || prompt.length > 4000 || !uuid.test(requestId || '') || !Object.hasOwn(MIME,format) || !config.sizes.includes(size)) return json({error:'Parameter gambar tidak valid.'},400);
  let source = null;
  if (body.sourceImage && body.sourceJobId) return json({error:'Pilih satu sumber gambar.'},400);
  if (mode === 'generate' && (body.sourceImage || body.sourceJobId)) return json({error:'Gunakan mode edit untuk gambar sumber.'},400);
  if (mode === 'edit' && !body.sourceImage && !body.sourceJobId) return json({error:'Unggah foto atau pilih hasil sebelumnya untuk diedit.'},400);
  if (body.sourceImage) { try { source = decodeImage(body.sourceImage); } catch { return json({error:'Pilih JPG, PNG, atau WEBP yang valid, maksimal 5 MB.'},400); } }
  const requestedConversationId = body.conversationId === undefined ? null : body.conversationId;
  if (requestedConversationId !== null && (typeof requestedConversationId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(requestedConversationId)))
    return json({error:'Percakapan gambar tidak valid.'},400);
  if (requestedConversationId !== null) {
    const owner = await env.DB.prepare('SELECT id FROM conversations WHERE id=? AND user_id=?').bind(requestedConversationId,user.id).first();
    if (!owner) return json({error:'Percakapan gambar tidak ditemukan.'},404);
  }
  const fingerprint = await sha256Hex(JSON.stringify([mode,prompt,format,size,body.sourceImage || '',body.sourceJobId || '',requestedConversationId || '']));
  const previous = await env.DB.prepare('SELECT * FROM image_jobs WHERE user_id=? AND request_id=?').bind(user.id,requestId).first();
  if (previous) return previous.request_hash === fingerprint ? json(publicJob(previous)) : json({error:'Request ID telah digunakan untuk instruksi berbeda.'},409);
  if (body.tariffVersion !== config.tariffVersion || body.maxCredits !== config.credits[mode]) return json({error:'Tarif gambar berubah. Tutup dialog dan periksa biaya lagi.',code:'image_tariff_changed'},409);
  if (body.sourceJobId) {
    if (!uuid.test(body.sourceJobId)) return json({error:'Sumber gambar tidak valid.'},400);
    const parent = await findJob(env,body.sourceJobId,user.id);
    if (!parent || parent.status !== 'completed' || parent.expires_at <= nowSeconds()) return json({error:'Sumber gambar tidak ditemukan atau kedaluwarsa.'},404);
    const object = await env.IMAGE_FILES.get(parent.output_key);
    if (!object || parent.output_bytes > MAX_INPUT) return json({error:'Sumber tidak tersedia atau melebihi 5 MB.'},400);
    source = {bytes:new Uint8Array(await object.arrayBuffer()),mime:MIME[parent.output_format]};
  }
  const id = crypto.randomUUID(), now = nowSeconds(), key = source ? `images/${user.id}/${id}/source` : null;
  const conversationId = requestedConversationId || crypto.randomUUID();
  let madeConversation = false;
  if (source) await env.IMAGE_FILES.put(key,source.bytes,{httpMetadata:{contentType:source.mime}});
  try {
    if (!requestedConversationId) {
      const title = prompt.replace(/\s+/g,' ').slice(0,72) || 'Gambar baru';
      await env.DB.prepare('INSERT INTO conversations(id,user_id,title,created_at,updated_at) VALUES(?,?,?,?,?)')
        .bind(conversationId,user.id,title,now,now).run();
      madeConversation = true;
    }
  } catch (error) {
    if (key) await env.IMAGE_FILES.delete(key);
    throw error;
  }
  const cleanupUnusedChat = async () => {
    if (madeConversation) await env.DB.prepare('DELETE FROM conversations WHERE id=? AND user_id=?').bind(conversationId,user.id).run();
  };
  let inserted;
  try {
    // Atomic admission + triggers: per-account/global daily caps and credit reservation.
    inserted = await env.DB.prepare(`INSERT INTO image_jobs
      (id,user_id,request_id,request_hash,mode,prompt,model,output_format,size,status,source_key,source_mime,credits,tariff_version,created_at,updated_at,expires_at,conversation_id)
      SELECT ?,?,?,?,?,?,?,?,?,'queued',?,?,?,?,?,?,?,?
      WHERE (SELECT COUNT(*) FROM image_jobs WHERE created_at>=? AND user_id=?) < ?
        AND (SELECT COUNT(*) FROM image_jobs WHERE created_at>=?) < ?
        AND (SELECT admitted_count FROM image_pilot_meter WHERE singleton=1) < ?`)
      .bind(id,user.id,requestId,fingerprint,mode,prompt,env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-sunburst',format,size,key,source?.mime || null,config.credits[mode],config.tariffVersion,now,now,now+RETENTION,conversationId,
        now-now%86400,user.id,positive(env.IMAGE_DAILY_LIMIT_USER)||3,now-now%86400,positive(env.IMAGE_DAILY_LIMIT_GLOBAL)||20,config.pilotMaxAttempts).run();
  } catch (error) {
    const replay = await env.DB.prepare('SELECT * FROM image_jobs WHERE user_id=? AND request_id=?').bind(user.id,requestId).first();
    if (key && replay?.id !== id) await env.IMAGE_FILES.delete(key);
    if (replay?.id !== id) await cleanupUnusedChat();
    if (replay) return replay.request_hash === fingerprint ? json(publicJob(replay)) : json({error:'Request ID telah digunakan.'},409);
    if (String(error?.message).includes('image_insufficient_credits')) return json({error:'Kredit gambar tidak cukup. Isi kredit melalui pengelola BOR AI.',code:'image_insufficient_credits'},402);
    throw error;
  }
  if (!inserted.meta?.changes) {
    if (key) await env.IMAGE_FILES.delete(key);
    await cleanupUnusedChat();
    return json({error:'Batas harian gambar tercapai. Coba lagi besok.',code:'image_daily_limit'},429);
  }
  if (requestedConversationId) {
    // A chat can still be read even if reordering its navigation metadata fails.
    await env.DB.prepare('UPDATE conversations SET updated_at=? WHERE id=? AND user_id=?')
      .bind(now,requestedConversationId,user.id).run().catch(()=>{});
  }
  try { await env.IMAGE_QUEUE.send({id}); }
  catch {
    // Queue send errors may mean it was accepted; only fail if no consumer has claimed it.
    await env.DB.prepare("UPDATE image_jobs SET status='failed', error_code='queue_unavailable', updated_at=? WHERE id=? AND status='queued'").bind(nowSeconds(),id).run();
  }
  const created = await findJob(env,id,user.id);
  if (created.status === 'failed' && key) { await env.IMAGE_FILES.delete(key); await env.DB.prepare('UPDATE image_jobs SET source_key=NULL WHERE id=?').bind(id).run(); }
  return json(publicJob(created),202);
}

async function boundedBytes(response, limit) {
  if (Number(response.headers.get('Content-Length')) > limit) throw new Error('provider_output_too_large');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) { const {value,done} = await reader.read(); if (done) break; size += value.length;
      if (size > limit) throw new Error('provider_output_too_large'); chunks.push(value); }
  } finally { await reader.cancel().catch(()=>{}); }
  const bytes = new Uint8Array(size); let offset=0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.length; }
  return bytes;
}

export async function processImageJob(env,id) {
  if (!uuid.test(id || '')) return;
  // Never retry an already-started paid call. At-least-once queue delivery cannot double-charge.
  const row = await env.DB.prepare("UPDATE image_jobs SET status='processing', updated_at=? WHERE id=? AND status='queued' RETURNING *").bind(nowSeconds(),id).first();
  if (!row) return;
  let outputKey = null;
  let providerAttempted = false;
  try {
    if (!imageConfig(env).enabled || row.model !== 'gpt-image-2' || row.size !== '1024x1024') throw new Error('images_unavailable');
    if (await pilotBillingUnverified(env)) throw new Error('image_pilot_suspended');
    const options = {model:row.model,prompt:row.prompt,n:1,quality:'low',size:row.size,output_format:row.output_format,safety_identifier:await sha256Hex('bor-image:'+row.user_id)};
    let body, headers = {Authorization:'Bearer '+env.OPENAI_API_KEY};
    if (row.mode === 'edit') {
      const source = await env.IMAGE_FILES.get(row.source_key);
      if (!source) throw new Error('source_unavailable');
      body = new FormData();
      for (const [key,value] of Object.entries(options)) body.set(key,String(value));
      body.set('image',new Blob([await source.arrayBuffer()],{type:row.source_mime}),'source.'+(row.source_mime.split('/')[1]));
    } else { body = JSON.stringify(options); headers['Content-Type']='application/json'; }
    const signal = AbortSignal.timeout(150_000);
    // Persist a global pending-provider-call marker BEFORE any network dispatch.
    // It survives Worker termination and account deletion. Only one call may be
    // unsettled at once; extra queue consumers cannot bypass this D1 guard.
    const admitted = await env.DB.prepare(
      'UPDATE image_pilot_meter SET unsettled_calls=1,updated_at=? WHERE singleton=1 AND billing_hold=0 AND unsettled_calls=0'
    ).bind(nowSeconds()).run();
    if (admitted.meta?.changes!==1) throw new Error('image_pilot_suspended');
    providerAttempted = true;
    const response = await (env.IMAGE_FETCHER || fetch)('https://api.openai.com/v1/images/'+(row.mode === 'edit' ? 'edits' : 'generations'),{method:'POST',headers,body,signal,redirect:'error'});
    if (!response.ok) throw new Error(response.status === 400 ? 'image_request_rejected' : response.status === 429 ? 'image_provider_limit' : 'image_provider_error');
    const result = JSON.parse(new TextDecoder().decode(await boundedBytes(response,18*1024*1024)));
    const base64 = result?.data?.[0]?.b64_json;
    if (typeof base64 !== 'string' || base64.length > MAX_OUTPUT*4/3+4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('invalid_provider_output');
    const bytes = Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
    if (bytes.length > MAX_OUTPUT || !imageSignature(bytes,MIME[row.output_format])) throw new Error('invalid_provider_output');
    outputKey = `images/${row.user_id}/${row.id}/output.${row.output_format}`;
    await env.IMAGE_FILES.put(outputKey,bytes,{httpMetadata:{contentType:MIME[row.output_format]}});
    // Persist measured token counts only; never provider error bodies, prompts in logs, or keys.
    const usage = {};
    for (const key of ['input_tokens','output_tokens','total_tokens']) if (Number.isSafeInteger(result.usage?.[key]) && result.usage[key]>=0) usage[key]=result.usage[key];
    const updated = await env.DB.prepare("UPDATE image_jobs SET status='completed', output_key=?, output_bytes=?, usage_json=?, updated_at=? WHERE id=? AND status='processing'")
      .bind(outputKey,bytes.length,JSON.stringify(usage),nowSeconds(),id).run();
    if (!updated.meta?.changes) {
      await env.IMAGE_FILES.delete(outputKey);
      throw new Error('image_completion_unverifiable');
    }
    await settlePilotCall(env);
  } catch (error) {
    const persisted = await env.DB.prepare('SELECT status FROM image_jobs WHERE id=?').bind(id).first();
    if (persisted?.status === 'completed') return; // successful output exists; leftover unsettled marker safely pauses further calls
    const allowed = ['images_unavailable','image_pilot_suspended','source_unavailable','image_request_rejected','image_provider_limit','image_provider_error','invalid_provider_output','provider_output_too_large'];
    // Confirmed 400/429 rejections are not completed image generations; every
    // other post-dispatch failure is conservatively treated as billing-unknown.
    // Customer credit refund policy is unchanged; no automatic paid retry.
    const definitelyRejected = ['image_request_rejected','image_provider_limit'].includes(error?.message);
    const code = providerAttempted && !definitelyRejected
      ? BILLING_UNVERIFIED
      : allowed.includes(error?.message) ? error.message : 'image_processing_failed';
    if (providerAttempted) {
      // Independent of image_jobs: if the user deleted their account during
      // provider execution, an uncertain charge still freezes the whole pilot.
      if (definitelyRejected) await settlePilotCall(env);
      else await holdPilotBilling(env);
    }
    await failJob(env,id,code);
    if (outputKey) await env.IMAGE_FILES.delete(outputKey);
  } finally {
    if (row.source_key) {
      await env.IMAGE_FILES.delete(row.source_key);
      await env.DB.prepare('UPDATE image_jobs SET source_key=NULL WHERE id=?').bind(id).run();
    }
  }
}

export async function consumeImageQueue(batch,env) {
  for (const message of batch.messages) {
    try { await processImageJob(env,message.body?.id); message.ack(); }
    catch { message.retry({delaySeconds:60}); } // storage/admission failures only; claimed jobs never call provider again
  }
}
export async function cleanupImageJobs(env) {
  if (!env.DB || !env.IMAGE_FILES || env.BOR_IMAGES_ENABLED !== 'true') return;
  const now = nowSeconds();
  const rows = await env.DB.prepare("SELECT * FROM image_jobs WHERE (expires_at<=? AND status!='expired') OR (status IN ('queued','processing') AND updated_at<?) OR (status='failed' AND source_key IS NOT NULL) ORDER BY updated_at LIMIT 100").bind(now,now-900).all();
  for (const row of rows.results || []) {
    if (row.status === 'processing') await failJob(env,row.id,BILLING_UNVERIFIED);
    else if (row.status === 'queued') await failJob(env,row.id,'processing_interrupted');
    await env.IMAGE_FILES.delete([row.source_key,row.output_key].filter(Boolean));
    await env.DB.prepare('UPDATE image_jobs SET source_key=NULL WHERE id=?').bind(row.id).run();
    if (row.expires_at <= now) await env.DB.prepare("UPDATE image_jobs SET status='expired', prompt='', source_key=NULL, output_key=NULL, usage_json=NULL, updated_at=? WHERE id=?").bind(now,row.id).run();
  }
}
