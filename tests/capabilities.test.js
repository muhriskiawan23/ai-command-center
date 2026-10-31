// Pernyataan kemampuan nyata harus ikut ke SETIAP agent, agar model tidak mengaku bisa browsing / berita / file.
import test from "node:test";
import assert from "node:assert/strict";
import { startHarness } from "./e2e/harness.js";

test("setiap mode agent menerima pernyataan kemampuan nyata di system prompt", async () => {
  const app = await startHarness();
  const agents = (await (await fetch(app.url + "/api/agents")).json()).agents.map((a) => a.id);
  assert.ok(agents.length >= 9, `hanya ${agents.length} agent terdaftar`);
  for (const agent of agents) {
    app.aiCalls.length = 0;
    const res = await fetch(app.url + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json", Origin: app.url }, body: JSON.stringify({ message: "Apa yang bisa kamu lakukan?", agent }) });
    assert.equal(res.status, 200, `agent ${agent} gagal: ${res.status}`);
    assert.ok(app.aiCalls.length >= 1);
    for (const call of app.aiCalls) {
      const system = call.messages.find((m) => m.role === "system").content;
      assert.match(system, /CANNOT open links or URLs/, `agent ${agent} tidak membawa pernyataan kemampuan`);
      assert.match(system, /never present information as current/i);
    }
  }
  await app.close();
});
