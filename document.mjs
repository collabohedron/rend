export function createCuratedDocument(documentModel) {
  return {
    source: documentModel,
    included: new Map(documentModel.messages.map((message) => [message.id, true])),
    nodes: documentModel.messages.map((message) => ({ kind: "message", messageId: message.id })),
    notes: new Map(),
    nextEditorialId: 1,
  };
}

export function setMessageIncluded(curated, messageId, included) {
  requireMessage(curated, messageId);
  curated.included.set(messageId, Boolean(included));
}

export function setAllMessagesIncluded(curated, included) {
  for (const messageId of curated.included.keys()) curated.included.set(messageId, Boolean(included));
}

export function inclusionState(curated) {
  const values = Array.from(curated.included.values());
  if (values.length === 0) return "none";
  if (values.every(Boolean)) return "all";
  if (values.every((value) => !value)) return "none";
  return "mixed";
}

export function addSection(curated, beforeMessageId, text = "") {
  requireMessage(curated, beforeMessageId);
  const targetIndex = curated.nodes.findIndex((node) => node.kind === "message" && node.messageId === beforeMessageId);
  const section = { kind: "section", id: nextId(curated), text: String(text), included: true };
  curated.nodes.splice(targetIndex, 0, section);
  return section;
}

export function setSectionIncluded(curated, sectionId, included) {
  findSection(curated, sectionId).included = Boolean(included);
}

export function updateSection(curated, sectionId, text) {
  findSection(curated, sectionId).text = String(text);
}

export function removeSection(curated, sectionId) {
  const index = sectionIndex(curated, sectionId);
  curated.nodes.splice(index, 1);
}

export function moveSection(curated, sectionId, direction) {
  if (!new Set(["up", "down"]).has(direction)) throw new Error(`Unknown direction: ${direction}`);
  const index = sectionIndex(curated, sectionId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= curated.nodes.length) return false;
  [curated.nodes[index], curated.nodes[target]] = [curated.nodes[target], curated.nodes[index]];
  return true;
}

export function canMoveSection(curated, sectionId, direction) {
  const index = sectionIndex(curated, sectionId);
  return direction === "up" ? index > 0 : index < curated.nodes.length - 1;
}

export function addNote(curated, messageId, text = "") {
  requireMessage(curated, messageId);
  if (curated.notes.has(messageId)) throw new Error(`Message already has a note: ${messageId}`);
  const note = { id: nextId(curated), messageId, text: String(text) };
  curated.notes.set(messageId, note);
  return note;
}

export function updateNote(curated, messageId, text) {
  const note = curated.notes.get(messageId);
  if (!note) throw new Error(`Message has no note: ${messageId}`);
  note.text = String(text);
}

export function removeNote(curated, messageId) {
  if (!curated.notes.delete(messageId)) throw new Error(`Message has no note: ${messageId}`);
}

export function curatedStream(curated, { includeOmitted = false } = {}) {
  const messages = new Map(curated.source.messages.map((message) => [message.id, message]));
  const stream = [];
  for (const node of curated.nodes) {
    if (node.kind === "section") {
      if (includeOmitted || node.included) stream.push({ kind: "section", section: node, included: node.included });
      continue;
    }
    const included = curated.included.get(node.messageId);
    if (includeOmitted || included) {
      stream.push({ kind: "message", message: messages.get(node.messageId), included, note: curated.notes.get(node.messageId) || null });
    }
  }
  return stream;
}

export function summarize(documentModel) {
  const summary = {
    title: documentModel.title,
    totalMessages: documentModel.messages.length,
    userMessages: 0,
    assistantMessages: 0,
    messagesWithMarkdown: 0,
    attachments: 0,
    citations: 0,
    contentReferences: 0,
  };
  for (const message of documentModel.messages) {
    if (message.author === "user") summary.userMessages += 1;
    if (message.author === "assistant") summary.assistantMessages += 1;
    if (message.markdown.length > 0) summary.messagesWithMarkdown += 1;
    summary.attachments += message.attachments.length;
    summary.citations += message.citations.length;
    summary.contentReferences += message.content_references.length;
  }
  return summary;
}

export function messageMarkdown(message) {
  const parts = [message.markdown];
  if (message.attachments.length > 0) parts.push(formatAttachments(message.attachments));
  return parts.filter((part) => part !== "").join("\n\n");
}

export function copyMarkdown(message) {
  return message.markdown;
}

export function toMarkdown(curated) {
  const sections = [`# ${singleLine(curated.source.title)}`];
  for (const node of curatedStream(curated)) {
    if (node.kind === "section") {
      const text = node.section.text.trim();
      if (text) sections.push(`## ${singleLine(text)}`);
      continue;
    }
    const role = node.message.author === "user" ? "USER" : "ASSISTANT";
    const body = [`## ${role}`, messageMarkdown(node.message)];
    if (node.note?.text.trim()) body.push(formatNote(node.note.text));
    sections.push(body.filter((part) => part !== "").join("\n\n"));
  }
  return `${sections.join("\n\n")}\n`;
}

export function safeFilename(title) {
  const cleaned = singleLine(title)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return `${cleaned || "conversation"}.md`;
}

function requireMessage(curated, messageId) {
  if (!curated.included.has(messageId)) throw new Error(`Unknown message: ${messageId}`);
}

function nextId(curated) {
  return `editorial-${curated.nextEditorialId++}`;
}

function sectionIndex(curated, sectionId) {
  const index = curated.nodes.findIndex((node) => node.kind === "section" && node.id === sectionId);
  if (index < 0) throw new Error(`Unknown section: ${sectionId}`);
  return index;
}

function findSection(curated, sectionId) {
  return curated.nodes[sectionIndex(curated, sectionId)];
}

function formatNote(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return ["> **Note**", ">", ...lines.map((line) => `> ${line}`)].join("\n");
}

function formatAttachments(attachments) {
  const lines = ["### Attachments"];
  for (const attachment of attachments) {
    const label = attachment.filename || attachment.id || "Attachment";
    const details = [];
    if (attachment.id) details.push(`id: ${inlineCode(attachment.id)}`);
    if (attachment.mime_type) details.push(`type: ${inlineCode(attachment.mime_type)}`);
    if (attachment.size_bytes != null) details.push(`size: ${attachment.size_bytes} bytes`);
    if (attachment.width != null && attachment.height != null) details.push(`dimensions: ${attachment.width} x ${attachment.height}`);
    if (attachment.reference) details.push(`reference: ${inlineCode(attachment.reference)}`);
    lines.push(`- **${escapeInline(label)}**${details.length ? ` - ${details.join("; ")}` : ""}`);
  }
  return lines.join("\n");
}

function singleLine(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function escapeInline(value) {
  return singleLine(value).replace(/([\\`*_{}\[\]<>])/g, "\\$1");
}

function inlineCode(value) {
  const text = singleLine(value);
  const longestRun = Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(longestRun + 1);
  const padding = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${padding}${text}${padding}${fence}`;
}
