import { cloneProjectAs, projectFilename, projectFromContainer, serializeEditorialOverlay, validateProject } from "./project-model.mjs";
import { captureSave, commitSave } from "./project-session.mjs";

const PROJECT_TYPE = {
  description: "Rend project",
  accept: { "application/vnd.rend.project": [".rend"] },
};

export async function openProject({ windowObject, documentObject, fetchObject = globalThis.fetch }) {
  const selection = await chooseProjectFile(windowObject, documentObject);
  if (!selection) return { method: "cancelled" };
  const bytes = await selection.file.arrayBuffer();
  const components = await unpackProject(bytes, fetchObject);
  const project = projectFromContainer(components);
  return {
    method: "opened",
    project,
    handle: selection.handle,
    archiveDigest: await digestBytes(bytes),
  };
}

export async function saveProject(session, dependencies) {
  if (!session.handle) return saveProjectAs(session, dependencies);
  return writeProject(session, session.project, session.handle, dependencies, false);
}

export async function saveProjectAs(session, dependencies) {
  const { windowObject, documentObject } = dependencies;
  if (typeof windowObject.showSaveFilePicker !== "function") {
    const duplicate = cloneProjectAs(session.project, dependencies);
    const prepared = prepareForSave(duplicate, dependencies);
    const archive = await packProject(prepared, dependencies.fetchObject || globalThis.fetch);
    downloadArchive(archive, projectFilename(prepared), windowObject, documentObject);
    const capture = captureSave(session, duplicate);
    commitSave(session, capture, { project: prepared, handle: null, archiveDigest: await digestBytes(archive) });
    return { method: "download" };
  }
  let handle;
  try {
    handle = await windowObject.showSaveFilePicker({
      suggestedName: projectFilename(session.project),
      id: "rend-project",
      types: [PROJECT_TYPE],
    });
  } catch (error) {
    if (error?.name === "AbortError") return { method: "cancelled" };
    throw error;
  }
  const duplicate = cloneProjectAs(session.project, dependencies);
  return writeProject(session, duplicate, handle, dependencies, true);
}

export async function packProject(project, fetchObject = globalThis.fetch) {
  validateProject(project);
  const response = await fetchObject("/api/project/pack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: project.id,
      createdAt: project.createdAt,
      savedAt: project.savedAt,
      saveGeneration: project.saveGeneration,
      transcript: project.transcript,
      editorial: serializeEditorialOverlay(project),
    }),
  });
  if (!response.ok) throw new Error(await responseError(response, "Could not build Rend project."));
  return response.arrayBuffer();
}

export async function unpackProject(bytes, fetchObject = globalThis.fetch) {
  const response = await fetchObject("/api/project/unpack", {
    method: "POST",
    headers: { "Content-Type": "application/vnd.rend.project" },
    body: bytes,
  });
  if (!response.ok) throw new Error(await responseError(response, "Could not open Rend project."));
  return response.json();
}

async function writeProject(session, sourceProject, handle, dependencies, saveAs) {
  const capture = captureSave(session, sourceProject);
  const prepared = prepareForSave(sourceProject, dependencies);
  if (!saveAs && session.archiveDigest) {
    const current = await handle.getFile();
    const currentDigest = await digestBytes(await current.arrayBuffer());
    if (currentDigest !== session.archiveDigest) throw new Error("The project file changed outside Rend. Use Save Project As… to avoid overwriting it.");
  }
  const archive = await packProject(prepared, dependencies.fetchObject || globalThis.fetch);
  const expectedDigest = await digestBytes(archive);
  const writable = await handle.createWritable();
  try {
    await writable.write(archive);
    await writable.close();
  } catch (error) {
    try { await writable.abort?.(); } catch { /* Preserve the original failure. */ }
    throw error;
  }
  const writtenFile = await handle.getFile();
  const actualDigest = await digestBytes(await writtenFile.arrayBuffer());
  if (actualDigest !== expectedDigest) throw new Error("The saved project could not be verified.");
  commitSave(session, capture, { project: prepared, handle, archiveDigest: actualDigest });
  return { method: "file-system" };
}

function prepareForSave(project, dependencies) {
  const copy = typeof structuredClone === "function" ? structuredClone(project) : JSON.parse(JSON.stringify(project));
  copy.savedAt = (dependencies.now || (() => new Date().toISOString()))();
  copy.saveGeneration += 1;
  validateProject(copy);
  return copy;
}

async function chooseProjectFile(windowObject, documentObject) {
  if (typeof windowObject.showOpenFilePicker === "function") {
    try {
      const [handle] = await windowObject.showOpenFilePicker({ id: "rend-project", multiple: false, types: [PROJECT_TYPE] });
      return { handle, file: await handle.getFile() };
    } catch (error) {
      if (error?.name === "AbortError") return null;
      throw error;
    }
  }
  return new Promise((resolve) => {
    const input = documentObject.createElement("input");
    input.type = "file";
    input.accept = ".rend,application/vnd.rend.project";
    input.addEventListener("change", () => resolve(input.files?.[0] ? { handle: null, file: input.files[0] } : null), { once: true });
    input.click();
  });
}

async function digestBytes(value, cryptoObject = globalThis.crypto) {
  if (!cryptoObject?.subtle) throw new Error("Web Crypto is required for verified project saving.");
  const bytes = value instanceof ArrayBuffer ? value : await value.arrayBuffer();
  const digest = await cryptoObject.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function responseError(response, fallback) {
  try {
    const value = await response.json();
    return value.error || fallback;
  } catch {
    return fallback;
  }
}

function downloadArchive(bytes, filename, windowObject, documentObject) {
  const blob = new Blob([bytes], { type: "application/vnd.rend.project" });
  const url = windowObject.URL.createObjectURL(blob);
  const link = documentObject.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  windowObject.URL.revokeObjectURL(url);
}
