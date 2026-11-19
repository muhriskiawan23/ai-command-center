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
  const enabled = env.BOR_IMAGES_ENABLED === 'true' && Boolean(env.OPENAI_API_KEY && env.DB && env.IMAGE_FILES && env.IMAGE_QUEUE && generate && edit && version);
  return { enabled, credits: { generate, edit }, tariffVersion: version || null, formats: Object.keys(MIME), sizes: ['1024x1024','1024x1536','1536x1024'], retentionDays: 7, provider: 'OpenAI', enhancement: 'generative' };
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
  return { id: row.id, type: 'image_result', mode: row.mode, prompt: row.prompt, status: row.status === 'completed' && !completed ? 'expired' : row.status,
    jobStatus: row.status, credits: row.credits, tariffVersion: row.tariff_version, createdAt: row.created_at, expiresAt: row.expires_at,
    errorCode: row.error_code || null,
    files: completed ? [{ id: row.id, name: `bor-ai-${row.id}.${row.output_format}`, mimeType: MIME[row.output_format], size: row.output_bytes,
      previewUrl: `/api/files/${row.id}/preview`, downloadUrl: `/api/files/${row.id}/download` }] : [] };
}
const findJob = (env,id,userId) => env.DB.prepare('SELECT * FROM image_jobs WHERE id = ? AND user_id = ?').bind(id,userId).first();
async function failJob(env,id,code) {
  await env.DB.prepare("UPDATE image_jobs SET status='failed', error_code=?, updated_at=? WHERE id=? AND status IN ('queued','processing')").bind(code,nowSeconds(),id).run();
}

// All state-changing routes require a real session and a same-origin request.
export async function handleImageRoute(request, env, url, deps) {
  if (url.pathname === '/api/images/config' && request.method === 'GET') return json(imageConfig(env));
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
    const rows = await env.DB.prepare("SELECT * FROM image_jobs WHERE user_id=? AND status!='expired' ORDER BY created_at DESC LIMIT 50").bind(user.id).all();
    const wallet = await env.DB.prepare('SELECT balance FROM image_wallets WHERE user_id=?').bind(user.id).first();
    return json({ jobs: (rows.results || []).map(publicJob), balance: wallet?.balance || 0 });
  }
  if (jobMatch || fileMatch) {
    const id = (jobMatch || fileMatch)[1];
    const row = await findJob(env,id,user.id);
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
  const fingerprint = await sha256Hex(JSON.stringify([mode,prompt,format,size,body.sourceImage || '',body.sourceJobId || '']));
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
  if (source) await env.IMAGE_FILES.put(key,source.bytes,{httpMetadata:{contentType:source.mime}});
  let inserted;
  try {
    // Atomic admission + triggers: per-account/global daily caps and credit reservation.
    inserted = await env.DB.prepare(`INSERT INTO image_jobs
      (id,user_id,request_id,request_hash,mode,prompt,model,output_format,size,status,source_key,source_mime,credits,tariff_version,created_at,updated_at,expires_at)
      SELECT ?,?,?,?,?,?,?,?,?,'queued',?,?,?,?,?,?,?
      WHERE (SELECT COUNT(*) FROM image_jobs WHERE created_at>=? AND user_id=?) < ?
        AND (SELECT COUNT(*) FROM image_jobs WHERE created_at>=?) < ?`)
      .bind(id,user.id,requestId,fingerprint,mode,prompt,env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-sunburst',format,size,key,source?.mime || null,config.credits[mode],config.tariffVersion,now,now,now+RETENTION,
        now-now%86400,user.id,positive(env.IMAGE_DAILY_LIMIT_USER)||3,now-now%86400,positive(env.IMAGE_DAILY_LIMIT_GLOBAL)||20).run();
  } catch (error) {
    const replay = await env.DB.prepare('SELECT * FROM image_jobs WHERE user_id=? AND request_id=?').bind(user.id,requestId).first();
    if (key && replay?.id !== id) await env.IMAGE_FILES.delete(key);
    if (replay) return replay.request_hash === fingerprint ? json(publicJob(replay)) : json({error:'Request ID telah digunakan.'},409);
    if (String(error?.message).includes('image_insufficient_credits')) return json({error:'Kredit gambar tidak cukup. Isi kredit melalui pengelola BOR AI.',code:'image_insufficient_credits'},402);
    throw error;
  }
  if (!inserted.meta?.changes) {
    if (key) await env.IMAGE_FILES.delete(key);
    return json({error:'Batas harian gambar tercapai. Coba lagi besok.',code:'image_daily_limit'},429);
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
  try {
    if (!imageConfig(env).enabled) throw new Error('images_unavailable');
    const options = {model:row.model,prompt:row.prompt,n:1,quality:'medium',size:row.size,output_format:row.output_format,safety_identifier:await sha256Hex('bor-image:'+row.user_id)};
    let body, headers = {Authorization:'Bearer '+env.OPENAI_API_KEY};
    if (row.mode === 'edit') {
      const source = await env.IMAGE_FILES.get(row.source_key);
      if (!source) throw new Error('source_unavailable');
      body = new FormData();
      for (const [key,value] of Object.entries(options)) body.set(key,String(value));
      body.set('image',new Blob([await source.arrayBuffer()],{type:row.source_mime}),'source.'+(row.source_mime.split('/')[1]));
    } else { body = JSON.stringify(options); headers['Content-Type']='application/json'; }
    const signal = AbortSignal.timeout(150_000);
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
    if (!updated.meta?.changes) await env.IMAGE_FILES.delete(outputKey);
  } catch (error) {
    const persisted = await env.DB.prepare('SELECT status FROM image_jobs WHERE id=?').bind(id).first();
    if (persisted?.status === 'completed') return; // completion may commit even if its acknowledgement was lost
    const allowed = ['images_unavailable','source_unavailable','image_request_rejected','image_provider_limit','image_provider_error','invalid_provider_output','provider_output_too_large'];
    const code = allowed.includes(error?.message) ? error.message : 'image_processing_failed';
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
    if (['queued','processing'].includes(row.status)) await failJob(env,row.id,'processing_interrupted');
    await env.IMAGE_FILES.delete([row.source_key,row.output_key].filter(Boolean));
    await env.DB.prepare('UPDATE image_jobs SET source_key=NULL WHERE id=?').bind(row.id).run();
    if (row.expires_at <= now) await env.DB.prepare("UPDATE image_jobs SET status='expired', prompt='', source_key=NULL, output_key=NULL, usage_json=NULL, updated_at=? WHERE id=?").bind(now,row.id).run();
  }
}
