import assert from "node:assert/strict";
import test from "node:test";

import { openProject, saveProject, saveProjectAs } from "../project-file.mjs";
import { createProject, serializeEditorialOverlay } from "../project-model.mjs";
import { createProjectSession, dirtyState } from "../project-session.mjs";

const documentModel = {
  id: "conversation", title: "File fixture",
  messages: [{ id: "m1", author: "user", markdown: "Text", attachments: [], citations: [], content_references: [] }],
};

async function fixtureProject() {
  let next = 0;
  return createProject(documentModel, {}, {
    uuid: () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`,
    now: () => "2026-07-18T00:00:00.000Z",
  });
}

function writableHandle(initial = new ArrayBuffer(0)) {
  let bytes = initial;
  return {
    async getFile() { return { async arrayBuffer() { return bytes; } }; },
    async createWritable() {
      return {
        async write(value) { bytes = value; },
        async close() {},
      };
    },
  };
}

test("Save Project As writes a verified archive, assigns a new project ID, and clears dirty state", async () => {
  const project = await fixtureProject();
  const session = createProjectSession(project);
  const archive = new TextEncoder().encode("rend archive").buffer;
  const handle = writableHandle();
  const oldId = project.id;
  const result = await saveProjectAs(session, {
    windowObject: { async showSaveFilePicker() { return handle; } },
    documentObject: {},
    fetchObject: async () => ({ ok: true, async arrayBuffer() { return archive; } }),
    uuid: () => "00000000-0000-4000-8000-999999999999",
    now: () => "2026-07-18T01:00:00.000Z",
  });
  assert.deepEqual(result, { method: "file-system" });
  assert.notEqual(session.project.id, oldId);
  assert.equal(session.project.saveGeneration, 1);
  assert.equal(dirtyState(session).any, false);
});

test("project packing sends only the sparse editorial overlay", async () => {
  const project = await fixtureProject();
  let request;
  const session = createProjectSession(project);
  const archive = new TextEncoder().encode("rend archive").buffer;
  const handle = writableHandle();
  await saveProjectAs(session, {
    windowObject: { async showSaveFilePicker() { return handle; } }, documentObject: {},
    fetchObject: async (_url, options) => {
      request = JSON.parse(options.body);
      return { ok: true, async arrayBuffer() { return archive; } };
    },
    uuid: () => "00000000-0000-4000-8000-999999999998",
    now: () => "2026-07-18T01:00:00.000Z",
  });
  assert.deepEqual(request.editorial, {
    schema: "rend-editorial", schemaVersion: 1, documentHeader: "File fixture", messageEdits: [],
    sections: [{
      id: "00000000-0000-4000-8000-000000000002",
      text: "End of Document: 2026-07-18T00:00:00.000Z",
      beforeMessageIndex: 1,
    }],
  });
});

test("Save Project refuses to overwrite a file changed outside Rend", async () => {
  const project = await fixtureProject();
  const handle = writableHandle(new TextEncoder().encode("changed").buffer);
  const session = createProjectSession(project, { persisted: true, handle, archiveDigest: "not-the-current-digest" });
  await assert.rejects(
    saveProject(session, { windowObject: {}, documentObject: {}, fetchObject: async () => { throw new Error("must not pack"); } }),
    /changed outside Rend/,
  );
});

test("Open Project validates unpacked components and starts with the selected handle", async () => {
  const project = await fixtureProject();
  const archive = new TextEncoder().encode("archive").buffer;
  const handle = writableHandle(archive);
  const components = {
    manifest: {
      format: "rend-project", manifestVersion: 1, projectId: project.id,
      createdAt: project.createdAt, savedAt: "2026-07-18T01:00:00.000Z", saveGeneration: 1,
    },
    transcript: project.transcript,
    editorial: serializeEditorialOverlay(project),
  };
  const result = await openProject({
    windowObject: { async showOpenFilePicker() { return [handle]; } },
    documentObject: {},
    fetchObject: async () => ({ ok: true, async json() { return components; } }),
  });
  assert.equal(result.method, "opened");
  assert.equal(result.handle, handle);
  assert.equal(result.project.transcript.document.title, "File fixture");
});
