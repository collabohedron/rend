import { createProject, validateDocument, validateProject } from "./project-model.mjs";

export async function retrieveShareTranscript(url, fetchObject = globalThis.fetch) {
  const response = await fetchObject("/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Import response could not be parsed.");
  }
  if (!response.ok) throw new Error(result?.error || "Import failed.");
  validateDocument(result?.document);
  if (typeof result.source_url !== "string") throw new Error("Imported transcript provenance is invalid.");
  return result;
}

export function canonicalMessageContent(message) {
  return [
    "rend-message-content",
    1,
    message.author,
    message.markdown.replace(/\r\n?/g, "\n"),
    message.attachments.map((attachment) => [
      attachment.filename ?? null,
      attachment.mime_type ?? null,
      attachment.size_bytes ?? null,
      attachment.width ?? null,
      attachment.height ?? null,
    ]),
  ];
}

export async function hashMessageContent(message, cryptoObject = globalThis.crypto) {
  if (!cryptoObject?.subtle) throw new Error("Web Crypto is required for transcript comparison.");
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalMessageContent(message)));
  const digest = await cryptoObject.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function transcriptsFunctionallyMatch(currentDocument, candidateDocument, dependencies = {}) {
  return (await compareTranscripts(currentDocument, candidateDocument, dependencies)) === "exact";
}

export async function compareTranscripts(currentDocument, candidateDocument, dependencies = {}) {
  validateDocument(currentDocument);
  validateDocument(candidateDocument);
  if (currentDocument.messages.length > candidateDocument.messages.length) return "mismatch";
  const hashMessage = dependencies.hashMessage || ((message) => hashMessageContent(message, dependencies.cryptoObject));
  const currentHashes = await Promise.all(currentDocument.messages.map((message) => hashMessage(message)));
  const candidateHashes = await Promise.all(candidateDocument.messages.slice(0, currentDocument.messages.length).map((message) => hashMessage(message)));
  if (!currentHashes.every((hash, index) => hash === candidateHashes[index])) return "mismatch";
  return currentDocument.messages.length === candidateDocument.messages.length ? "exact" : "prefix";
}

export async function importTranscriptForWorkspace(currentProject, candidateDocument, provenance = {}, dependencies = {}) {
  const document = clone(candidateDocument);
  validateDocument(document);
  if (!currentProject) {
    return { outcome: "new-project", project: createProject(document, provenance, dependencies), transcriptChanged: true };
  }
  validateProject(currentProject);
  const comparison = await compareTranscripts(currentProject.transcript.document, document, dependencies);
  if (comparison === "mismatch") {
    return { outcome: "different-transcript", project: createProject(document, provenance, dependencies), transcriptChanged: true };
  }
  const appendedMessageCount = document.messages.length - currentProject.transcript.document.messages.length;
  const changed = refreshCompatibleTranscript(currentProject, document, provenance, dependencies);
  return { outcome: "matching-transcript", comparison, appendedMessageCount, project: currentProject, transcriptChanged: changed };
}

function refreshCompatibleTranscript(project, document, provenance, dependencies) {
  const importedAt = (dependencies.now || (() => new Date().toISOString()))();
  const transcript = {
    schema: "rend-transcript",
    schemaVersion: 1,
    provenance: {
      kind: "chatgpt-share",
      importedAt,
      sourceUrl: String(provenance.sourceUrl || ""),
      importerVersion: 1,
    },
    document,
  };
  const sameDocument = JSON.stringify(project.transcript.document) === JSON.stringify(document);
  const sameSource = project.transcript.provenance?.sourceUrl === transcript.provenance.sourceUrl;
  if (sameDocument && sameSource) return false;

  const proposed = clone(project);
  proposed.transcript = transcript;
  const priorMessageCount = proposed.editorial.messageBindings.length;
  for (let index = 0; index < priorMessageCount; index += 1) {
    proposed.editorial.messageBindings[index].sourceMessageId = document.messages[index].id;
    proposed.editorial.messageBindings[index].sourceOrdinal = index;
  }
  const uuid = dependencies.uuid || defaultUuid;
  for (let index = priorMessageCount; index < document.messages.length; index += 1) {
    const binding = {
      id: uuid(), sourceMessageId: document.messages[index].id, sourceOrdinal: index, included: true, note: null,
    };
    proposed.editorial.messageBindings.push(binding);
    proposed.editorial.nodes.push({ kind: "message", messageBindingId: binding.id });
  }
  validateProject(proposed);

  project.transcript = deepFreeze(transcript);
  project.editorial = proposed.editorial;
  return true;
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
