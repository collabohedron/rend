import { safeFilename, summarize, toMarkdown } from "./document.mjs";

const form = document.querySelector("#import-form");
const status = document.querySelector("#status");
const conversation = document.querySelector("#conversation");
const importSummary = document.querySelector("#import-summary");
const validation = document.querySelector("#validation");
const exportButton = document.querySelector("#export-markdown");
let importedDocument = null;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.textContent = "Importing...";
  conversation.replaceChildren();
  importSummary.hidden = true;
  validation.hidden = true;
  exportButton.disabled = true;
  importedDocument = null;
  try {
    const response = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: new FormData(form).get("url") }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Import failed");
    importedDocument = result.document;
    render(result.document);
    renderSummary(result.document);
    status.textContent = "Import complete.";
    exportButton.disabled = false;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Import failed";
  }
});

exportButton.addEventListener("click", () => {
  if (!importedDocument) return;
  const blob = new Blob([toMarkdown(importedDocument)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeFilename(importedDocument.title);
  link.click();
  URL.revokeObjectURL(url);
});

function renderSummary(documentModel) {
  const values = summarize(documentModel);
  setSummaryValues(importSummary, [
    ["Title", values.title],
    ["Messages", values.totalMessages],
    ["User", values.userMessages],
    ["Assistant", values.assistantMessages],
  ]);
  setSummaryValues(validation, [
    ["Total messages", values.totalMessages],
    ["Messages with Markdown source", values.messagesWithMarkdown],
    ["Attachments", values.attachments],
    ["Citations", values.citations],
    ["Content references", values.contentReferences],
  ]);
  importSummary.hidden = false;
  validation.hidden = false;
}

function setSummaryValues(container, entries) {
  const list = container.querySelector("dl");
  list.replaceChildren();
  for (const [label, value] of entries) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = String(value);
    list.append(term, description);
  }
}

function render(documentModel) {
  const heading = document.createElement("h1");
  heading.textContent = documentModel.title;
  conversation.append(heading);
  for (const message of documentModel.messages) {
    const article = document.createElement("article");
    article.dataset.messageId = message.id;
    const author = document.createElement("h2");
    author.textContent = message.author === "user" ? "User" : "Assistant";
    const source = document.createElement("pre");
    source.className = "markdown-source";
    source.textContent = message.markdown;
    article.append(author, source);
    for (const attachment of message.attachments) {
      const card = document.createElement("div");
      card.className = "attachment";
      card.textContent = [
        attachment.filename || attachment.id || "Attachment",
        attachment.mime_type,
        attachment.width && attachment.height ? `${attachment.width} x ${attachment.height}` : null,
      ].filter(Boolean).join(" - ");
      article.append(card);
    }
    conversation.append(article);
  }
}
