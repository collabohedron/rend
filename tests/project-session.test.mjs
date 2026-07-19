import assert from "node:assert/strict";
import test from "node:test";

import { captureSave, commitSave, createProjectSession, dirtyState, markEditorialChanged, markTranscriptChanged } from "../project-session.mjs";

function project() {
  return { id: "old", createdAt: "created", savedAt: null, saveGeneration: 0 };
}

test("an imported project starts dirty and an opened project starts clean", () => {
  assert.equal(dirtyState(createProjectSession(project())).any, true);
  assert.equal(dirtyState(createProjectSession(project(), { persisted: true })).any, false);
});

test("dirty tracking is independent by component", () => {
  const session = createProjectSession(project(), { persisted: true });
  markEditorialChanged(session);
  assert.deepEqual(dirtyState(session), { transcript: false, editorial: true, any: true });
  markTranscriptChanged(session);
  assert.deepEqual(dirtyState(session), { transcript: true, editorial: true, any: true });
});

test("a save only clears revisions captured before it began", () => {
  const session = createProjectSession(project(), { persisted: true });
  markEditorialChanged(session);
  const capture = captureSave(session);
  markEditorialChanged(session);
  commitSave(session, capture, {
    project: { ...project(), savedAt: "saved", saveGeneration: 1 },
    handle: {}, archiveDigest: "digest",
  });
  assert.equal(dirtyState(session).editorial, true);
  assert.equal(session.savedRevisions.editorial, 1);
  assert.equal(session.revisions.editorial, 2);
});
