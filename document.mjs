import { bindingById, deriveProjectDisplayTitle, messageForBinding, portableFilename } from "./project-model.mjs";

export function setMessageIncluded(project, bindingId, included) {
  bindingById(project, bindingId).included = Boolean(included);
}

export function setAllMessagesIncluded(project, included) {
  for (const binding of project.editorial.messageBindings) binding.included = Boolean(included);
}

export function inclusionState(project) {
  const values = project.editorial.messageBindings.map((binding) => binding.included);
  if (values.length === 0 || values.every((value) => !value)) return "none";
  if (values.every(Boolean)) return "all";
  return "mixed";
}

export function addSection(project, beforeBindingId, text = "") {
  bindingById(project, beforeBindingId);
  const targetIndex = project.editorial.nodes.findIndex((node) => node.kind === "message" && node.messageBindingId === beforeBindingId);
  const section = { kind: "section", id: newId(), text: String(text) };
  project.editorial.nodes.splice(targetIndex, 0, section);
  return section;
}

export function updateSection(project, sectionId, text) {
  findSection(project, sectionId).text = String(text);
}

export function removeSection(project, sectionId) {
  project.editorial.nodes.splice(sectionIndex(project, sectionId), 1);
}

export function moveSection(project, sectionId, direction) {
  if (!new Set(["up", "down"]).has(direction)) throw new Error(`Unknown direction: ${direction}`);
  const index = sectionIndex(project, sectionId);
  const nodes = project.editorial.nodes;
  let target = -1;
  if (direction === "up") {
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (nodes[cursor].kind === "message") { target = cursor; break; }
    }
  } else {
    for (let cursor = index + 1; cursor < nodes.length; cursor += 1) {
      if (nodes[cursor].kind === "message") { target = cursor; break; }
    }
  }
  if (target < 0) return false;
  const [section] = nodes.splice(index, 1);
  nodes.splice(target, 0, section);
  return true;
}

export function canMoveSection(project, sectionId, direction) {
  const index = sectionIndex(project, sectionId);
  const nodes = project.editorial.nodes;
  if (direction === "up") return nodes.slice(0, index).some((node) => node.kind === "message");
  return nodes.slice(index + 1).some((node) => node.kind === "message");
}

export function anchorIds(project) {
  return project.editorial.nodes.filter((node) => node.kind === "section").map((node) => node.id);
}

export function adjacentAnchorId(project, sectionId, direction) {
  const ids = anchorIds(project);
  if (ids.length < 2) return null;
  const index = ids.indexOf(sectionId);
  if (index < 0) throw new Error(`Unknown section: ${sectionId}`);
  const offset = direction === "previous" ? -1 : direction === "next" ? 1 : 0;
  if (!offset) throw new Error(`Unknown anchor navigation direction: ${direction}`);
  return ids[(index + offset + ids.length) % ids.length];
}

export function anchorOutputState(project, sectionId) {
  const index = sectionIndex(project, sectionId);
  const zone = [];
  for (let cursor = index + 1; cursor < project.editorial.nodes.length; cursor += 1) {
    const node = project.editorial.nodes[cursor];
    if (node.kind === "section") break;
    zone.push(bindingById(project, node.messageBindingId));
  }
  return {
    kind: zone.length ? "bounding" : "island",
    included: zone.length ? zone.some((binding) => binding.included) : true,
    messageBindingIds: zone.map((binding) => binding.id),
  };
}

export function previousZoneState(project, sectionId) {
  const index = sectionIndex(project, sectionId);
  const zone = [];
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const node = project.editorial.nodes[cursor];
    if (node.kind === "section") break;
    zone.unshift(bindingById(project, node.messageBindingId));
  }
  if (!zone.length) return { state: "unavailable", messageBindingIds: [] };
  const included = zone.map((binding) => binding.included);
  return {
    state: included.every(Boolean) ? "included" : included.every((value) => !value) ? "omitted" : "mixed",
    messageBindingIds: zone.map((binding) => binding.id),
  };
}

export function togglePreviousZone(project, sectionId) {
  const zone = previousZoneState(project, sectionId);
  if (zone.state === "unavailable") return false;
  const included = zone.state === "omitted";
  for (const bindingId of zone.messageBindingIds) setMessageIncluded(project, bindingId, included);
  return true;
}

export function addNote(project, bindingId, text = "") {
  const binding = bindingById(project, bindingId);
  if (binding.note) throw new Error(`Message already has a note: ${bindingId}`);
  binding.note = { id: newId(), text: String(text) };
  return binding.note;
}

export function updateNote(project, bindingId, text) {
  const binding = bindingById(project, bindingId);
  if (!binding.note) throw new Error(`Message has no note: ${bindingId}`);
  binding.note.text = String(text);
}

export function removeNote(project, bindingId) {
  const binding = bindingById(project, bindingId);
  if (!binding.note) throw new Error(`Message has no note: ${bindingId}`);
  binding.note = null;
}

export function curatedStream(project, { includeOmitted = false } = {}) {
  const stream = [];
  for (const node of project.editorial.nodes) {
    if (node.kind === "section") {
      const output = anchorOutputState(project, node.id);
      if (includeOmitted || output.included) stream.push({
        kind: "section", section: node, included: output.included, anchorKind: output.kind,
      });
      continue;
    }
    const binding = bindingById(project, node.messageBindingId);
    if (includeOmitted || binding.included) {
      stream.push({
        kind: "message",
        message: messageForBinding(project, binding),
        binding,
        included: binding.included,
        note: binding.note,
      });
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

export function toMarkdown(project) {
  const sections = [`# ${singleLine(deriveProjectDisplayTitle(project))}`];
  for (const node of curatedStream(project)) {
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
  return portableFilename(title, "conversation", ".md");
}

function newId() {
  if (!globalThis.crypto?.randomUUID) throw new Error("Secure UUID generation is unavailable.");
  return globalThis.crypto.randomUUID();
}

function sectionIndex(project, sectionId) {
  const index = project.editorial.nodes.findIndex((node) => node.kind === "section" && node.id === sectionId);
  if (index < 0) throw new Error(`Unknown section: ${sectionId}`);
  return index;
}

function findSection(project, sectionId) {
  return project.editorial.nodes[sectionIndex(project, sectionId)];
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
