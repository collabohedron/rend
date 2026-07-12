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

export function toMarkdown(documentModel) {
  const sections = [`# ${singleLine(documentModel.title)}`];
  for (const message of documentModel.messages) {
    const role = message.author === "user" ? "USER" : "ASSISTANT";
    const body = [`## ${role}`, message.markdown];
    if (message.attachments.length > 0) body.push(formatAttachments(message.attachments));
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

function formatAttachments(attachments) {
  const lines = ["### Attachments"];
  for (const attachment of attachments) {
    const label = attachment.filename || attachment.id || "Attachment";
    const details = [];
    if (attachment.id) details.push(`id: ${inlineCode(attachment.id)}`);
    if (attachment.mime_type) details.push(`type: ${inlineCode(attachment.mime_type)}`);
    if (attachment.size_bytes != null) details.push(`size: ${attachment.size_bytes} bytes`);
    if (attachment.width != null && attachment.height != null) {
      details.push(`dimensions: ${attachment.width} x ${attachment.height}`);
    }
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
