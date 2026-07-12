import {
  addNote,
  addSection,
  canMoveSection,
  copyMarkdown,
  createCuratedDocument,
  curatedStream,
  inclusionState,
  moveSection,
  removeNote,
  removeSection,
  safeFilename,
  setAllMessagesIncluded,
  setMessageIncluded,
  summarize,
  toMarkdown,
  updateNote,
  updateSection,
} from "./document.mjs";
import { FileHandleStore } from "./save-location.mjs";
import { saveMarkdown } from "./save-markdown.mjs";

const form = document.querySelector("#import-form");
const status = document.querySelector("#status");
const conversation = document.querySelector("#conversation");
const summaryPanel = document.querySelector("#summary-panel");
const importSummary = document.querySelector("#import-summary");
const validation = document.querySelector("#validation");
const documentActions = document.querySelector("#document-actions");
const includeAll = document.querySelector("#include-all");
const saveButton = document.querySelector("#save-markdown");
const printButton = document.querySelector("#print-selected");
const safetyRecommendation = document.querySelector("#safety-recommendation");
const handleStore = new FileHandleStore();
let curated = null;
let editingSectionId = null;
let editingNoteMessageId = null;
let editingOriginal = null;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  resetViewer();
  status.textContent = "Importing...";
  try {
    const response = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: new FormData(form).get("url") }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Import failed");
    curated = createCuratedDocument(result.document);
    renderSummary(result.document);
    renderCuratedDocument();
    updateGlobalInclusionControl();
    summaryPanel.hidden = false;
    documentActions.hidden = false;
    status.textContent = "Import complete.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Import failed";
  }
});

includeAll.addEventListener("change", () => {
  if (!curated) return;
  setAllMessagesIncluded(curated, includeAll.checked);
  for (const article of conversation.querySelectorAll("article.message")) updateMessageAppearance(article, includeAll.checked);
  updateGlobalInclusionControl();
});

saveButton.addEventListener("click", async () => {
  if (!curated) return;
  const result = await saveMarkdown({
    markdown: toMarkdown(curated),
    filename: safeFilename(curated.source.title),
    windowObject: window,
    documentObject: document,
    handleStore,
  });
  if (result.method === "cancelled") {
    status.textContent = "Save cancelled.";
    return;
  }
  status.textContent = result.method === "file-system" ? "Markdown saved." : "Markdown download started.";
  safetyRecommendation.hidden = false;
});

printButton.addEventListener("click", () => {
  if (!curated) return;
  finishActiveEditing();
  renderCuratedDocument();
  window.print();
});

document.addEventListener("pointerdown", (event) => {
  const activeEditor = conversation.querySelector(".section-marker.editing, .message-note.editing");
  if (activeEditor && !activeEditor.contains(event.target)) closeActiveEditorInPlace(false);
}, true);

function resetViewer() {
  curated = null;
  editingSectionId = null;
  editingNoteMessageId = null;
  editingOriginal = null;
  conversation.replaceChildren();
  summaryPanel.hidden = true;
  documentActions.hidden = true;
  safetyRecommendation.hidden = true;
}

function renderSummary(documentModel) {
  const values = summarize(documentModel);
  setSummaryValues(importSummary, [
    ["Title", values.title], ["Total messages", values.totalMessages],
    ["User messages", values.userMessages], ["Assistant messages", values.assistantMessages],
  ]);
  setSummaryValues(validation, [
    ["Markdown messages", values.messagesWithMarkdown], ["Attachments", values.attachments],
    ["Citations", values.citations], ["Content references", values.contentReferences],
  ]);
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

function renderCuratedDocument() {
  conversation.replaceChildren();
  const heading = document.createElement("h1");
  heading.textContent = curated.source.title;
  conversation.append(heading);
  for (const node of curatedStream(curated, { includeOmitted: true })) {
    conversation.append(node.kind === "section" ? createSectionElement(node.section) : createMessageElement(node));
  }
  focusActiveEditor();
}

function createMessageElement(node) {
  const { message, included, note } = node;
  const article = document.createElement("article");
  article.className = "message";
  article.dataset.messageId = message.id;

  const topControls = document.createElement("div");
  topControls.className = "message-edge-controls message-top-controls no-print";
  const header = document.createElement("header");
  const author = document.createElement("h2");
  author.textContent = message.author === "user" ? "USER" : "ASSISTANT";
  const omitted = document.createElement("span");
  omitted.className = "omitted-label";
  omitted.textContent = "OMITTED";
  omitted.hidden = included;
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = included;
  checkbox.className = "message-included";
  checkbox.title = "Include this message in printouts and Markdown exports.";
  checkbox.setAttribute("aria-label", checkbox.title);
  checkbox.addEventListener("change", () => {
    setMessageIncluded(curated, message.id, checkbox.checked);
    updateMessageAppearance(article, checkbox.checked);
    updateGlobalInclusionControl();
  });

  const copyButton = copyIconButton(async () => {
    try {
      await navigator.clipboard.writeText(copyMarkdown(message));
      copyButton.textContent = "✓";
      copyButton.title = "Copied";
      window.setTimeout(() => restoreCopyButton(copyButton), 1200);
    } catch {
      status.textContent = "Unable to copy this message.";
    }
  });
  const sectionButton = iconButton("§", "Add section marker before this message", () => {
    finishActiveEditing();
    const section = addSection(curated, message.id, "");
    editingSectionId = section.id;
    editingOriginal = { kind: "section", id: section.id, text: "" };
    renderCuratedDocument();
  });
  const noteButton = iconButton("📝", note ? "This message already has a note" : "Add note to this message", () => {
    if (note) return;
    finishActiveEditing();
    addNote(curated, message.id, "");
    editingNoteMessageId = message.id;
    editingOriginal = { kind: "note", id: message.id, text: "" };
    renderCuratedDocument();
  });
  noteButton.classList.add("add-note-control");
  noteButton.disabled = Boolean(note);
  if (note) {
    noteButton.title = "Note attached to this message";
    noteButton.setAttribute("aria-label", noteButton.title);
  }
  topControls.append(checkbox, sectionButton);
  header.append(author, omitted);

  const source = document.createElement("pre");
  source.className = "markdown-source";
  source.textContent = message.markdown;
  article.append(topControls, header, source);
  for (const attachment of message.attachments) article.append(createAttachmentCard(attachment));
  if (note) article.append(createNoteElement(note));
  const bottomControls = document.createElement("div");
  bottomControls.className = "message-edge-controls message-bottom-controls no-print";
  bottomControls.append(copyButton, noteButton);
  article.append(bottomControls);
  updateMessageAppearance(article, included);
  return article;
}

function createSectionElement(section) {
  const element = document.createElement("section");
  element.className = "section-marker";
  element.dataset.sectionId = section.id;
  if (editingSectionId === section.id) {
    element.classList.add("editing");
    const editor = document.createElement("input");
    editor.className = "section-editor";
    editor.value = section.text;
    editor.placeholder = "Section heading";
    editor.maxLength = 160;
    editor.setAttribute("aria-label", "Section heading");
    editor.addEventListener("input", () => updateSection(curated, section.id, editor.value));
    editor.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeActiveEditorInPlace(true);
      }
    });
    const controls = editingControls({
      canMoveUp: canMoveSection(curated, section.id, "up"),
      canMoveDown: canMoveSection(curated, section.id, "down"),
      moveUp: () => moveAndRenderSection(section.id, "up"),
      moveDown: () => moveAndRenderSection(section.id, "down"),
      remove: () => {
        removeSection(curated, section.id);
        editingSectionId = null;
        editingOriginal = null;
        element.remove();
      },
    });
    element.append(editor, controls);
  } else {
    const heading = document.createElement("h2");
    heading.textContent = `§ ${section.text || "Untitled section"}`;
    element.tabIndex = 0;
    element.addEventListener("click", () => beginSectionEditing(section, element));
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        beginSectionEditing(section, element);
      }
    });
    element.append(heading);
  }
  return element;
}

function createNoteElement(note) {
  const element = document.createElement("aside");
  element.className = "message-note";
  element.dataset.noteFor = note.messageId;
  if (editingNoteMessageId === note.messageId) {
    element.classList.add("editing");
    const editor = document.createElement("textarea");
    editor.className = "note-editor";
    editor.value = note.text;
    editor.placeholder = "Note about this message";
    editor.rows = 3;
    editor.setAttribute("aria-label", "Note about this message");
    editor.addEventListener("input", () => updateNote(curated, note.messageId, editor.value));
    editor.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeActiveEditorInPlace(true);
      }
    });
    const controls = editingControls({
      remove: () => {
        removeNote(curated, note.messageId);
        editingNoteMessageId = null;
        editingOriginal = null;
        renderCuratedDocument();
      },
    });
    element.append(editor, controls);
  } else {
    const text = document.createElement("p");
    text.textContent = note.text || "Empty note";
    element.tabIndex = 0;
    element.addEventListener("click", () => beginNoteEditing(note, element));
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        beginNoteEditing(note, element);
      }
    });
    element.append(text);
  }
  return element;
}

function editingControls({ canMoveUp, canMoveDown, moveUp, moveDown, remove }) {
  const controls = document.createElement("div");
  controls.className = "editing-controls no-print";
  if (moveUp) {
    const button = iconButton("↑", "Move section marker up", moveUp);
    button.disabled = !canMoveUp;
    controls.append(button);
  }
  if (moveDown) {
    const button = iconButton("↓", "Move section marker down", moveDown);
    button.disabled = !canMoveDown;
    controls.append(button);
  }
  controls.append(iconButton("✕", "Remove annotation", remove));
  return controls;
}

function moveAndRenderSection(sectionId, direction) {
  moveSection(curated, sectionId, direction);
  renderCuratedDocument();
}

function beginSectionEditing(section, element) {
  finishActiveEditing();
  editingSectionId = section.id;
  editingOriginal = { kind: "section", id: section.id, text: section.text };
  element.replaceWith(createSectionElement(section));
  focusActiveEditor();
}

function beginNoteEditing(note, element) {
  finishActiveEditing();
  editingNoteMessageId = note.messageId;
  editingOriginal = { kind: "note", id: note.messageId, text: note.text };
  element.replaceWith(createNoteElement(note));
  focusActiveEditor();
}

function closeActiveEditorInPlace(cancel) {
  const sectionId = editingSectionId;
  const noteMessageId = editingNoteMessageId;
  const activeElement = conversation.querySelector(".section-marker.editing, .message-note.editing");
  if (cancel && editingOriginal?.kind === "section" && sectionId) updateSection(curated, sectionId, editingOriginal.text);
  if (cancel && editingOriginal?.kind === "note" && noteMessageId) updateNote(curated, noteMessageId, editingOriginal.text);
  editingSectionId = null;
  editingNoteMessageId = null;
  editingOriginal = null;

  if (sectionId) {
    const section = curated.nodes.find((node) => node.kind === "section" && node.id === sectionId);
    if (section && !section.text.trim()) {
      removeSection(curated, sectionId);
      activeElement?.remove();
    } else if (section) {
      activeElement?.replaceWith(createSectionElement(section));
    }
  }
  if (noteMessageId) {
    const note = curated.notes.get(noteMessageId);
    if (note && !note.text.trim()) {
      removeNote(curated, noteMessageId);
      enableNoteControl(activeElement?.closest("article.message"));
      activeElement?.remove();
    } else if (note) {
      activeElement?.replaceWith(createNoteElement(note));
    }
  }
}

function enableNoteControl(article) {
  const button = article?.querySelector(".add-note-control");
  if (!button) return;
  button.disabled = false;
  button.title = "Add note to this message";
  button.setAttribute("aria-label", button.title);
}

function finishActiveEditing() {
  if (editingSectionId || editingNoteMessageId) closeActiveEditorInPlace(false);
}

function focusActiveEditor() {
  const selector = editingSectionId ? `[data-section-id="${CSS.escape(editingSectionId)}"] input` :
    editingNoteMessageId ? `[data-note-for="${CSS.escape(editingNoteMessageId)}"] textarea` : null;
  if (selector) conversation.querySelector(selector)?.focus();
}

function updateMessageAppearance(article, included) {
  article.classList.toggle("omitted", !included);
  article.querySelector(".omitted-label").hidden = included;
  article.querySelector(".message-included").checked = included;
}

function updateGlobalInclusionControl() {
  const state = curated ? inclusionState(curated) : "none";
  includeAll.disabled = !curated;
  includeAll.indeterminate = state === "mixed";
  includeAll.checked = state === "all";
}

function createAttachmentCard(attachment) {
  const card = document.createElement("div");
  card.className = "attachment";
  card.textContent = [attachment.filename || attachment.id || "Attachment", attachment.mime_type,
    attachment.width && attachment.height ? `${attachment.width} x ${attachment.height}` : null].filter(Boolean).join(" - ");
  return card;
}

function iconButton(icon, title, handler) {
  const button = textButton(icon, handler);
  button.className = "icon-button";
  button.title = title;
  button.setAttribute("aria-label", title);
  return button;
}

function copyIconButton(handler) {
  const button = iconButton("", "Copy message Markdown", handler);
  const symbol = document.createElement("span");
  symbol.className = "copy-symbol";
  symbol.setAttribute("aria-hidden", "true");
  button.append(symbol);
  return button;
}

function restoreCopyButton(button) {
  button.replaceChildren();
  const symbol = document.createElement("span");
  symbol.className = "copy-symbol";
  symbol.setAttribute("aria-hidden", "true");
  button.append(symbol);
  button.title = "Copy message Markdown";
}

function textButton(label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}
