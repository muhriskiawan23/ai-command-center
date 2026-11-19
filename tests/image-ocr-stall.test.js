import test from "node:test";
import assert from "node:assert/strict";
import { parseImageOcrLocally } from "../public/image-ocr.js";

const file = { name: "picture.jpg", type: "image/jpeg", size: 256 };

test("image OCR uses smaller language models and returns bounded text", async () => {
  let options;
  let terminated = false;
  const progress = [];
  const result = await parseImageOcrLocally(file, {
    createWorker: async (languages, mode, opts) => {
      assert.equal(languages, "eng+ind");
      assert.equal(mode, 1);
      options = opts;
      return {
        recognize: async () => ({ data: { text: "  Halo dari gambar  " } }),
        terminate: async () => { terminated = true; }
      };
    },
    onProgress: stage => progress.push(stage)
  });
  assert.equal(options.langPath, "https://tessdata.projectnaptha.com/4.0.0_fast");
  assert.equal(result.kind, "image-ocr");
  assert.equal(result.content, "Halo dari gambar");
  assert.equal(terminated, true);
  assert.ok(progress.some(stage => stage.includes("model OCR")));
});

test("image OCR stops waiting when worker initialization hangs", async () => {
  await assert.rejects(
    parseImageOcrLocally(file, {
      createWorker: () => new Promise(() => {}),
      initTimeoutMs: 25
    }),
    /Persiapan OCR terlalu lama/
  );
});

test("image OCR stops waiting and terminates worker when recognize hangs", async () => {
  let terminated = false;
  await assert.rejects(
    parseImageOcrLocally(file, {
      createWorker: async () => ({
        recognize: () => new Promise(() => {}),
        terminate: async () => { terminated = true; }
      }),
      recognitionTimeoutMs: 25
    }),
    /Pembacaan gambar terlalu lama/
  );
  assert.equal(terminated, true);
});

test("image OCR surfaces asynchronous worker errors", async () => {
  await assert.rejects(
    parseImageOcrLocally(file, {
      createWorker: (_, __, opts) => {
        queueMicrotask(() => opts.errorHandler(new Error("network error")));
        return new Promise(() => {});
      },
      initTimeoutMs: 500
    }),
    /Gagal memuat mesin OCR/
  );
});

test("image OCR shows meaningful status for zero progress", async () => {
  let emitted = "";
  await parseImageOcrLocally(file, {
    createWorker: async (_, __, opts) => {
      opts.logger({ status: "loading language traineddata", progress: 0 });
      return {
        recognize: async () => ({ data: { text: "Text visible" } }),
        terminate: async () => {}
      };
    },
    onProgress: stage => { emitted = stage; }
  });
  assert.notMatch(emitted, /0%/);
});
