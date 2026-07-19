import { dirtyState } from "./project-session.mjs";

export async function prepareWorkspaceSwitch(session, { choose, save }) {
  if (!session || !dirtyState(session).any) return { proceed: true, choice: "clean" };
  const choice = await choose();
  if (choice === "cancel") return { proceed: false, choice };
  if (choice === "discard") return { proceed: true, choice };
  if (choice !== "save") throw new Error("Unknown workspace-switch choice.");
  return { proceed: Boolean(await save()), choice };
}
