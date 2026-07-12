import assert from "node:assert/strict";
import test from "node:test";

import { saveMarkdown } from "../save-markdown.mjs";

function downloadEnvironment() {
  const clicks = [];
  const revoked = [];
  return {
    clicks,
    revoked,
    windowObject: {
      URL: {
        createObjectURL: () => "blob:test",
        revokeObjectURL: (url) => revoked.push(url),
      },
    },
    documentObject: {
      createElement: () => ({ click() { clicks.push({ href: this.href, download: this.download }); } }),
    },
  };
}

test("File System Access API writes and remembers only a successful handle", async () => {
  const writes = [];
  const stored = [];
  const handle = {
    async createWritable() {
      return { async write(value) { writes.push(value); }, async close() { writes.push("closed"); } };
    },
  };
  const handleStore = { async get() { return null; }, async set(value) { stored.push(value); } };
  const windowObject = { async showSaveFilePicker(options) { assert.equal(options.suggestedName, "Transcript.md"); return handle; } };
  const result = await saveMarkdown({ markdown: "# Transcript\n", filename: "Transcript.md", windowObject, documentObject: {}, handleStore });
  assert.deepEqual(result, { method: "file-system" });
  assert.deepEqual(writes, ["# Transcript\n", "closed"]);
  assert.deepEqual(stored, [handle]);
});

test("last successful handle is reused as the next picker start location", async () => {
  const previous = { name: "previous.md" };
  const next = { async createWritable() { return { async write() {}, async close() {} }; } };
  let receivedOptions;
  const handleStore = { async get() { return previous; }, async set() {} };
  const windowObject = { async showSaveFilePicker(options) { receivedOptions = options; return next; } };
  await saveMarkdown({ markdown: "text", filename: "Next.md", windowObject, documentObject: {}, handleStore });
  assert.equal(receivedOptions.startIn, previous);
  assert.equal(receivedOptions.id, "conversation-viewer-markdown");
});

test("handle-storage failure does not duplicate a successful file save", async () => {
  const handle = { async createWritable() { return { async write() {}, async close() {} }; } };
  const environment = downloadEnvironment();
  environment.windowObject.showSaveFilePicker = async () => handle;
  const handleStore = { async get() { return null; }, async set() { throw new Error("storage unavailable"); } };
  const result = await saveMarkdown({ markdown: "text", filename: "Title.md", ...environment, handleStore });
  assert.deepEqual(result, { method: "file-system" });
  assert.equal(environment.clicks.length, 0);
});

test("unsupported API falls back to a title-derived download", async () => {
  const environment = downloadEnvironment();
  const result = await saveMarkdown({ markdown: "text", filename: "Title.md", ...environment, handleStore: null });
  assert.deepEqual(result, { method: "download" });
  assert.deepEqual(environment.clicks, [{ href: "blob:test", download: "Title.md" }]);
  assert.deepEqual(environment.revoked, ["blob:test"]);
});

test("permission failure falls back but picker cancellation does not download", async () => {
  const denied = downloadEnvironment();
  denied.windowObject.showSaveFilePicker = async () => { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); };
  assert.deepEqual(await saveMarkdown({ markdown: "text", filename: "Title.md", ...denied, handleStore: null }), { method: "download" });
  assert.equal(denied.clicks.length, 1);

  const cancelled = downloadEnvironment();
  cancelled.windowObject.showSaveFilePicker = async () => { throw Object.assign(new Error("cancelled"), { name: "AbortError" }); };
  assert.deepEqual(await saveMarkdown({ markdown: "text", filename: "Title.md", ...cancelled, handleStore: null }), { method: "cancelled" });
  assert.equal(cancelled.clicks.length, 0);
});
