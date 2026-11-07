// Harness uji: menjalankan Worker ASLI (src/index.js) di Node.
//  - D1  : SQLite sungguhan (node:sqlite) memakai file migrations/ yang asli, foreign key aktif.
//  - AI  : stub deterministik. TIDAK memanggil Workers AI, jadi tidak ada biaya.
//  - ASSETS: menyajikan folder public/.
// Hanya untuk pengujian; tidak dipakai di production.
import http from "node:http";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { extname, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import worker from "../../src/index.js";

const ROOT = new URL("../../", import.meta.url).pathname;
const PUBLIC_ROOT = join(ROOT, "public");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };

export function createD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(join(ROOT, "migrations")).sort()) sqlite.exec(readFileSync(join(ROOT, "migrations", file), "utf8"));
  const stmt = (sql, values = []) => ({
    bind: (...v) => stmt(sql, v),
    first: async () => sqlite.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
    run: async () => { const r = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(r.changes) } }; },
    _run: () => sqlite.prepare(sql).run(...values)
  });
  return {
    sqlite,
    prepare: (sql) => stmt(sql),
    batch: async (statements) => { sqlite.exec("BEGIN"); try { statements.forEach((s) => s._run()); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; } return []; }
  };
}

/** Membuat user + sesi langsung di D1 (setara hasil login Google yang sukses) dan mengembalikan token cookie. */
export function seedSession(db, { id, email, name = "Penguji", picture = "" }) {
  const now = Math.floor(Date.now() / 1000);
  db.sqlite.prepare("INSERT OR REPLACE INTO users (id,email,name,picture,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(id, email, name, picture, now, now);
  const token = randomBytes(24).toString("base64url");
  db.sqlite.prepare("INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)").run(createHash("sha256").update(token).digest("hex"), id, now + 3600, now);
  return token;
}
export function seedConversation(db, { id, userId, title, updatedAt, messages = [] }) {
  db.sqlite.prepare("INSERT INTO conversations (id,user_id,title,created_at,updated_at) VALUES (?,?,?,?,?)").run(id, userId, title, updatedAt, updatedAt);
  for (const m of messages) db.sqlite.prepare("INSERT INTO messages (conversation_id,user_id,role,content,created_at) VALUES (?,?,?,?,?)").run(id, userId, m.role, m.content, updatedAt);
}

export async function startHarness({ port = 0, googleClientId = "test-client.apps.googleusercontent.com", aiDelayMs = 0, chatLimit = 0, extraEnv = {} } = {}) {
  const db = createD1();
  const aiCalls = [];
  const control = { aiFail: false, aiText: null, aiHang: false };
  const limiterHits = new Map();
  const env = {
    DB: db,
    ...extraEnv,
    GOOGLE_CLIENT_ID: googleClientId || undefined,
    AI: { async run(_model, options) { if (control.aiFail) throw new Error("AI dimatikan oleh test"); if (control.aiHang) await new Promise(() => {}); aiCalls.push(options); if (aiDelayMs) await new Promise((r) => setTimeout(r, aiDelayMs)); const asked = options.messages.find((m) => m.role === "user")?.content ?? ""; if (control.aiText) return { response: control.aiText };
      return { response: `Balasan uji untuk pesan Anda: "${String(asked).slice(0, 60)}". Ini jawaban deterministik dari stub AI untuk pengujian antarmuka.\nJawaban sengaja dibuat cukup panjang dan berisi kalimat lengkap agar lolos pemeriksaan kualitas agent pada alur multi-agent.` }; } },
    ...(chatLimit ? { CHAT_LIMITER: { async limit({ key }) { const n = (limiterHits.get(key) || 0) + 1; limiterHits.set(key, n); return { success: n <= chatLimit }; } } } : {}),
    ASSETS: {
      async fetch(request) {
        let path = new URL(request.url).pathname;
        if (path === "/") path = "/index.html";
        const file = join(PUBLIC_ROOT, path.replace(/^\/+/, ""));
        if (!file.startsWith(PUBLIC_ROOT + "/") || !existsSync(file)) {
          console.error("[E2E HARNESS] Asset not found:", path, "->", file);
          return new Response("not found", { status: 404 });
        }
        return new Response(readFileSync(file), { headers: { "Content-Type": MIME[extname(file)] || "application/octet-stream" } });
      }
    }
  };
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const base = `http://${req.headers.host}`;
      const loginMatch = /^\\/__test\\/login\\?token=([\\w-]+)$/.exec(req.url);
      if (loginMatch) { res.writeHead(204, { "set-cookie": `__Host-borai_session=${loginMatch[1]}; Path=/; HttpOnly; Secure; SameSite=Lax` }); res.end(); return; }
      const requestController = new AbortController();
      req.on("aborted", () => requestController.abort());
      res.on("close", () => { if (!res.writableEnded) requestController.abort(); });
      const request = new Request(base + req.url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks), signal: requestController.signal });
      const response = await worker.fetch(request, env);
      const headers = {};
      response.headers.forEach((v, k) => { headers[k] = v; });
      const cookies = response.headers.getSetCookie?.() || [];
      if (cookies.length) headers["set-cookie"] = cookies;
      res.writeHead(response.status, headers);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error("[E2E HARNESS] Worker request failed:", req.method, req.url, error?.stack || error);
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      if (!res.writableEnded) res.end("E2E harness request failed");
    }
  });
  await new Promise((r) => server.listen(port, r));
  server.unref();
  const url = `http://localhost:${server.address().port}`;
  return { url, db, env, aiCalls, control, limiterHits, close: () => new Promise((r) => { server.close(r); server.closeAllConnections?.(); }) };
}
