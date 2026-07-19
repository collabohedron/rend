export function createProject(documentModel, provenance = {}, dependencies = {}) {
  const uuid = dependencies.uuid || defaultUuid;
  const now = dependencies.now || (() => new Date().toISOString());
  const document = clone(documentModel);
  validateDocument(document);
  const timestamp = now();
  const project = {
    id: uuid(),
    createdAt: timestamp,
    savedAt: null,
    saveGeneration: 0,
    transcript: {
      schema: "rend-transcript",
      schemaVersion: 1,
      provenance: {
        kind: "chatgpt-share",
        importedAt: timestamp,
        sourceUrl: String(provenance.sourceUrl || ""),
        importerVersion: 1,
      },
      document: deepFreeze(document),
    },
    editorial: createRuntimeEditorial(document, emptyEditorialOverlay(document.title), uuid),
  };
  validateProject(project);
  return project;
}

export function projectFromContainer(components, dependencies = {}) {
  validateManifest(components?.manifest);
  const transcript = clone(components.transcript);
  if (transcript?.schema !== "rend-transcript" || transcript.schemaVersion !== 1) throw new Error("Unsupported transcript schema.");
  validateDocument(transcript.document);
  const overlay = clone(components.editorial);
  validateEditorialOverlay(overlay, transcript.document);
  const project = {
    id: components.manifest.projectId,
    createdAt: components.manifest.createdAt,
    savedAt: components.manifest.savedAt,
    saveGeneration: components.manifest.saveGeneration,
    transcript,
    editorial: createRuntimeEditorial(transcript.document, overlay, dependencies.uuid || defaultUuid),
  };
  deepFreeze(project.transcript.document);
  validateProject(project);
  return project;
}

export function serializeEditorialOverlay(project) {
  validateProject(project);
  const messageEdits = [];
  for (const binding of project.editorial.messageBindings) {
    if (binding.included && binding.note === null) continue;
    const edit = { messageIndex: binding.sourceOrdinal };
    if (!binding.included) edit.included = false;
    if (binding.note) edit.note = clone(binding.note);
    messageEdits.push(edit);
  }

  const sections = [];
  let messageIndex = 0;
  for (const node of project.editorial.nodes) {
    if (node.kind === "message") {
      messageIndex += 1;
      continue;
    }
    if (!node.text.trim()) throw new Error("Empty section markers cannot be saved.");
    sections.push({ id: node.id, text: node.text, beforeMessageIndex: messageIndex });
  }
  const overlay = {
    schema: "rend-editorial",
    schemaVersion: 1,
    documentHeader: project.editorial.documentHeader,
    messageEdits,
    sections,
  };
  validateEditorialOverlay(overlay, project.transcript.document);
  return overlay;
}

export function cloneProjectAs(project, dependencies = {}) {
  validateProject(project);
  const copy = clone(project);
  copy.id = (dependencies.uuid || defaultUuid)();
  copy.createdAt = (dependencies.now || (() => new Date().toISOString()))();
  copy.savedAt = null;
  copy.saveGeneration = 0;
  deepFreeze(copy.transcript.document);
  return copy;
}

export function deriveProjectDisplayTitle(project) {
  return project.editorial.documentHeader;
}

export function updateDocumentHeader(project, text) {
  const header = String(text).trim();
  if (!header) throw new Error("Document header cannot be empty.");
  project.editorial.documentHeader = header;
}

export function projectFilename(project) {
  return portableFilename(deriveProjectDisplayTitle(project), "Rend project", ".rend");
}

export function portableFilename(title, fallback, extension) {
  const normalizedExtension = String(extension).startsWith(".") ? String(extension) : `.${extension}`;
  let cleaned = String(title ?? "")
    .normalize("NFC")
    .replace(/[\r\n]+/g, " ")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned)) cleaned = `_${cleaned}`;
  cleaned = [...cleaned].slice(0, 180).join("").replace(/[. ]+$/g, "");
  const safeFallback = String(fallback || "document").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "") || "document";
  return `${cleaned || safeFallback}${normalizedExtension}`;
}

export function validateProject(project) {
  if (!project || typeof project !== "object") throw new Error("Project must be an object.");
  if (typeof project.id !== "string" || !project.id) throw new Error("Project ID is missing.");
  if (typeof project.createdAt !== "string" || !project.createdAt) throw new Error("Project creation time is missing.");
  if (project.transcript?.schema !== "rend-transcript" || project.transcript.schemaVersion !== 1) {
    throw new Error("Unsupported transcript schema.");
  }
  if (project.editorial?.schema !== "rend-editorial-runtime" || project.editorial.schemaVersion !== 1) {
    throw new Error("Unsupported runtime editorial schema.");
  }
  if (typeof project.editorial.documentHeader !== "string") throw new Error("Document header is invalid.");
  validateDocument(project.transcript.document);
  const messages = project.transcript.document.messages;
  const bindings = project.editorial.messageBindings;
  const nodes = project.editorial.nodes;
  if (!Array.isArray(bindings) || bindings.length !== messages.length || !Array.isArray(nodes)) {
    throw new Error("Project runtime editorial bindings are incomplete.");
  }
  const bindingIds = new Set();
  for (const binding of bindings) {
    if (!binding || typeof binding.id !== "string" || bindingIds.has(binding.id)) throw new Error("Project has duplicate message bindings.");
    bindingIds.add(binding.id);
    if (!Number.isInteger(binding.sourceOrdinal) || messages[binding.sourceOrdinal]?.id !== binding.sourceMessageId) {
      throw new Error("Message binding does not identify its source message.");
    }
    if (typeof binding.included !== "boolean") throw new Error("Message inclusion state is invalid.");
    validateNote(binding.note);
  }
  const messageNodeIds = [];
  const editorialIds = new Set(bindingIds);
  for (const node of nodes) {
    if (node?.kind === "message") {
      if (!bindingIds.has(node.messageBindingId)) throw new Error("Message node has a dangling binding.");
      messageNodeIds.push(node.messageBindingId);
    } else if (node?.kind === "section") {
      if (typeof node.id !== "string" || editorialIds.has(node.id) || typeof node.text !== "string" || "included" in node) {
        throw new Error("Section marker is invalid.");
      }
      editorialIds.add(node.id);
    } else {
      throw new Error("Project contains an unsupported document node.");
    }
  }
  const expectedMessageOrder = bindings.map((binding) => binding.id);
  if (messageNodeIds.length !== expectedMessageOrder.length || messageNodeIds.some((id, index) => id !== expectedMessageOrder[index])) {
    throw new Error("Transcript messages must retain their authoritative order.");
  }
  return project;
}

export function validateEditorialOverlay(overlay, document) {
  if (!overlay || overlay.schema !== "rend-editorial" || overlay.schemaVersion !== 1) throw new Error("Unsupported editorial schema.");
  requireOnlyKeys(overlay, new Set(["schema", "schemaVersion", "documentHeader", "messageEdits", "sections"]), "Editorial overlay");
  if (typeof overlay.documentHeader !== "string" || !overlay.documentHeader.trim()) throw new Error("Document header is empty.");
  if (!Array.isArray(overlay.messageEdits) || !Array.isArray(overlay.sections)) throw new Error("Editorial overlay collections are invalid.");
  const editedMessages = new Set();
  for (const edit of overlay.messageEdits) {
    if (!edit || typeof edit !== "object") throw new Error("Message edit is invalid.");
    requireOnlyKeys(edit, new Set(["messageIndex", "included", "note"]), "Message edit");
    if (!Number.isInteger(edit.messageIndex) || edit.messageIndex < 0 || edit.messageIndex >= document.messages.length || editedMessages.has(edit.messageIndex)) {
      throw new Error("Message edit target is invalid or duplicated.");
    }
    editedMessages.add(edit.messageIndex);
    if ("included" in edit && edit.included !== false) throw new Error("Editorial overlay may persist only omitted messages.");
    if ("note" in edit) validateNote(edit.note, false);
    if (edit.included !== false && !("note" in edit)) throw new Error("Message edit contains no non-default state.");
  }
  const sectionIds = new Set();
  let previousBoundary = -1;
  for (const section of overlay.sections) {
    if (!section || typeof section !== "object") throw new Error("Section marker is invalid.");
    requireOnlyKeys(section, new Set(["id", "text", "beforeMessageIndex"]), "Section marker");
    if (typeof section.id !== "string" || !section.id || sectionIds.has(section.id)) throw new Error("Section marker ID is invalid or duplicated.");
    sectionIds.add(section.id);
    if (typeof section.text !== "string" || !section.text.trim()) throw new Error("Section marker text is empty.");
    if (!Number.isInteger(section.beforeMessageIndex) || section.beforeMessageIndex < 0 || section.beforeMessageIndex > document.messages.length) {
      throw new Error("Section marker position is invalid.");
    }
    if (section.beforeMessageIndex < previousBoundary) throw new Error("Section markers are not in document order.");
    previousBoundary = section.beforeMessageIndex;
  }
  return overlay;
}

export function messageForBinding(project, binding) {
  return project.transcript.document.messages[binding.sourceOrdinal];
}

export function bindingById(project, bindingId) {
  const binding = project.editorial.messageBindings.find((item) => item.id === bindingId);
  if (!binding) throw new Error(`Unknown message binding: ${bindingId}`);
  return binding;
}

function createRuntimeEditorial(document, overlay, uuid) {
  const bindings = document.messages.map((message, sourceOrdinal) => ({
    id: uuid(), sourceMessageId: message.id, sourceOrdinal, included: true, note: null,
  }));
  for (const edit of overlay.messageEdits) {
    const binding = bindings[edit.messageIndex];
    if (edit.included === false) binding.included = false;
    if (edit.note) binding.note = clone(edit.note);
  }
  const sectionsByBoundary = Array.from({ length: document.messages.length + 1 }, () => []);
  for (const section of overlay.sections) {
    sectionsByBoundary[section.beforeMessageIndex].push({
      kind: "section", id: section.id, text: section.text,
    });
  }
  const nodes = [];
  for (let index = 0; index <= bindings.length; index += 1) {
    nodes.push(...sectionsByBoundary[index]);
    if (index < bindings.length) nodes.push({ kind: "message", messageBindingId: bindings[index].id });
  }
  return {
    schema: "rend-editorial-runtime",
    schemaVersion: 1,
    documentHeader: overlay.documentHeader,
    messageBindings: bindings,
    nodes,
  };
}

function emptyEditorialOverlay(documentHeader) {
  return { schema: "rend-editorial", schemaVersion: 1, documentHeader, messageEdits: [], sections: [] };
}

function validateDocument(document) {
  if (!document || typeof document !== "object" || typeof document.title !== "string" || !Array.isArray(document.messages) || !document.messages.length) {
    throw new Error("Imported transcript is invalid.");
  }
  for (const message of document.messages) {
    if (!message || typeof message.id !== "string" || !new Set(["user", "assistant"]).has(message.author) || typeof message.markdown !== "string") {
      throw new Error("Imported transcript contains an invalid message.");
    }
    if (!Array.isArray(message.attachments)) throw new Error("Imported message attachments are invalid.");
  }
}

function validateManifest(manifest) {
  if (!manifest || manifest.format !== "rend-project" || manifest.manifestVersion !== 1) throw new Error("Unsupported Rend project manifest.");
}

function validateNote(note, allowNull = true) {
  if (allowNull && note === null) return;
  if (!note || typeof note.id !== "string" || !note.id || typeof note.text !== "string") throw new Error("Message note is invalid.");
}

function requireOnlyKeys(value, allowed, label) {
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error(`${label} contains unsupported or redundant fields.`);
}

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function defaultUuid() {
  if (!globalThis.crypto?.randomUUID) throw new Error("Secure UUID generation is unavailable.");
  return globalThis.crypto.randomUUID();
}
