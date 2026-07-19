import {
  addNote,
  addSection,
  adjacentAnchorId,
  anchorOutputState,
  canMoveSection,
  copyMarkdown,
  curatedStream,
  inclusionState,
  moveSection,
  previousZoneState,
  removeNote,
  removeSection,
  safeFilename,
  setAllMessagesIncluded,
  setMessageIncluded,
  summarize,
  togglePreviousZone,
  toMarkdown,
  updateNote,
  updateSection,
} from "./document.mjs";
import { bindingById, createProject, deriveProjectDisplayTitle, updateDocumentHeader } from "./project-model.mjs";
import { createProjectSession, dirtyState, markEditorialChanged } from "./project-session.mjs";
import { openProject, saveProject, saveProjectAs } from "./project-file.mjs";
import { FileHandleStore } from "./save-location.mjs";
import { saveMarkdown } from "./save-markdown.mjs";

const form = document.querySelector("#import-form");
const openButton = document.querySelector("#open-project");
const status = document.querySelector("#status");
const conversation = document.querySelector("#conversation");
const summaryPanel = document.querySelector("#summary-panel");
const importSummary = document.querySelector("#import-summary");
const validation = document.querySelector("#validation");
const documentActions = document.querySelector("#document-actions");
const includeAll = document.querySelector("#include-all");
const projectState = document.querySelector("#project-state");
const saveProjectButton = document.querySelector("#save-project");
const saveProjectAsButton = document.querySelector("#save-project-as");
const saveButton = document.querySelector("#save-markdown");
const printButton = document.querySelector("#print-selected");
const safetyRecommendation = document.querySelector("#safety-recommendation");
const dismissSafetyRecommendation = document.querySelector("#dismiss-safety-recommendation");
const handleStore = new FileHandleStore();
let curated = null;
let projectSession = null;
let editingDocumentHeader = false;
let editingDocumentHeaderDraft = null;
let editingSectionId = null;
let editingNoteMessageId = null;
let editingOriginal = null;
let statusTimer = null;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!confirmDiscardDirty()) return;
  showStatus("Importing...");
  try {
    const response = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: new FormData(form).get("url") }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Import failed");
    curated = await createProject(result.document, { sourceUrl: result.source_url });
    projectSession = createProjectSession(curated);
    renderSummary(result.document);
    renderCuratedDocument();
    updateGlobalInclusionControl();
    updateProjectState();
    summaryPanel.hidden = false;
    documentActions.hidden = false;
    showStatus("Import complete.", true);
  } catch (error) {
    form.hidden = false;
    showStatus(error instanceof Error ? error.message : "Import failed");
  }
});

openButton.addEventListener("click", async () => {
  if (!confirmDiscardDirty()) return;
  try {
    const result = await openProject({ windowObject: window, documentObject: document });
    if (result.method === "cancelled") return;
    curated = result.project;
    projectSession = createProjectSession(curated, {
      persisted: true,
      handle: result.handle,
      archiveDigest: result.archiveDigest,
    });
    renderSummary(curated.transcript.document);
    renderCuratedDocument();
    updateGlobalInclusionControl();
    updateProjectState();
    summaryPanel.hidden = false;
    documentActions.hidden = false;
    showStatus("Project opened.", true);
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Could not open project.");
  }
});

includeAll.addEventListener("change", () => {
  if (!curated) return;
  setAllMessagesIncluded(curated, includeAll.checked);
  markEditorialChanged(projectSession);
  renderCuratedDocument();
  updateGlobalInclusionControl();
  updateProjectState();
});

saveProjectButton.addEventListener("click", () => saveCurrentProject(false));
saveProjectAsButton.addEventListener("click", () => saveCurrentProject(true));

saveButton.addEventListener("click", async () => {
  if (!curated) return;
  finishActiveEditing();
  const result = await saveMarkdown({
    markdown: toMarkdown(curated),
    filename: safeFilename(deriveProjectDisplayTitle(curated)),
    windowObject: window,
    documentObject: document,
    handleStore,
  });
  if (result.method === "cancelled") {
    showStatus("Save cancelled.", true);
    return;
  }
  showStatus(result.method === "file-system" ? "Markdown saved." : "Markdown download started.", true);
  showSafetyRecommendation();
});

printButton.addEventListener("click", () => {
  if (!curated) return;
  finishActiveEditing();
  renderCuratedDocument();
  window.print();
  showSafetyRecommendation();
});

dismissSafetyRecommendation.addEventListener("click", () => {
  safetyRecommendation.hidden = true;
});

document.addEventListener("pointerdown", (event) => {
  const activeEditor = conversation.querySelector(".document-header.editing, .section-marker.editing, .message-note.editing");
  if (activeEditor && !activeEditor.contains(event.target)) closeActiveEditorInPlace(false);
}, true);

function resetViewer() {
  curated = null;
  projectSession = null;
  editingDocumentHeader = false;
  editingDocumentHeaderDraft = null;
  editingSectionId = null;
  editingNoteMessageId = null;
  editingOriginal = null;
  form.hidden = false;
  conversation.replaceChildren();
  summaryPanel.hidden = true;
  documentActions.hidden = true;
  safetyRecommendation.hidden = true;
  hideStatus();
  updateProjectState();
}

async function saveCurrentProject(asNew) {
  if (!projectSession) return;
  finishActiveEditing();
  updateProjectState();
  try {
    const result = await (asNew ? saveProjectAs : saveProject)(projectSession, {
      windowObject: window,
      documentObject: document,
    });
    if (result.method === "cancelled") {
      showStatus("Project save cancelled.", true);
      return;
    }
    curated = projectSession.project;
    updateProjectState();
    showStatus(result.method === "download" ? "Rend project download started." : "Project saved.", true);
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Could not save project.");
  }
}

function confirmDiscardDirty() {
  return !projectSession || !dirtyState(projectSession).any || window.confirm("Discard unsaved project changes?");
}

function showStatus(message, transient = false) {
  if (statusTimer) window.clearTimeout(statusTimer);
  status.textContent = message;
  status.hidden = false;
  if (transient) statusTimer = window.setTimeout(hideStatus, 2600);
}

function hideStatus() {
  if (statusTimer) window.clearTimeout(statusTimer);
  statusTimer = null;
  status.hidden = true;
  status.textContent = "";
}

function showSafetyRecommendation() {
  safetyRecommendation.hidden = false;
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
  conversation.append(createDocumentHeaderElement());
  for (const node of curatedStream(curated, { includeOmitted: true })) {
    conversation.append(node.kind === "section" ? createSectionElement(node) : createMessageElement(node));
  }
  focusActiveEditor();
}

function createDocumentHeaderElement() {
  const heading = document.createElement("h1");
  heading.className = "document-header";
  if (editingDocumentHeader) {
    heading.classList.add("editing");
    const editor = document.createElement("input");
    editor.className = "document-header-editor";
    editor.value = editingDocumentHeaderDraft ?? curated.editorial.documentHeader;
    editor.maxLength = 240;
    editor.required = true;
    editor.setAttribute("aria-label", "Document header");
    editor.addEventListener("input", () => { editingDocumentHeaderDraft = editor.value; });
    editor.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeActiveEditorInPlace(true);
      }
    });

    heading.append(editor);
  } else {
    heading.textContent = deriveProjectDisplayTitle(curated);
    heading.tabIndex = 0;
    heading.addEventListener("click", () => beginDocumentHeaderEditing(heading));
    heading.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        beginDocumentHeaderEditing(heading);
      }
    });
  }
  return heading;
}

function createMessageElement(node) {
  const { message, binding, included, note } = node;
  const article = document.createElement("article");
  article.className = "message";
  article.dataset.messageId = binding.id;

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
    setMessageIncluded(curated, binding.id, checkbox.checked);
    markEditorialChanged(projectSession);
    renderCuratedDocument();
    updateGlobalInclusionControl();
    updateProjectState();
  });

  const copyButton = copyIconButton(async () => {
    try {
      await navigator.clipboard.writeText(copyMarkdown(message));
      copyButton.textContent = "✓";
      copyButton.title = "Copied";
      window.setTimeout(() => restoreCopyButton(copyButton), 1200);
    } catch {
      showStatus("Unable to copy this message.", true);
    }
  });
  const sectionButton = iconButton("§", "Add section marker before this message", () => {
    finishActiveEditing();
    const section = addSection(curated, binding.id, "");
    editingSectionId = section.id;
    editingOriginal = { kind: "section", id: section.id, text: "", isNew: true };
    renderCuratedDocument();
  });
  const noteButton = iconButton("📝", note ? "This message already has a note" : "Add note to this message", () => {
    if (note) return;
    finishActiveEditing();
    addNote(curated, binding.id, "");
    editingNoteMessageId = binding.id;
    editingOriginal = { kind: "note", id: binding.id, text: "", isNew: true };
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
  if (note) article.append(createNoteElement(note, binding.id));
  const bottomControls = document.createElement("div");
  bottomControls.className = "message-edge-controls message-bottom-controls no-print";
  bottomControls.append(copyButton, noteButton);
  article.append(bottomControls);
  updateMessageAppearance(article, included);
  return article;
}

function createSectionElement(streamNode) {
  const { section, included, anchorKind } = streamNode;
  const element = document.createElement("section");
  element.className = "section-marker";
  element.classList.toggle("omitted", !included);
  element.dataset.sectionId = section.id;
  element.dataset.anchorKind = anchorKind;
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
    const rightControls = editingControls({
      canMoveUp: canMoveSection(curated, section.id, "up"),
      canMoveDown: canMoveSection(curated, section.id, "down"),
      moveUp: () => moveAndRenderSection(section.id, "up"),
      moveDown: () => moveAndRenderSection(section.id, "down"),
      remove: () => {
        removeSection(curated, section.id);
        if (!editingOriginal?.isNew) markEditorialChanged(projectSession);
        editingSectionId = null;
        editingOriginal = null;
        renderCuratedDocument();
        updateProjectState();
      },
    });
    const editorControls = document.createElement("div");
    editorControls.className = "anchor-editor-controls no-print";
    editorControls.append(createAnchorContextControls(section.id), rightControls);
    element.append(editor, editorControls);
  } else {
    const headingGroup = document.createElement("div");
    headingGroup.className = "section-heading";
    const heading = document.createElement("h2");
    heading.textContent = `§ ${section.text || "Untitled section"}`;
    const omitted = document.createElement("span");
    omitted.className = "omitted-label section-omitted-label";
    omitted.textContent = "OMITTED";
    omitted.hidden = included;
    element.tabIndex = 0;
    element.addEventListener("click", () => beginSectionEditing(section, element));
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        beginSectionEditing(section, element);
      }
    });
    headingGroup.append(heading, omitted);
    element.append(headingGroup);
  }
  return element;
}

function sectionReviewNode(section) {
  const output = anchorOutputState(curated, section.id);
  return { kind: "section", section, included: output.included, anchorKind: output.kind };
}

function createAnchorContextControls(sectionId) {
  const controls = document.createElement("div");
  controls.className = "anchor-context-controls";
  const zone = previousZoneState(curated, sectionId);
  const zoneAction = zone.state === "omitted" ? "Include previous section" : "Omit previous section";
  const zoneButton = iconButton("", zone.state === "unavailable" ? "No previous message section" : zoneAction, () => {
    if (!togglePreviousZone(curated, sectionId)) return;
    markEditorialChanged(projectSession);
    updateGlobalInclusionControl();
    updateProjectState();
    renderCuratedDocument();
  });
  zoneButton.classList.add("previous-zone-control", `zone-${zone.state}`);
  zoneButton.disabled = zone.state === "unavailable";
  zoneButton.append(createTriangleIcon(zone.state));

  const previousButton = iconButton("<", "Previous anchor", () => navigateAnchor(sectionId, "previous"));
  const nextButton = iconButton(">", "Next anchor", () => navigateAnchor(sectionId, "next"));
  const hasAdjacentAnchor = adjacentAnchorId(curated, sectionId, "previous") !== null;
  previousButton.disabled = !hasAdjacentAnchor;
  nextButton.disabled = !hasAdjacentAnchor;
  controls.append(zoneButton, previousButton, nextButton);
  return controls;
}

function createTriangleIcon(state) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 14");
  svg.setAttribute("aria-hidden", "true");
  const outline = document.createElementNS(svg.namespaceURI, "path");
  outline.setAttribute("d", "M8 1 L15 13 H1 Z");
  outline.classList.add("triangle-outline");
  svg.append(outline);
  if (state === "included") {
    outline.classList.add("triangle-filled");
  } else if (state === "mixed") {
    const fill = document.createElementNS(svg.namespaceURI, "path");
    fill.setAttribute("d", "M3.9 8 H12.1 L15 13 H1 Z");
    fill.classList.add("triangle-mixed-fill");
    svg.append(fill);
  }
  return svg;
}

function createNoteElement(note, bindingId) {
  const element = document.createElement("aside");
  element.className = "message-note";
  element.dataset.noteFor = bindingId;
  if (editingNoteMessageId === bindingId) {
    element.classList.add("editing");
    const editor = document.createElement("textarea");
    editor.className = "note-editor";
    editor.value = note.text;
    editor.placeholder = "Note about this message";
    editor.rows = 3;
    editor.setAttribute("aria-label", "Note about this message");
    editor.addEventListener("input", () => updateNote(curated, bindingId, editor.value));
    editor.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeActiveEditorInPlace(true);
      }
    });
    const controls = editingControls({
      remove: () => {
        removeNote(curated, bindingId);
        if (!editingOriginal?.isNew) markEditorialChanged(projectSession);
        editingNoteMessageId = null;
        editingOriginal = null;
        renderCuratedDocument();
        updateProjectState();
      },
    });
    element.append(editor, controls);
  } else {
    const text = document.createElement("p");
    text.textContent = note.text || "Empty note";
    element.tabIndex = 0;
    element.addEventListener("click", () => beginNoteEditing(note, bindingId, element));
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        beginNoteEditing(note, bindingId, element);
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
  markEditorialChanged(projectSession);
  updateProjectState();
  renderCuratedDocument();
}

function navigateAnchor(sectionId, direction) {
  const targetId = adjacentAnchorId(curated, sectionId, direction);
  if (!targetId) return;
  closeActiveEditorInPlace(false);
  const target = curated.editorial.nodes.find((node) => node.kind === "section" && node.id === targetId);
  const targetElement = conversation.querySelector(`[data-section-id="${CSS.escape(targetId)}"]`);
  if (!target || !targetElement) return;
  beginSectionEditing(target, targetElement);
  conversation.querySelector(`[data-section-id="${CSS.escape(targetId)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function beginDocumentHeaderEditing(element) {
  finishActiveEditing();
  editingDocumentHeader = true;
  editingDocumentHeaderDraft = curated.editorial.documentHeader;
  editingOriginal = { kind: "document-header", text: curated.editorial.documentHeader };
  element.replaceWith(createDocumentHeaderElement());
  focusActiveEditor();
}

function beginSectionEditing(section, element) {
  finishActiveEditing();
  editingSectionId = section.id;
  editingOriginal = { kind: "section", id: section.id, text: section.text, isNew: false };
  element.replaceWith(createSectionElement(sectionReviewNode(section)));
  focusActiveEditor();
}

function beginNoteEditing(note, bindingId, element) {
  finishActiveEditing();
  editingNoteMessageId = bindingId;
  editingOriginal = { kind: "note", id: bindingId, text: note.text, isNew: false };
  element.replaceWith(createNoteElement(note, bindingId));
  focusActiveEditor();
}

function closeActiveEditorInPlace(cancel) {
  const wasEditingDocumentHeader = editingDocumentHeader;
  const documentHeaderDraft = editingDocumentHeaderDraft;
  const sectionId = editingSectionId;
  const noteMessageId = editingNoteMessageId;
  const original = editingOriginal;
  const activeElement = conversation.querySelector(".document-header.editing, .section-marker.editing, .message-note.editing");
  if (cancel && original?.kind === "section" && sectionId) updateSection(curated, sectionId, original.text);
  if (cancel && original?.kind === "note" && noteMessageId) updateNote(curated, noteMessageId, original.text);
  editingDocumentHeader = false;
  editingDocumentHeaderDraft = null;
  editingSectionId = null;
  editingNoteMessageId = null;
  editingOriginal = null;

  if (wasEditingDocumentHeader) {
    const nextText = cancel ? original.text : String(documentHeaderDraft ?? "").trim();
    updateDocumentHeader(curated, nextText || original.text);
    activeElement?.replaceWith(createDocumentHeaderElement());
    if (!cancel && curated.editorial.documentHeader !== original?.text) markEditorialChanged(projectSession);
  }
  if (sectionId) {
    const section = curated.editorial.nodes.find((node) => node.kind === "section" && node.id === sectionId);
    if (section && !section.text.trim()) {
      removeSection(curated, sectionId);
      activeElement?.remove();
    } else if (section) {
      activeElement?.replaceWith(createSectionElement(sectionReviewNode(section)));
      if (!cancel && section.text !== original?.text) markEditorialChanged(projectSession);
    }
  }
  if (noteMessageId) {
    const note = bindingById(curated, noteMessageId).note;
    if (note && !note.text.trim()) {
      removeNote(curated, noteMessageId);
      enableNoteControl(activeElement?.closest("article.message"));
      activeElement?.remove();
    } else if (note) {
      activeElement?.replaceWith(createNoteElement(note, noteMessageId));
      if (!cancel && note.text !== original?.text) markEditorialChanged(projectSession);
    }
  }
  updateProjectState();
}

function enableNoteControl(article) {
  const button = article?.querySelector(".add-note-control");
  if (!button) return;
  button.disabled = false;
  button.title = "Add note to this message";
  button.setAttribute("aria-label", button.title);
}

function finishActiveEditing() {
  if (editingDocumentHeader || editingSectionId || editingNoteMessageId) closeActiveEditorInPlace(false);
}

function focusActiveEditor() {
  const selector = editingDocumentHeader ? ".document-header-editor" :
    editingSectionId ? `[data-section-id="${CSS.escape(editingSectionId)}"] .section-editor` :
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

function updateProjectState() {
  const state = projectSession ? dirtyState(projectSession) : { any: false };
  projectState.textContent = projectSession ? (state.any ? "Unsaved changes" : "Saved") : "";
  projectState.classList.toggle("dirty", state.any);
  saveProjectButton.disabled = !projectSession || !state.any;
  saveProjectAsButton.disabled = !projectSession;
}

window.addEventListener("beforeunload", (event) => {
  if (!projectSession || !dirtyState(projectSession).any) return;
  event.preventDefault();
  event.returnValue = "";
});

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
