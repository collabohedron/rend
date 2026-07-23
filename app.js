import {
  addNote,
  addSection,
  adjacentAnchorId,
  anchorOutputState,
  canMoveSection,
  copyMarkdown,
  currentZoneState,
  curatedStream,
  documentSections,
  inclusionState,
  moveSection,
  outlineSections,
  outlineTimestampParts,
  previousZoneState,
  removeNote,
  removeSection,
  safeFilename,
  setAllMessagesIncluded,
  setMessageIncluded,
  summarize,
  toggleCurrentZone,
  toggleOutlineSection,
  togglePreviousZone,
  toMarkdown,
  updateNote,
  updateSection,
} from "./document.mjs";
import { bindingById, deriveProjectDisplayTitle, updateDocumentHeader } from "./project-model.mjs";
import { createProjectSession, dirtyState, markEditorialChanged, markTranscriptChanged } from "./project-session.mjs";
import { openProject, saveProject, saveProjectAs } from "./project-file.mjs";
import { FileHandleStore } from "./save-location.mjs";
import { saveMarkdown } from "./save-markdown.mjs";
import { importTranscriptForWorkspace, retrieveShareTranscript } from "./transcript-import.mjs";
import { prepareWorkspaceSwitch } from "./workspace-switch.mjs";

const form = document.querySelector("#import-form");
const openButton = document.querySelector("#open-project");
const status = document.querySelector("#status");
const conversation = document.querySelector("#conversation");
const summaryPanel = document.querySelector("#summary-panel");
const importSummary = document.querySelector("#import-summary");
const validation = document.querySelector("#validation");
const documentActions = document.querySelector("#document-actions");
const includeAll = document.querySelector("#include-all");
const copyDocumentButton = document.querySelector("#copy-document");
const switchViewsButton = document.querySelector("#switch-views");
const projectState = document.querySelector("#project-state");
const saveProjectButton = document.querySelector("#save-project");
const saveProjectAsButton = document.querySelector("#save-project-as");
const saveButton = document.querySelector("#save-markdown");
const printButton = document.querySelector("#print-selected");
const safetyRecommendation = document.querySelector("#safety-recommendation");
const dismissSafetyRecommendation = document.querySelector("#dismiss-safety-recommendation");
const workspaceSwitchDialog = document.querySelector("#workspace-switch-dialog");
const handleStore = new FileHandleStore();
let curated = null;
let projectSession = null;
let editingDocumentHeader = false;
let editingDocumentHeaderDraft = null;
let editingSectionId = null;
let editingNoteMessageId = null;
let editingOriginal = null;
let viewMode = "transcript";
let currentSectionId = "document-header";
let expandedOutlineSections = new Set();
let statusTimer = null;
let transcriptScrollFrame = null;
const copyFeedbackTimers = new WeakMap();

configureCopyControl(copyDocumentButton, "Copy Document", () => toMarkdown(curated));
configureOutlineIconButton(switchViewsButton, "Switch Views", toggleViews);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showStatus("Importing...");
  try {
    const snapshot = await retrieveShareTranscript(new FormData(form).get("url"));
    const imported = await importTranscriptForWorkspace(curated, snapshot.document, { sourceUrl: snapshot.source_url });
    if (imported.outcome === "matching-transcript") {
      if (imported.transcriptChanged) markTranscriptChanged(projectSession);
      activateWorkspace(curated, projectSession);
      showStatus(matchingImportStatus(imported), true);
      return;
    }
    const workspace = await prepareWorkspaceSwitch(projectSession, {
      choose: chooseWorkspaceSwitch,
      save: () => saveCurrentProject(false),
    });
    if (!workspace.proceed) {
      showStatus("Import cancelled; current project unchanged.", true);
      return;
    }
    const nextSession = createProjectSession(imported.project);
    activateWorkspace(imported.project, nextSession);
    showStatus(imported.outcome === "different-transcript" ? "Different transcript opened as a new project." : "Import complete.", true);
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Import failed");
  }
});

openButton.addEventListener("click", async () => {
  try {
    const result = await openProject({ windowObject: window, documentObject: document });
    if (result.method === "cancelled") return;
    const workspace = await prepareWorkspaceSwitch(projectSession, {
      choose: chooseWorkspaceSwitch,
      save: () => saveCurrentProject(false),
    });
    if (!workspace.proceed) {
      showStatus("Open cancelled; current project unchanged.", true);
      return;
    }
    const nextSession = createProjectSession(result.project, {
      persisted: true,
      handle: result.handle,
      archiveDigest: result.archiveDigest,
    });
    activateWorkspace(result.project, nextSession);
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
document.addEventListener("keydown", handleTranscriptNavigation);
window.addEventListener("scroll", scheduleCurrentSectionUpdate, { passive: true });
window.addEventListener("resize", scheduleCurrentSectionUpdate);

async function saveCurrentProject(asNew) {
  if (!projectSession) return false;
  finishActiveEditing();
  updateProjectState();
  try {
    const result = await (asNew ? saveProjectAs : saveProject)(projectSession, {
      windowObject: window,
      documentObject: document,
    });
    if (result.method === "cancelled") {
      showStatus("Project save cancelled.", true);
      return false;
    }
    curated = projectSession.project;
    updateProjectState();
    showStatus(result.method === "download" ? "Rend project download started." : "Project saved.", true);
    return true;
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Could not save project.");
    return false;
  }
}

function activateWorkspace(project, session) {
  const workspaceChanged = curated !== project || projectSession !== session;
  curated = project;
  projectSession = session;
  clearEditingState();
  viewMode = "transcript";
  currentSectionId = "document-header";
  if (workspaceChanged) expandedOutlineSections = new Set();
  renderSummary(project.transcript.document);
  renderCuratedDocument();
  updateGlobalInclusionControl();
  updateProjectState();
  summaryPanel.hidden = false;
  documentActions.hidden = false;
}

function matchingImportStatus(imported) {
  if (imported.comparison === "prefix") {
    const suffix = imported.appendedMessageCount === 1 ? "" : "s";
    return `${imported.appendedMessageCount} new message${suffix} appended.`;
  }
  return imported.transcriptChanged ? "Matching transcript refreshed." : "Transcript already current.";
}

function chooseWorkspaceSwitch() {
  return new Promise((resolve) => {
    workspaceSwitchDialog.returnValue = "cancel";
    const cancel = () => { workspaceSwitchDialog.returnValue = "cancel"; };
    const close = () => {
      workspaceSwitchDialog.removeEventListener("cancel", cancel);
      resolve(new Set(["save", "discard", "cancel"]).has(workspaceSwitchDialog.returnValue) ? workspaceSwitchDialog.returnValue : "cancel");
    };
    workspaceSwitchDialog.addEventListener("cancel", cancel, { once: true });
    workspaceSwitchDialog.addEventListener("close", close, { once: true });
    workspaceSwitchDialog.showModal();
  });
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
  conversation.classList.toggle("outline-active", viewMode === "outline");
  conversation.append(createDocumentHeaderElement());
  const transcript = document.createElement("div");
  transcript.className = "transcript-presentation";
  for (const node of curatedStream(curated, { includeOmitted: true })) {
    transcript.append(node.kind === "section" ? createSectionElement(node) : createMessageElement(node));
  }
  conversation.append(transcript);
  if (viewMode === "outline") conversation.append(createOutlinePresentation());
  focusActiveEditor();
  if (viewMode === "transcript") scheduleCurrentSectionUpdate();
}

function createDocumentHeaderElement() {
  const heading = document.createElement("h1");
  heading.className = "document-header";
  heading.dataset.sectionId = "document-header";
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
    const text = document.createElement("span");
    text.className = "document-header-text";
    text.textContent = deriveProjectDisplayTitle(curated);
    heading.tabIndex = 0;
    heading.addEventListener("click", () => beginDocumentHeaderEditing(heading));
    heading.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        beginDocumentHeaderEditing(heading);
      }
    });
    heading.append(text);
  }
  heading.append(createOutlineButton("document-header"));
  return heading;
}

function createOutlinePresentation() {
  const outline = document.createElement("section");
  outline.className = "outline-presentation";
  outline.setAttribute("aria-label", "Document outline");
  for (const section of outlineSections(curated)) outline.append(createOutlineRow(section));
  return outline;
}

function createOutlineRow(section) {
  const row = document.createElement("article");
  row.className = "outline-row";
  row.classList.toggle("selected", section.openerId === currentSectionId);
  row.classList.toggle("omitted", section.state === "omitted");
  row.dataset.outlineSectionId = section.openerId;
  if (section.openerId === currentSectionId) row.setAttribute("aria-current", "true");
  row.addEventListener("click", (event) => {
    if (event.target.closest("button, input, a, textarea, select")) return;
    selectOutlineRow(row, section.openerId);
  });

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = section.state !== "omitted";
  checkbox.indeterminate = section.state === "mixed";
  checkbox.disabled = !section.available;
  checkbox.title = section.available ? sectionToggleAction(section.state) : "This section contains no messages";
  checkbox.setAttribute("aria-label", checkbox.title);
  checkbox.addEventListener("change", () => {
    if (!toggleOutlineSection(curated, section.openerId)) return;
    currentSectionId = section.openerId;
    markEditorialChanged(projectSession);
    updateGlobalInclusionControl();
    updateProjectState();
    renderCuratedDocument();
  });

  const content = document.createElement("div");
  content.className = "outline-row-content";
  const title = document.createElement("h2");
  title.textContent = section.openerKind === "header" ? section.title : `§ ${section.title || "Untitled section"}`;
  content.append(title);
  if (section.messageBindingIds.length > 0) content.append(createOutlineAnalytics(section));
  if (section.analytics.annotationCount > 0 && expandedOutlineSections.has(section.openerId)) {
    content.append(createOutlineAnnotations(section));
  }
  const copySectionButton = createCopyControl("Copy Section", () => {
    selectOutlineRow(row, section.openerId);
    return toMarkdown(curated, { sectionId: section.openerId });
  });
  const returnButton = outlineIconButton("Switch Views", () => returnToTranscript(section.openerId));
  row.append(checkbox, copySectionButton, returnButton, content);
  return row;
}

function selectOutlineRow(row, sectionId) {
  currentSectionId = sectionId;
  const previous = conversation.querySelector(".outline-row.selected");
  previous?.classList.remove("selected");
  previous?.removeAttribute("aria-current");
  row.classList.add("selected");
  row.setAttribute("aria-current", "true");
}

function createOutlineAnalytics(section) {
  const analytics = document.createElement("div");
  analytics.className = "outline-analytics";
  const counts = document.createElement("p");
  const user = document.createElement("strong");
  user.textContent = "User";
  const assistant = document.createElement("strong");
  assistant.textContent = "Assistant";
  counts.append(
    `${formatCount(section.analytics.messageCount, "message")}. `,
    user,
    ` ${formatCount(section.analytics.userWordCount, "word")} • `,
    assistant,
    ` ${formatCount(section.analytics.assistantWordCount, "word")}`,
  );
  analytics.append(counts);

  const timestamp = outlineTimestampParts(section.analytics);
  if (timestamp) {
    const time = document.createElement("p");
    const spanLabel = document.createElement("strong");
    spanLabel.textContent = "Span";
    time.append(spanLabel, ` ${timestamp.range}`);
    if (timestamp.duration) {
      const durationLabel = document.createElement("strong");
      durationLabel.textContent = "Duration";
      time.append(" • ", durationLabel, ` ${timestamp.duration}`);
    }
    analytics.append(time);
  }

  if (section.analytics.annotationCount > 0) {
    const expanded = expandedOutlineSections.has(section.openerId);
    const disclosure = document.createElement("button");
    disclosure.type = "button";
    disclosure.className = "outline-annotation-toggle";
    disclosure.textContent = formatCount(section.analytics.annotationCount, "annotation");
    disclosure.setAttribute("aria-expanded", String(expanded));
    disclosure.title = expanded ? "Hide annotations" : "Show annotations";
    disclosure.addEventListener("click", () => {
      if (expanded) expandedOutlineSections.delete(section.openerId);
      else expandedOutlineSections.add(section.openerId);
      renderCuratedDocument();
    });
    analytics.append(disclosure);
  }
  return analytics;
}

function createOutlineAnnotations(section) {
  const list = document.createElement("ul");
  list.className = "outline-annotations";
  for (const annotation of section.analytics.annotations) {
    const item = document.createElement("li");
    const link = document.createElement("button");
    link.type = "button";
    link.className = "outline-annotation-link";
    link.title = "View source message in Transcript View";
    const text = document.createElement("span");
    text.textContent = annotation.note.text;
    const source = document.createElement("span");
    source.className = "outline-annotation-source";
    source.textContent = "View source message";
    link.append(text, source);
    link.addEventListener("click", () => returnToMessage(section.openerId, annotation.bindingId));
    item.append(link);
    list.append(item);
  }
  return list;
}

function formatCount(value, noun) {
  return `${value.toLocaleString()} ${noun}${value === 1 ? "" : "s"}`;
}

function createMessageElement(node) {
  const { message, binding, included, note } = node;
  const article = document.createElement("article");
  article.className = "message";
  article.dataset.messageId = binding.id;
  article.tabIndex = -1;

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

  const copyButton = createCopyControl("Copy Message", () => copyMarkdown(message));
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
  const { section, included } = streamNode;
  const element = document.createElement("section");
  element.className = "section-marker";
  element.classList.toggle("omitted", !included);
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
    omitted.className = "omitted-label";
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
  return { kind: "section", section, included: output.included };
}

function createAnchorContextControls(sectionId) {
  const controls = document.createElement("div");
  controls.className = "anchor-context-controls";
  const previousZone = previousZoneState(curated, sectionId);
  const previousButton = iconButton("", previousZone.state === "unavailable" ? "No previous message section" : sectionToggleAction(previousZone.state, "previous"), () => {
    if (!togglePreviousZone(curated, sectionId)) return;
    markEditorialChanged(projectSession);
    refreshAfterInclusionChange();
  });
  previousButton.classList.add("previous-zone-control");
  previousButton.disabled = previousZone.state === "unavailable";
  previousButton.append(createTriangleIcon(previousZone.state, "up"));

  const currentZone = currentZoneState(curated, sectionId);
  const currentButton = iconButton("", currentZone.state === "unavailable" ? "This section contains no messages" : sectionToggleAction(currentZone.state, "current"), () => {
    if (!toggleCurrentZone(curated, sectionId)) return;
    markEditorialChanged(projectSession);
    refreshAfterInclusionChange();
  });
  currentButton.classList.add("current-zone-control");
  currentButton.disabled = currentZone.state === "unavailable";
  currentButton.append(createTriangleIcon(currentZone.state, "down"));

  const navigatePreviousButton = iconButton("<", "Previous anchor", () => navigateAnchor(sectionId, "previous"));
  const navigateNextButton = iconButton(">", "Next anchor", () => navigateAnchor(sectionId, "next"));
  navigatePreviousButton.classList.add("anchor-navigation-control");
  navigateNextButton.classList.add("anchor-navigation-control");
  const hasAdjacentAnchor = adjacentAnchorId(curated, sectionId, "previous") !== null;
  navigatePreviousButton.disabled = !hasAdjacentAnchor;
  navigateNextButton.disabled = !hasAdjacentAnchor;
  controls.append(previousButton, currentButton, createOutlineButton(sectionId), navigatePreviousButton, navigateNextButton);
  return controls;
}

function createTriangleIcon(state, direction) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 14");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add(`triangle-${direction}`);
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

function createOutlineButton(sectionId) {
  return outlineIconButton("Switch Views", () => switchViewsAt(sectionId));
}

function outlineIconButton(title, handler) {
  const button = document.createElement("button");
  button.type = "button";
  return configureOutlineIconButton(button, title, handler);
}

function configureOutlineIconButton(button, title, handler) {
  button.replaceChildren();
  button.classList.add("icon-button");
  button.title = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    handler(event);
  });
  button.classList.add("outline-entry-control", "no-print");
  button.addEventListener("pointerdown", (event) => event.stopPropagation());
  const symbol = document.createElement("span");
  symbol.className = "outline-symbol";
  symbol.setAttribute("aria-hidden", "true");
  button.append(symbol);
  return button;
}

function sectionToggleAction(state, position = null) {
  const action = state === "omitted" ? "Include" : "Omit";
  return position ? `${action} ${position} section` : `${action} this section`;
}

function refreshAfterInclusionChange() {
  updateGlobalInclusionControl();
  updateProjectState();
  renderCuratedDocument();
}

function toggleViews() {
  if (!curated) return;
  if (viewMode === "transcript") syncCurrentSectionFromViewport();
  switchViewsAt(currentSectionId);
}

function switchViewsAt(sectionId) {
  if (viewMode === "outline") returnToTranscript(sectionId);
  else enterOutline(sectionId);
}

function enterOutline(sectionId = currentSectionId) {
  finishActiveEditing();
  currentSectionId = sectionId;
  viewMode = "outline";
  renderCuratedDocument();
  conversation.querySelector(`[data-outline-section-id="${CSS.escape(sectionId)}"]`)?.scrollIntoView({ block: "center" });
}

function returnToTranscript(sectionId) {
  currentSectionId = sectionId;
  viewMode = "transcript";
  renderCuratedDocument();
  scrollTranscriptTarget(transcriptSectionElement(sectionId), 0);
}

function returnToMessage(sectionId, bindingId) {
  currentSectionId = sectionId;
  viewMode = "transcript";
  renderCuratedDocument();
  const message = conversation.querySelector(`[data-message-id="${CSS.escape(bindingId)}"]`);
  const target = message?.querySelector(".message-note") || message;
  target?.focus({ preventScroll: true });
  target?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function scheduleCurrentSectionUpdate() {
  if (transcriptScrollFrame !== null) return;
  transcriptScrollFrame = window.requestAnimationFrame(() => {
    transcriptScrollFrame = null;
    syncCurrentSectionFromViewport();
  });
}

function syncCurrentSectionFromViewport() {
  if (!curated || viewMode !== "transcript") return currentSectionId;
  const visibleTop = transcriptVisibleTop();
  let current = "document-header";
  const anchors = conversation.querySelectorAll(".document-header, .transcript-presentation .section-marker");
  for (const anchor of anchors) {
    if (anchor.getBoundingClientRect().top > visibleTop + 1) break;
    current = anchor.dataset.sectionId || "document-header";
  }
  currentSectionId = current;
  return current;
}

function transcriptVisibleTop() {
  if (documentActions.hidden) return 0;
  const sticky = documentActions.getBoundingClientRect();
  return Math.max(0, sticky.height);
}

function scrollTranscriptTarget(target, gap = 12) {
  if (!target) return;
  const top = window.scrollY + target.getBoundingClientRect().top - transcriptVisibleTop() + gap;
  window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

function handleTranscriptNavigation(event) {
  if (!curated || event.defaultPrevented) return;
  const navigation = transcriptNavigationShortcut(event);
  const editingTranscriptText = isTranscriptTextEditor(event.target);
  const allowedEditorShortcut = editingTranscriptText && navigation;
  if (isTextEntryTarget(event.target) && !allowedEditorShortcut) return;
  if (event.key === "\\" && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
    event.preventDefault();
    toggleViews();
    return;
  }
  if (viewMode !== "transcript" || !navigation) return;
  event.preventDefault();
  const direction = event.key === "ArrowUp" ? "previous" : "next";
  if (navigation === "message") navigateTranscriptMessage(direction);
  else navigateTranscriptSection(direction);
}

function transcriptNavigationShortcut(event) {
  if ((event.key !== "ArrowUp" && event.key !== "ArrowDown") || event.altKey || event.metaKey) return null;
  if (event.shiftKey && !event.ctrlKey) return "message";
  if (event.ctrlKey && !event.shiftKey) return "section";
  return null;
}

function isTranscriptTextEditor(target) {
  return target instanceof Element && Boolean(target.closest(".document-header-editor, .section-editor, .note-editor"));
}

function isTextEntryTarget(target) {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function navigateTranscriptMessage(direction) {
  const messages = [...conversation.querySelectorAll(".transcript-presentation article.message")];
  if (!messages.length) return;
  const visibleTop = transcriptVisibleTop();
  const containingIndex = messages.findIndex((message) => {
    const bounds = message.getBoundingClientRect();
    return bounds.top <= visibleTop + 1 && bounds.bottom > visibleTop + 1;
  });
  let targetIndex = -1;
  if (containingIndex >= 0) {
    targetIndex = containingIndex + (direction === "previous" ? -1 : 1);
  } else if (direction === "next") {
    targetIndex = messages.findIndex((message) => message.getBoundingClientRect().top > visibleTop);
  } else {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].getBoundingClientRect().bottom <= visibleTop + 1) {
        targetIndex = index;
        break;
      }
    }
  }
  const target = messages[targetIndex];
  if (!target) return;
  finishActiveEditing();
  currentSectionId = sectionForMessageBinding(target.dataset.messageId);
  scrollTranscriptTarget(target);
}

function navigateTranscriptSection(direction) {
  const activeTitleEditor = conversation.querySelector(".document-header-editor, .section-editor");
  if (activeTitleEditor) {
    currentSectionId = activeTitleEditor.closest("[data-section-id]")?.dataset.sectionId || currentSectionId;
  } else {
    syncCurrentSectionFromViewport();
  }
  const sectionIds = documentSections(curated).map((section) => section.openerId);
  const currentIndex = sectionIds.indexOf(currentSectionId);
  const targetIndex = currentIndex + (direction === "previous" ? -1 : 1);
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= sectionIds.length) return;
  currentSectionId = sectionIds[targetIndex];
  activateTranscriptSection(currentSectionId);
}

function sectionForMessageBinding(bindingId) {
  return documentSections(curated).find((section) => section.messageBindingIds.includes(bindingId))?.openerId || "document-header";
}

function transcriptSectionElement(sectionId) {
  return sectionId === "document-header"
    ? conversation.querySelector(".document-header")
    : conversation.querySelector(`[data-section-id="${CSS.escape(sectionId)}"]`);
}

function activateTranscriptSection(sectionId) {
  const target = transcriptSectionElement(sectionId);
  if (!target) return;
  if (sectionId === "document-header") {
    beginDocumentHeaderEditing(target);
  } else {
    const section = curated.editorial.nodes.find((node) => node.kind === "section" && node.id === sectionId);
    if (!section) return;
    beginSectionEditing(section, target);
  }
  scrollTranscriptTarget(transcriptSectionElement(sectionId), 0);
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
  currentSectionId = targetId;
  beginSectionEditing(target, targetElement);
  scrollTranscriptTarget(conversation.querySelector(`[data-section-id="${CSS.escape(targetId)}"]`), 0);
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
  clearEditingState();

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

function clearEditingState() {
  editingDocumentHeader = false;
  editingDocumentHeaderDraft = null;
  editingSectionId = null;
  editingNoteMessageId = null;
  editingOriginal = null;
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

function createCopyControl(title, markdownProvider) {
  const button = document.createElement("button");
  button.type = "button";
  return configureCopyControl(button, title, markdownProvider);
}

function configureCopyControl(button, title, markdownProvider) {
  button.classList.add("icon-button");
  button.title = title;
  button.setAttribute("aria-label", title);
  renderCopyControl(button, "idle");
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(await markdownProvider());
      showCopyFeedback(button, "success", 1000);
    } catch {
      showCopyFeedback(button, "failure", 2000);
    }
  });
  return button;
}

function showCopyFeedback(button, state, duration) {
  const previousTimer = copyFeedbackTimers.get(button);
  if (previousTimer) window.clearTimeout(previousTimer);
  renderCopyControl(button, state);
  copyFeedbackTimers.set(button, window.setTimeout(() => {
    renderCopyControl(button, "idle");
    copyFeedbackTimers.delete(button);
  }, duration));
}

function renderCopyControl(button, state) {
  button.replaceChildren();
  if (state !== "idle") {
    const feedback = document.createElement("span");
    feedback.className = `copy-feedback copy-${state}`;
    feedback.textContent = state === "success" ? "✓" : "✖";
    feedback.setAttribute("aria-hidden", "true");
    button.append(feedback);
    return;
  }
  const symbol = document.createElement("span");
  symbol.className = "copy-symbol";
  symbol.setAttribute("aria-hidden", "true");
  button.append(symbol);
}

function textButton(label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}
