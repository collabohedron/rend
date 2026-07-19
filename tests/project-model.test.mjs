import assert from "node:assert/strict";
import test from "node:test";

import { addNote, addSection, anchorOutputState, curatedStream, moveSection, removeNote, setMessageIncluded, toMarkdown } from "../document.mjs";
import {
  createProject,
  deriveProjectDisplayTitle,
  projectFilename,
  projectFromContainer,
  serializeEditorialOverlay,
  updateDocumentHeader,
  validateEditorialOverlay,
  validateProject,
} from "../project-model.mjs";

const documentModel = {
  id: "conversation-1",
  title: "Imported title",
  messages: [
    { id: "m1", author: "user", markdown: "Hello", attachments: [], citations: [], content_references: [] },
    { id: "m2", author: "assistant", markdown: "World", attachments: [], citations: [], content_references: [] },
  ],
};

function dependencies() {
  let next = 0;
  return {
    uuid: () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`,
    now: () => "2026-07-18T00:00:00.000Z",
    hashMessage: async (message) => `sha256:${message.id.padEnd(64, "0")}`,
  };
}

test("new projects keep the normalized transcript immutable and persist no default message state", async () => {
  const project = await createProject(documentModel, { sourceUrl: "https://chatgpt.com/share/example" }, dependencies());
  assert.ok(Object.isFrozen(project.transcript.document));
  assert.ok(Object.isFrozen(project.transcript.document.messages[0]));
  assert.equal(project.editorial.messageBindings.length, 2);
  assert.deepEqual(project.editorial.messageBindings.map((binding) => binding.included), [true, true]);
  assert.deepEqual(serializeEditorialOverlay(project), {
    schema: "rend-editorial", schemaVersion: 1, documentHeader: "Imported title", messageEdits: [], sections: [],
  });
  setMessageIncluded(project, project.editorial.messageBindings[0].id, false);
  addNote(project, project.editorial.messageBindings[0].id, "A note");
  assert.deepEqual(serializeEditorialOverlay(project).messageEdits, [{
    messageIndex: 0,
    included: false,
    note: { id: project.editorial.messageBindings[0].note.id, text: "A note" },
  }]);
  setMessageIncluded(project, project.editorial.messageBindings[0].id, true);
  removeNote(project, project.editorial.messageBindings[0].id);
  assert.deepEqual(serializeEditorialOverlay(project).messageEdits, []);
  assert.equal(project.transcript.document.messages[0].markdown, "Hello");
});

test("the document header is initialized independently from the immutable imported title", async () => {
  const project = await createProject(documentModel, {}, dependencies());
  assert.equal(deriveProjectDisplayTitle(project), "Imported title");
  updateDocumentHeader(project, "Editorial title");
  addSection(project, project.editorial.messageBindings[0].id, "Leading anchor");
  assert.equal(deriveProjectDisplayTitle(project), "Editorial title");
  assert.equal(projectFilename(project), "Editorial title.rend");
  assert.equal(project.transcript.document.title, "Imported title");
  assert.match(toMarkdown(project), /^# Editorial title\n/);
  moveSection(project, project.editorial.nodes[0].id, "down");
  assert.equal(deriveProjectDisplayTitle(project), "Editorial title");
});

test("document headers reject blank committed values and project filenames are portable", async () => {
  const project = await createProject(documentModel, {}, dependencies());
  assert.throws(() => updateDocumentHeader(project, ""), /cannot be empty/);
  assert.throws(() => updateDocumentHeader(project, "   "), /cannot be empty/);
  assert.equal(project.editorial.documentHeader, "Imported title");
  updateDocumentHeader(project, "CON");
  assert.equal(projectFilename(project), "_CON.rend");
});

test("a note on an otherwise untouched message persists without default inclusion state", async () => {
  const project = await createProject(documentModel, {}, dependencies());
  const binding = project.editorial.messageBindings[1];
  addNote(project, binding.id, "Only a note");
  assert.deepEqual(serializeEditorialOverlay(project).messageEdits, [{
    messageIndex: 1,
    note: { id: binding.note.id, text: "Only a note" },
  }]);
});

test("container components round-trip into a validated project", async () => {
  const project = await createProject(documentModel, {}, dependencies());
  const firstBinding = project.editorial.messageBindings[0].id;
  setMessageIncluded(project, firstBinding, false);
  addNote(project, firstBinding, "Persisted note");
  updateDocumentHeader(project, "Persisted header");
  addSection(project, project.editorial.messageBindings[1].id, "Persisted section");
  const loaded = projectFromContainer({
    manifest: {
      format: "rend-project", manifestVersion: 1, projectId: project.id,
      createdAt: project.createdAt, savedAt: "2026-07-18T01:00:00.000Z", saveGeneration: 1,
    },
    transcript: project.transcript,
    editorial: serializeEditorialOverlay(project),
  });
  assert.equal(validateProject(loaded), loaded);
  assert.equal(loaded.editorial.nodes.length, 3);
  assert.equal(loaded.editorial.messageBindings[0].included, false);
  assert.equal(loaded.editorial.messageBindings[0].note.text, "Persisted note");
  assert.equal(loaded.editorial.documentHeader, "Persisted header");
  assert.equal(loaded.editorial.nodes[1].text, "Persisted section");
  assert.equal("included" in loaded.editorial.nodes[1], false);
  assert.equal(anchorOutputState(loaded, loaded.editorial.nodes[1].id).included, true);
  assert.ok(Object.isFrozen(loaded.transcript.document));
});

test("section positions round-trip without serializing transcript message order", async () => {
  const project = await createProject(documentModel, {}, dependencies());
  const secondBinding = project.editorial.messageBindings[1].id;
  const section = addSection(project, secondBinding, "Boundary");
  moveSection(project, section.id, "down");
  const overlay = serializeEditorialOverlay(project);
  assert.deepEqual(overlay.sections, [{ id: section.id, text: "Boundary", beforeMessageIndex: 2 }]);
  assert.equal("nodes" in overlay, false);
  assert.equal("messageBindings" in overlay, false);
  const loaded = projectFromContainer({
    manifest: {
      format: "rend-project", manifestVersion: 1, projectId: project.id,
      createdAt: project.createdAt, savedAt: "2026-07-18T01:00:00.000Z", saveGeneration: 1,
    },
    transcript: project.transcript,
    editorial: overlay,
  });
  assert.deepEqual(curatedStream(loaded, { includeOmitted: true }).map((node) => node.kind), ["message", "message", "section"]);
});

test("sparse overlay validation rejects redundant default state", () => {
  assert.throws(() => validateEditorialOverlay({
    schema: "rend-editorial", schemaVersion: 1, documentHeader: "Title",
    messageEdits: [{ messageIndex: 0, included: true }], sections: [],
  }, documentModel), /only omitted messages/);
  assert.throws(() => validateEditorialOverlay({
    schema: "rend-editorial", schemaVersion: 1, documentHeader: "Title",
    messageEdits: [{ messageIndex: 0 }], sections: [],
  }, documentModel), /no non-default state/);
});
