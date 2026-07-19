import assert from "node:assert/strict";
import test from "node:test";

import { addNote, addSection, setMessageIncluded, toMarkdown } from "../document.mjs";
import { createProject, projectFromContainer, serializeEditorialOverlay, updateDocumentHeader } from "../project-model.mjs";
import {
  canonicalMessageContent,
  compareTranscripts,
  hashMessageContent,
  importTranscriptForWorkspace,
  retrieveShareTranscript,
} from "../transcript-import.mjs";

const originalDocument = {
  id: "conversation-1", title: "Original",
  messages: [
    { id: "m1", author: "user", markdown: "Hello\r\nworld", order: 0, attachments: [], citations: [], content_references: [] },
    { id: "m2", author: "assistant", markdown: "Answer", order: 1, attachments: [{ filename: "a.png", mime_type: "image/png", size_bytes: 42, width: 10, height: 20, id: "old-file", reference: "old-ref" }], citations: [], content_references: [] },
  ],
};

function dependencies() {
  let next = 0;
  return {
    uuid: () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`,
    now: () => "2026-07-19T00:00:00.000Z",
  };
}

function matchingCandidate() {
  const candidate = structuredClone(originalDocument);
  candidate.id = "conversation-new-snapshot";
  candidate.title = "Updated OpenAI title";
  candidate.messages[0].id = "new-m1";
  candidate.messages[0].markdown = "Hello\nworld";
  candidate.messages[0].created_at = 999;
  candidate.messages[1].id = "new-m2";
  candidate.messages[1].model = "volatile-model";
  candidate.messages[1].attachments[0].id = "new-file";
  candidate.messages[1].attachments[0].reference = "new-ref";
  return candidate;
}

function containerComponents(project) {
  return {
    manifest: {
      format: "rend-project", manifestVersion: 1, projectId: project.id,
      createdAt: project.createdAt, savedAt: "2026-07-19T01:00:00.000Z", saveGeneration: 1,
    },
    transcript: project.transcript,
    editorial: serializeEditorialOverlay(project),
  };
}

test("canonical message hashes use only the specified normalized visible fields", async () => {
  const message = { author: "user", markdown: "Hello\r\nworld", attachments: [{ filename: "a.png", mime_type: "image/png", size_bytes: 42, width: 10, height: 20 }] };
  assert.deepEqual(canonicalMessageContent(message), [
    "rend-message-content", 1, "user", "Hello\nworld", [["a.png", "image/png", 42, 10, 20]],
  ]);
  assert.equal(await hashMessageContent(message), "05507d75d73bc7dfad6d572abcb5194191e14f13287de4aea0c40f9e6b65776d");
});

test("an identical ordered hash sequence refreshes transcript and preserves all editorial state", async () => {
  const deps = dependencies();
  const project = createProject(originalDocument, { sourceUrl: "https://chatgpt.com/share/old" }, deps);
  const bindingIds = project.editorial.messageBindings.map((binding) => binding.id);
  updateDocumentHeader(project, "Editorial document title");
  setMessageIncluded(project, bindingIds[0], false);
  addNote(project, bindingIds[1], "Keep this note");
  const section = addSection(project, bindingIds[1], "Keep this anchor");
  const result = await importTranscriptForWorkspace(project, matchingCandidate(), { sourceUrl: "https://chatgpt.com/share/new" }, deps);
  assert.equal(result.outcome, "matching-transcript");
  assert.equal(result.comparison, "exact");
  assert.equal(result.appendedMessageCount, 0);
  assert.equal(result.project, project);
  assert.equal(result.transcriptChanged, true);
  assert.equal(project.editorial.documentHeader, "Editorial document title");
  assert.deepEqual(project.editorial.messageBindings.map((binding) => binding.id), bindingIds);
  assert.deepEqual(project.editorial.messageBindings.map((binding) => binding.sourceMessageId), ["new-m1", "new-m2"]);
  assert.equal(project.editorial.messageBindings[0].included, false);
  assert.equal(project.editorial.messageBindings[1].note.text, "Keep this note");
  assert.ok(project.editorial.nodes.some((node) => node.id === section.id));
  assert.equal(project.transcript.provenance.sourceUrl, "https://chatgpt.com/share/new");
  assert.ok(Object.isFrozen(project.transcript.document));

  const markdown = toMarkdown(project);
  const reopened = projectFromContainer(containerComponents(project), deps);
  assert.equal(toMarkdown(reopened), markdown);
  assert.equal(reopened.transcript.document.messages[0].id, "new-m1");
});

test("an unchanged transcript and source URL do not create transcript dirtiness", async () => {
  const deps = dependencies();
  const project = createProject(originalDocument, { sourceUrl: "https://chatgpt.com/share/same" }, deps);
  const before = project.transcript;
  const result = await importTranscriptForWorkspace(project, structuredClone(originalDocument), { sourceUrl: "https://chatgpt.com/share/same" }, deps);
  assert.equal(result.outcome, "matching-transcript");
  assert.equal(result.comparison, "exact");
  assert.equal(result.transcriptChanged, false);
  assert.equal(project.transcript, before);
});

test("an exact ordered prefix extends the transcript and preserves existing editorial state", async () => {
  const deps = dependencies();
  const project = createProject(originalDocument, { sourceUrl: "https://chatgpt.com/share/old" }, deps);
  const existingBindingIds = project.editorial.messageBindings.map((binding) => binding.id);
  updateDocumentHeader(project, "Curated continuation");
  setMessageIncluded(project, existingBindingIds[0], false);
  addNote(project, existingBindingIds[1], "Existing note");
  const section = addSection(project, existingBindingIds[1], "Existing anchor");
  const candidate = matchingCandidate();
  candidate.messages.push(
    { id: "m3", author: "user", markdown: "New question", order: 2, attachments: [], citations: [], content_references: [] },
    { id: "m4", author: "assistant", markdown: "New answer", order: 3, attachments: [], citations: [], content_references: [] },
  );

  const result = await importTranscriptForWorkspace(project, candidate, { sourceUrl: "https://chatgpt.com/share/continued" }, deps);
  assert.equal(result.outcome, "matching-transcript");
  assert.equal(result.comparison, "prefix");
  assert.equal(result.appendedMessageCount, 2);
  assert.equal(result.project, project);
  assert.equal(project.editorial.documentHeader, "Curated continuation");
  assert.deepEqual(project.editorial.messageBindings.slice(0, 2).map((binding) => binding.id), existingBindingIds);
  assert.equal(project.editorial.messageBindings[0].included, false);
  assert.equal(project.editorial.messageBindings[1].note.text, "Existing note");
  assert.ok(project.editorial.nodes.some((node) => node.id === section.id));
  assert.deepEqual(project.editorial.messageBindings.slice(2).map((binding) => ({
    sourceMessageId: binding.sourceMessageId, included: binding.included, note: binding.note,
  })), [
    { sourceMessageId: "m3", included: true, note: null },
    { sourceMessageId: "m4", included: true, note: null },
  ]);
  assert.match(toMarkdown(project), /## USER\n\nNew question[\s\S]*## ASSISTANT\n\nNew answer/);

  const reopened = projectFromContainer(containerComponents(project), deps);
  assert.equal(toMarkdown(reopened), toMarkdown(project));
  assert.deepEqual(reopened.transcript.document.messages.map((message) => message.id), ["new-m1", "new-m2", "m3", "m4"]);
  assert.deepEqual(reopened.editorial.messageBindings.map((binding) => binding.included), [false, true, true, true]);
  assert.equal(reopened.editorial.messageBindings[1].note.text, "Existing note");
});

test("a different transcript creates an independent unsaved project without editorial transfer", async () => {
  const deps = dependencies();
  const project = createProject(originalDocument, {}, deps);
  updateDocumentHeader(project, "Private editorial title");
  addNote(project, project.editorial.messageBindings[0].id, "Original note");
  const before = structuredClone(project);
  const different = structuredClone(originalDocument);
  different.messages[1].markdown = "Changed answer";
  const result = await importTranscriptForWorkspace(project, different, { sourceUrl: "https://chatgpt.com/share/different" }, deps);
  assert.equal(result.outcome, "different-transcript");
  assert.notEqual(result.project, project);
  assert.deepEqual(project, before);
  assert.equal(result.project.editorial.documentHeader, "Original");
  assert.equal(result.project.editorial.messageBindings.every((binding) => binding.note === null), true);
  const reopened = projectFromContainer(containerComponents(result.project), deps);
  assert.equal(toMarkdown(reopened), toMarkdown(result.project));
});

test("a longer non-prefix import remains a different transcript", async () => {
  const deps = dependencies();
  const project = createProject(originalDocument, {}, deps);
  addNote(project, project.editorial.messageBindings[0].id, "Must remain here");
  const before = structuredClone(project);
  const candidate = structuredClone(originalDocument);
  candidate.messages.splice(1, 0, {
    id: "inserted", author: "assistant", markdown: "Inserted in the middle", order: 1,
    attachments: [], citations: [], content_references: [],
  });
  const result = await importTranscriptForWorkspace(project, candidate, {}, deps);
  assert.equal(result.outcome, "different-transcript");
  assert.deepEqual(project, before);
  assert.equal(result.project.editorial.messageBindings.every((binding) => binding.note === null), true);
});

test("duplicate message content remains deterministic under ordered comparison", async () => {
  const duplicated = structuredClone(originalDocument);
  duplicated.messages = [structuredClone(duplicated.messages[0]), structuredClone(duplicated.messages[0])];
  duplicated.messages[1].id = "duplicate";
  assert.equal(await compareTranscripts(duplicated, structuredClone(duplicated)), "exact");
  const changed = structuredClone(duplicated);
  changed.messages[1].markdown = "not duplicate";
  assert.equal(await compareTranscripts(duplicated, changed), "mismatch");
});

test("ordered-prefix comparison reuses canonical hashing without hashing appended messages", async () => {
  const candidate = matchingCandidate();
  candidate.messages.push({ id: "m3", author: "user", markdown: "Append", order: 2, attachments: [], citations: [], content_references: [] });
  let hashes = 0;
  const comparison = await compareTranscripts(originalDocument, candidate, {
    hashMessage: async (message) => { hashes += 1; return JSON.stringify(canonicalMessageContent(message)); },
  });
  assert.equal(comparison, "prefix");
  assert.equal(hashes, originalDocument.messages.length * 2);
});

test("retrieval, parsing, and validation failures reject before project mutation", async () => {
  const project = createProject(originalDocument, {}, dependencies());
  const before = structuredClone(project);
  await assert.rejects(retrieveShareTranscript("url", async () => { throw new Error("network down"); }), /network down/);
  await assert.rejects(retrieveShareTranscript("url", async () => ({ ok: true, async json() { throw new SyntaxError("bad json"); } })), /could not be parsed/);
  await assert.rejects(retrieveShareTranscript("url", async () => ({ ok: false, async json() { return { error: "unsupported Share page" }; } })), /unsupported Share page/);
  await assert.rejects(importTranscriptForWorkspace(project, { title: "bad", messages: [] }, {}, dependencies()), /invalid/);
  assert.deepEqual(project, before);
});
