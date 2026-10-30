import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

function request(path, init) {
  return new Request(`https://example.test${path}`, init);
}

function chat(message, agent = "coordinator") {
  return request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, agent })
  });
}

test("complex coordinator request completes the multi-agent workflow", async () => {
  const calls = [];
  const mockEnv = {
    AI: {
      async run(model, options) {
        calls.push({ model, options });
        return {
          response: "Analisis ini mempertimbangkan tujuan, batasan, risiko, dan langkah konkret.\nRekomendasi utama adalah memvalidasi asumsi terlebih dahulu, mengukur hasil, lalu memperbaiki pendekatan berdasarkan data yang terkumpul."
        };
      }
    },
    ASSETS: { async fetch() { return new Response("asset"); } }
  };

  const res = await worker.fetch(
    chat("Buat analisis risiko dan strategi untuk bisnis saya."),
    mockEnv
  );
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.workflow, "multi-agent");
  assert.equal(data.agent, "Coordinator");
  assert.ok(data.response.length >= 100);
  assert.deepEqual(data.agentsUsed, [
    "Researcher",
    "Analyst",
    "Fact Checker",
    "Writer"
  ]);
  assert.equal(calls.length, 4);
  assert.ok(data.steps.every((step) => step.status === "completed"));
});

test("multi-agent workflow returns a sanitized error if a specialist fails", async () => {
  let calls = 0;
  const mockEnv = {
    AI: {
      async run() {
        calls += 1;
        if (calls === 2) throw new Error("sensitive provider error");
        return {
          response: "Analisis ini mempertimbangkan tujuan, batasan, risiko, dan langkah konkret.\nRekomendasi utama adalah memvalidasi asumsi terlebih dahulu, mengukur hasil, lalu memperbaiki pendekatan berdasarkan data yang terkumpul."
        };
      }
    },
    ASSETS: { async fetch() { return new Response("asset"); } }
  };

  const res = await worker.fetch(
    chat("Buat analisis risiko dan strategi untuk bisnis saya."),
    mockEnv
  );
  const data = await res.json();

  assert.equal(res.status, 502);
  assert.equal(data.error, "AI gagal memproses permintaan. Silakan coba lagi beberapa saat.");
  assert.equal(JSON.stringify(data).includes("sensitive provider error"), false);
});

test("GET requests are delegated to the static asset binding", async () => {
  const mockEnv = {
    AI: { async run() { throw new Error("AI should not be called"); } },
    ASSETS: {
      async fetch(req) {
        assert.equal(new URL(req.url).pathname, "/");
        return new Response("<main>AI Command Center</main>", {
          headers: { "Content-Type": "text/html; charset=utf-8" }
        });
      }
    }
  };

  const res = await worker.fetch(request("/"), mockEnv);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /AI Command Center/);
});

test("unknown non-GET endpoints return a JSON 404", async () => {
  const mockEnv = {
    AI: { async run() { throw new Error("AI should not be called"); } },
    ASSETS: { async fetch() { return new Response("asset"); } }
  };

  const res = await worker.fetch(request("/api/not-real", { method: "POST" }), mockEnv);
  assert.equal(res.status, 404);
  assert.match(res.headers.get("Content-Type"), /application\/json/);
});

test("multi-agent workflow retries a final answer that violates an exact numbered-item request", async () => {
  let calls = 0;
  const mockEnv = {
    AI: {
      async run(model, options) {
        calls += 1;
        if (calls === 5) {
          return {
            response: "1. Tentukan tujuan utama, batasan sumber daya, dan hasil yang ingin dicapai secara jelas.\n2. Jalankan langkah prioritas terlebih dahulu, lalu ukur hasilnya menggunakan indikator yang relevan.\n3. Evaluasi hasil berdasarkan data yang terkumpul dan perbaiki pendekatan bila diperlukan."
          };
        }
        return {
          response: "Analisis ini mempertimbangkan tujuan, batasan, risiko, dan langkah konkret.\nRekomendasi utama adalah memvalidasi asumsi terlebih dahulu, mengukur hasil, lalu memperbaiki pendekatan berdasarkan data yang terkumpul."
        };
      }
    },
    ASSETS: { async fetch() { return new Response("asset"); } }
  };

  const res = await worker.fetch(
    chat("Buat analisis risiko dalam tepat 3 poin singkat."),
    mockEnv
  );
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.workflow, "multi-agent");
  assert.equal(calls, 5);
  assert.deepEqual(
    data.response.split("\n").map((line) => Number(line.match(/^\s*(\d+)[.)]/)?.[1])),
    [1, 2, 3]
  );
});

test("multi-agent workflow fails closed when exact numbered-item format remains invalid after repair", async () => {
  let calls = 0;
  const mockEnv = {
    AI: {
      async run() {
        calls += 1;
        return {
          response: "Analisis ini mempertimbangkan tujuan, batasan, risiko, dan langkah konkret.\nRekomendasi utama adalah memvalidasi asumsi terlebih dahulu, mengukur hasil, lalu memperbaiki pendekatan berdasarkan data yang terkumpul."
        };
      }
    },
    ASSETS: { async fetch() { return new Response("asset"); } }
  };

  const res = await worker.fetch(
    chat("Buat analisis risiko dalam tepat 3 poin singkat."),
    mockEnv
  );
  const data = await res.json();

  assert.equal(res.status, 502);
  assert.equal(calls, 5);
  assert.equal(data.error, "AI gagal memproses permintaan. Silakan coba lagi beberapa saat.");
  assert.equal("response" in data, false);
});


test("zero-budget quality gate repairs paid incentives before returning the answer", async () => {
  let calls = 0;
  const mockEnv = {
    AI: {
      async run() {
        calls += 1;
        if (calls === 5) {
          return {
            response: "Berikan voucher diskon dan giveaway untuk menarik pelanggan baru secara cepat. Promosikan hadiah tersebut melalui kampanye media sosial agar semakin banyak orang tertarik datang."
          };
        }
        if (calls === 6) {
          return {
            response: "1. Buat konten organik yang menampilkan menu, suasana, dan informasi usaha secara konsisten tanpa biaya iklan.\n2. Ajak pelanggan memberikan ulasan secara sukarela dan gunakan masukan tersebut untuk memperbaiki pelayanan.\n3. Ukur jangkauan, interaksi, pertanyaan masuk, dan kunjungan pelanggan setiap minggu untuk menilai efektivitas promosi."
          };
        }
        return {
          response: "Analisis ini mempertimbangkan tujuan, batasan, risiko, dan langkah konkret.\nRekomendasi utama adalah memvalidasi asumsi terlebih dahulu, mengukur hasil, lalu memperbaiki pendekatan berdasarkan data yang terkumpul."
        };
      }
    },
    ASSETS: { async fetch() { return new Response("asset"); } }
  };

  const res = await worker.fetch(
    chat("Buat strategi promosi Warkop Boris tanpa biaya."),
    mockEnv
  );
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(calls, 6);
  assert.doesNotMatch(data.response, /voucher|diskon|giveaway|hadiah/i);
});

test("zero-budget quality gate fails closed when incentives remain after repair", async () => {
  let calls = 0;
  const mockEnv = {
    AI: {
      async run() {
        calls += 1;
        const response = calls >= 5
          ? "Berikan voucher diskon dan giveaway untuk menarik pelanggan baru secara cepat. Promosikan hadiah tersebut melalui kampanye media sosial agar semakin banyak orang tertarik datang."
          : "Analisis ini mempertimbangkan tujuan, batasan, risiko, dan langkah konkret.\nRekomendasi utama adalah memvalidasi asumsi terlebih dahulu, mengukur hasil, lalu memperbaiki pendekatan berdasarkan data yang terkumpul.";
        return { response };
      }
    },
    ASSETS: { async fetch() { return new Response("asset"); } }
  };

  const res = await worker.fetch(
    chat("Buat strategi promosi Warkop Boris tanpa biaya."),
    mockEnv
  );
  const data = await res.json();

  assert.equal(res.status, 502);
  assert.equal(calls, 6);
  assert.equal("response" in data, false);
});
