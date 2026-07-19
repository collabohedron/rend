import assert from "node:assert/strict";
import test from "node:test";

import { createProjectSession, markEditorialChanged } from "../project-session.mjs";
import { prepareWorkspaceSwitch } from "../workspace-switch.mjs";

function dirtySession() {
  const session = createProjectSession({ id: "project" }, { persisted: true });
  markEditorialChanged(session);
  return session;
}

test("a clean workspace switches without prompting", async () => {
  let prompted = false;
  const result = await prepareWorkspaceSwitch(createProjectSession({ id: "clean" }, { persisted: true }), {
    choose: async () => { prompted = true; return "cancel"; }, save: async () => false,
  });
  assert.deepEqual(result, { proceed: true, choice: "clean" });
  assert.equal(prompted, false);
});

test("Don't Save proceeds and Cancel preserves the current workspace", async () => {
  assert.deepEqual(await prepareWorkspaceSwitch(dirtySession(), {
    choose: async () => "discard", save: async () => { throw new Error("must not save"); },
  }), { proceed: true, choice: "discard" });
  assert.deepEqual(await prepareWorkspaceSwitch(dirtySession(), {
    choose: async () => "cancel", save: async () => { throw new Error("must not save"); },
  }), { proceed: false, choice: "cancel" });
});

test("Save proceeds only after a successful save", async () => {
  assert.deepEqual(await prepareWorkspaceSwitch(dirtySession(), {
    choose: async () => "save", save: async () => true,
  }), { proceed: true, choice: "save" });
  assert.deepEqual(await prepareWorkspaceSwitch(dirtySession(), {
    choose: async () => "save", save: async () => false,
  }), { proceed: false, choice: "save" });
});
