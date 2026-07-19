import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  addNote,
  addSection,
  adjacentAnchorId,
  anchorOutputState,
  canMoveSection,
  copyMarkdown,
  curatedStream,
  inclusionState,
  messageMarkdown,
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
} from "../document.mjs";
import { createProject, projectFromContainer, serializeEditorialOverlay, updateDocumentHeader } from "../project-model.mjs";

const source = {
  title: "Curated Fixture",
  messages: [
    {
      id: "user-1", author: "user",
      markdown: "# Existing heading\n\n- one\n- two\n\n> quote\n\n[link](https://example.com)",
      attachments: [], citations: [], content_references: [],
    },
    {
      id: "assistant-1", author: "assistant",
      markdown: "Use `code`.\n\n```js\nconsole.log(1);\n```",
      attachments: [{ id: "file_1", filename: "image.png", mime_type: "image/png", size_bytes: 42, width: 10, height: 20, reference: "sediment://file_1" }],
      citations: [{ url: "https://example.com" }], content_references: [{ type: "webpage" }],
    },
    { id: "user-2", author: "user", markdown: "Last message.", attachments: [], citations: [], content_references: [] },
  ],
};

async function makeProject() {
  return createProject(source, { sourceUrl: "https://chatgpt.com/share/fixture" });
}

function bindingId(project, sourceId) {
  return project.editorial.messageBindings.find((binding) => binding.sourceMessageId === sourceId).id;
}

test("all messages are included by default and global state is tri-state", async () => {
  const curated = await makeProject();
  assert.equal(inclusionState(curated), "all");
  assert.deepEqual(curated.editorial.messageBindings.map((binding) => binding.included), [true, true, true]);
  setMessageIncluded(curated, bindingId(curated, "assistant-1"), false);
  assert.equal(inclusionState(curated), "mixed");
  setAllMessagesIncluded(curated, false);
  assert.equal(inclusionState(curated), "none");
  setAllMessagesIncluded(curated, true);
  assert.equal(inclusionState(curated), "all");
});

test("omitted messages are excluded from Markdown and curated print stream", async () => {
  const curated = await makeProject();
  setMessageIncluded(curated, bindingId(curated, "assistant-1"), false);
  assert.ok(!toMarkdown(curated).includes("console.log"));
  const printableIds = curatedStream(curated).filter((node) => node.kind === "message").map((node) => node.message.id);
  assert.deepEqual(printableIds, ["user-1", "user-2"]);
});

test("authorship, source Markdown, and message order are preserved", async () => {
  const markdown = toMarkdown(await makeProject());
  assert.ok(markdown.startsWith("# Curated Fixture\n\n## USER\n\n# Existing heading"));
  assert.ok(markdown.indexOf("## USER") < markdown.indexOf("## ASSISTANT"));
  assert.ok(markdown.indexOf("## ASSISTANT") < markdown.lastIndexOf("## USER"));
  assert.ok(markdown.includes("```js\nconsole.log(1);\n```"));
  assert.ok(markdown.includes("[link](https://example.com)"));
});

test("copy returns only the selected original message body", () => {
  const copied = copyMarkdown(source.messages[1]);
  assert.equal(copied, source.messages[1].markdown);
  assert.ok(!copied.includes("ASSISTANT"));
  assert.ok(!copied.includes("Attachments"));
});

test("section markers are first-class nodes inserted before a selected message", async () => {
  const curated = await makeProject();
  const section = addSection(curated, bindingId(curated, "assistant-1"), "Lock Rule Redesign");
  assert.equal("included" in section, false);
  const nodes = curatedStream(curated, { includeOmitted: true });
  assert.deepEqual(nodes.slice(1, 3).map((node) => node.kind === "message" ? node.message.id : node.section.id), [section.id, "assistant-1"]);
  const markdown = toMarkdown(curated);
  assert.ok(markdown.includes("## Lock Rule Redesign"));
  assert.ok(markdown.indexOf("## Lock Rule Redesign") < markdown.indexOf("## ASSISTANT"));
  updateSection(curated, section.id, "Edited section");
  assert.ok(toMarkdown(curated).includes("## Edited section"));
  removeSection(curated, section.id);
  assert.ok(!toMarkdown(curated).includes("Lock Rule Redesign"));
});

test("bounding anchors derive output inclusion from their following message zone", async () => {
  const curated = await makeProject();
  const section = addSection(curated, bindingId(curated, "assistant-1"), "Derived Section");
  assert.deepEqual(anchorOutputState(curated, section.id), {
    kind: "bounding", included: true,
    messageBindingIds: [bindingId(curated, "assistant-1"), bindingId(curated, "user-2")],
  });
  setMessageIncluded(curated, bindingId(curated, "assistant-1"), false);
  assert.equal(anchorOutputState(curated, section.id).included, true, "mixed zones retain their bounding anchor");
  setMessageIncluded(curated, bindingId(curated, "user-2"), false);
  assert.equal(anchorOutputState(curated, section.id).included, false, "fully omitted zones omit their bounding anchor");
  assert.ok(!toMarkdown(curated).includes("Derived Section"));
  assert.equal(curatedStream(curated, { includeOmitted: true }).find((node) => node.kind === "section").included, false);
});

test("consecutive anchors produce islands followed by a bounding anchor", async () => {
  const curated = await makeProject();
  const first = addSection(curated, bindingId(curated, "assistant-1"), "Island");
  const second = addSection(curated, bindingId(curated, "assistant-1"), "Bounding");
  assert.deepEqual(anchorOutputState(curated, first.id), { kind: "island", included: true, messageBindingIds: [] });
  assert.equal(anchorOutputState(curated, second.id).kind, "bounding");
  setMessageIncluded(curated, bindingId(curated, "assistant-1"), false);
  setMessageIncluded(curated, bindingId(curated, "user-2"), false);
  const markdown = toMarkdown(curated);
  assert.ok(markdown.includes("## Island"));
  assert.ok(!markdown.includes("## Bounding"));
});

test("moving an anchor dynamically changes island and bounding classification", async () => {
  const curated = await makeProject();
  const first = addSection(curated, bindingId(curated, "assistant-1"), "First");
  const second = addSection(curated, bindingId(curated, "assistant-1"), "Second");
  assert.equal(anchorOutputState(curated, first.id).kind, "island");
  moveSection(curated, first.id, "down");
  assert.equal(anchorOutputState(curated, first.id).kind, "bounding");
  assert.equal(anchorOutputState(curated, second.id).kind, "bounding");
});

test("previous-section state respects anchor boundaries and normalizes mixed zones to omitted", async () => {
  const curated = await makeProject();
  const section = addSection(curated, bindingId(curated, "user-2"), "Current");
  assert.equal(previousZoneState(curated, section.id).state, "included");
  setMessageIncluded(curated, bindingId(curated, "assistant-1"), false);
  assert.equal(previousZoneState(curated, section.id).state, "mixed");
  assert.equal(togglePreviousZone(curated, section.id), true);
  assert.deepEqual(previousZoneState(curated, section.id), {
    state: "omitted", messageBindingIds: [bindingId(curated, "user-1"), bindingId(curated, "assistant-1")],
  });
  togglePreviousZone(curated, section.id);
  assert.equal(previousZoneState(curated, section.id).state, "included");
  togglePreviousZone(curated, section.id);
  assert.equal(previousZoneState(curated, section.id).state, "omitted");
});

test("previous-section control is unavailable without an immediately preceding message zone", async () => {
  const curated = await makeProject();
  const first = addSection(curated, bindingId(curated, "user-1"), "First");
  const island = addSection(curated, bindingId(curated, "user-1"), "Island");
  assert.equal(previousZoneState(curated, first.id).state, "unavailable");
  assert.equal(previousZoneState(curated, island.id).state, "unavailable");
  assert.equal(togglePreviousZone(curated, island.id), false);
  assert.equal(anchorOutputState(curated, first.id).included, true);
});

test("anchor navigation wraps through island and bounding anchors", async () => {
  const curated = await makeProject();
  const first = addSection(curated, bindingId(curated, "assistant-1"), "Island");
  assert.equal(adjacentAnchorId(curated, first.id, "next"), null);
  const second = addSection(curated, bindingId(curated, "assistant-1"), "Bounding");
  const third = addSection(curated, bindingId(curated, "user-2"), "Final");
  assert.equal(adjacentAnchorId(curated, first.id, "previous"), third.id);
  assert.equal(adjacentAnchorId(curated, first.id, "next"), second.id);
  assert.equal(adjacentAnchorId(curated, third.id, "next"), first.id);
});

test("section markers move without changing imported message order", async () => {
  const curated = await makeProject();
  const section = addSection(curated, bindingId(curated, "assistant-1"), "Movable");
  assert.equal(canMoveSection(curated, section.id, "up"), true);
  moveSection(curated, section.id, "up");
  assert.deepEqual(curatedStream(curated, { includeOmitted: true }).map((node) => node.kind === "message" ? node.message.id : "section"), ["section", "user-1", "assistant-1", "user-2"]);
  moveSection(curated, section.id, "down");
  moveSection(curated, section.id, "down");
  assert.deepEqual(curatedStream(curated, { includeOmitted: true }).map((node) => node.kind === "message" ? node.message.id : "section"), ["user-1", "assistant-1", "section", "user-2"]);
  assert.deepEqual(curated.transcript.document.messages.map((message) => message.id), ["user-1", "assistant-1", "user-2"]);
});

test("a note belongs to its message and exports immediately after it", async () => {
  const curated = await makeProject();
  const assistantBinding = bindingId(curated, "assistant-1");
  const note = addNote(curated, assistantBinding, "Settled here.\nKeep child rules.");
  const messageNode = curatedStream(curated, { includeOmitted: true }).find((node) => node.kind === "message" && node.message.id === "assistant-1");
  assert.equal(messageNode.note, note);
  let markdown = toMarkdown(curated);
  assert.ok(markdown.includes("> **Note**\n>\n> Settled here.\n> Keep child rules."));
  assert.ok(markdown.indexOf("### Attachments") < markdown.indexOf("> **Note**"));
  assert.ok(markdown.indexOf("> **Note**") < markdown.lastIndexOf("## USER"));
  updateNote(curated, assistantBinding, "Edited note");
  assert.ok(toMarkdown(curated).includes("> Edited note"));
  removeNote(curated, assistantBinding);
  assert.ok(!toMarkdown(curated).includes("Edited note"));
});

test("omitting a message omits its note while mixed-zone anchors remain", async () => {
  const curated = await makeProject();
  const assistantBinding = bindingId(curated, "assistant-1");
  addSection(curated, assistantBinding, "Still exported");
  addNote(curated, assistantBinding, "Attached note");
  setMessageIncluded(curated, assistantBinding, false);
  let markdown = toMarkdown(curated);
  assert.ok(markdown.includes("Still exported"));
  assert.ok(!markdown.includes("Attached note"));
  setAllMessagesIncluded(curated, false);
  markdown = toMarkdown(curated);
  assert.ok(!markdown.includes("Still exported"));
  assert.ok(!markdown.includes("Last message"));
});

test("document header edits affect Markdown and filenames without joining the anchor stream", async () => {
  const curated = await makeProject();
  updateDocumentHeader(curated, "Edited document");
  addSection(curated, bindingId(curated, "user-1"), "Leading anchor");
  assert.ok(toMarkdown(curated).startsWith("# Edited document\n\n## Leading anchor"));
  assert.equal(safeFilename(curated.editorial.documentHeader), "Edited document.md");
  assert.equal(curatedStream(curated, { includeOmitted: true }).filter((node) => node.kind === "section").length, 1);
});

test("save/open preserves sparse state and reproduces identical derived output", async () => {
  const curated = await makeProject();
  updateDocumentHeader(curated, "Saved header");
  const island = addSection(curated, bindingId(curated, "assistant-1"), "Island");
  const bounding = addSection(curated, bindingId(curated, "assistant-1"), "Bounding");
  setMessageIncluded(curated, bindingId(curated, "assistant-1"), false);
  setMessageIncluded(curated, bindingId(curated, "user-2"), false);
  const markdown = toMarkdown(curated);
  const overlay = serializeEditorialOverlay(curated);
  assert.equal("included" in overlay.sections[0], false);
  const reopened = projectFromContainer({
    manifest: {
      format: "rend-project", manifestVersion: 1, projectId: curated.id,
      createdAt: curated.createdAt, savedAt: "2026-07-18T01:00:00.000Z", saveGeneration: 1,
    },
    transcript: curated.transcript,
    editorial: overlay,
  });
  assert.equal(reopened.editorial.documentHeader, "Saved header");
  assert.equal(anchorOutputState(reopened, island.id).kind, "island");
  assert.equal(anchorOutputState(reopened, bounding.id).included, false);
  assert.equal(toMarkdown(reopened), markdown);
});

test("summary and attachment metadata remain exact", () => {
  assert.deepEqual(summarize(source), { title: "Curated Fixture", totalMessages: 3, userMessages: 2, assistantMessages: 1, messagesWithMarkdown: 3, attachments: 1, citations: 1, contentReferences: 1 });
  assert.ok(messageMarkdown(source.messages[1]).includes("sediment://file_1"));
  assert.equal(safeFilename("A: conversation?"), "A- conversation-.md");
  assert.equal(safeFilename("NUL"), "_NUL.md");
  assert.equal(safeFilename("draft. "), "draft.md");
  assert.equal(safeFilename("a/b\\c:d*e?f\"g<h>i|j"), "a-b-c-d-e-f-g-h-i-j.md");
});

test("message body has no inclusion click handler", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(app, /checkbox\.addEventListener\("change"/);
  assert.doesNotMatch(app, /article\.addEventListener\("click"/);
});

test("notes render inside their message and compact controls have tooltips", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(app, /article\.append\(createNoteElement\(note, binding\.id\)\)/);
  assert.match(app, /Copy message Markdown/);
  assert.match(app, /Add section marker before this message/);
  assert.match(app, /Add note to this message/);
  assert.match(app, /Include this message in printouts and Markdown exports\./);
});

test("annotation editing uses click, outside commit, Escape cancel, and no Done control", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.doesNotMatch(app, /Click to edit section marker/);
  assert.doesNotMatch(app, /Click to edit note/);
  assert.match(app, /document\.addEventListener\("pointerdown"/);
  assert.match(app, /event\.key === "Escape"/);
  assert.doesNotMatch(app, /textButton\("Done"/);
  assert.match(app, /iconButton\("↑"/);
  assert.match(app, /iconButton\("↓"/);
  assert.match(app, /iconButton\("✕"/);
  assert.match(app, /\[data-section-id=.*\.section-editor/);
});

test("message controls are page furniture and omitted hover keeps controls usable", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css, /article\.message \{ position: relative/);
  assert.match(css, /\.message-edge-controls \{ position: absolute/);
  assert.match(css, /\.message-top-controls \{ top:/);
  assert.match(css, /\.message-bottom-controls \{ bottom:/);
  assert.match(css, /\.omitted:hover \.message-edge-controls/);
  assert.match(css, /\.omitted:hover \.message-included/);
});

test("message controls occupy four semantic edge regions", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(app, /message-top-controls/);
  assert.match(app, /topControls\.append\(checkbox, sectionButton\)/);
  assert.match(app, /message-bottom-controls/);
  assert.match(app, /bottomControls\.append\(copyButton, noteButton\)/);
  assert.match(app, /copy-symbol/);
});

test("anchor editor has derived section-state and wrapping navigation controls", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(app, /anchor-context-controls/);
  assert.match(app, /Include previous section/);
  assert.match(app, /Omit previous section/);
  assert.match(app, /createTriangleIcon/);
  assert.match(app, /iconButton\("<", "Previous anchor"/);
  assert.match(app, /iconButton\(">", "Next anchor"/);
  assert.match(app, /closeActiveEditorInPlace\(false\);[\s\S]*beginSectionEditing\(target/);
  assert.doesNotMatch(app, /setSectionIncluded/);
  assert.doesNotMatch(app, /Include this Section Marker/);
});

test("document header is a single compact editor with no anchor controls", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(app, /conversation\.append\(createDocumentHeaderElement\(\)\)/);
  assert.match(app, /className = "document-header"/);
  assert.match(app, /editor\.required = true/);
  assert.match(app, /editingDocumentHeaderDraft = editor\.value/);
  assert.match(app, /nextText \|\| original\.text/);
  const headerFunction = app.slice(app.indexOf("function createDocumentHeaderElement"), app.indexOf("function createMessageElement"));
  assert.doesNotMatch(headerFunction, /checkbox|navigateAnchor|moveSection|removeSection|editingControls/);
  assert.equal((headerFunction.match(/document\.createElement\("h1"\)/g) || []).length, 1);
});

test("print CSS excludes omitted messages and interface controls", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css, /@media print/);
  assert.match(css, /\.application-chrome[\s\S]*\.omitted[\s\S]*display: none !important/);
});

test("pre-import chrome is hidden and review controls become sticky after import", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(html, /id="status"[^>]*hidden/);
  assert.match(html, /id="summary-panel"[^>]*hidden/);
  assert.match(html, /id="document-actions"[^>]*sticky-review[^>]*hidden/);
  assert.match(html, /id="safety-recommendation"[^>]*hidden/);
  assert.doesNotMatch(app, /form\.hidden = true/);
  assert.doesNotMatch(app, /form\.hidden = false/);
  assert.match(css, /\[hidden\] \{ display: none !important; \}/);
  assert.match(css, /\.sticky-review \{ position: sticky; top: 0/);
});

test("save and print reveal the persistent Share-link reminder", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const occurrences = app.match(/showSafetyRecommendation\(\)/g) || [];
  assert.equal(occurrences.length, 3);
  assert.match(app, /"Markdown saved\."/);
  assert.match(app, /window\.print\(\);\s*showSafetyRecommendation\(\)/);
  assert.doesNotMatch(app, /showSafetyRecommendation\(\)[\s\S]{0,80}scrollIntoView/);
});

test("Share-link reminder lives inside the sticky review block", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const reviewStart = html.indexOf('id="document-actions"');
  const reminder = html.indexOf('id="safety-recommendation"');
  const reviewEnd = html.indexOf('id="conversation"');
  assert.ok(reviewStart >= 0 && reminder > reviewStart && reminder < reviewEnd);
  assert.match(html, /class="review-controls"/);
});

test("Share-link reminder can be dismissed and shown again by later actions", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(html, /id="dismiss-safety-recommendation"/);
  assert.match(html, /aria-label="Dismiss Share-link safety reminder"/);
  assert.match(app, /dismissSafetyRecommendation\.addEventListener\("click"/);
  assert.match(app, /safetyRecommendation\.hidden = true/);
  assert.equal((app.match(/showSafetyRecommendation\(\)/g) || []).length, 3);
});

test("imports and project opens share the transactional workspace-switch workflow", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(html, /id="workspace-switch-dialog"/);
  assert.match(html, />Save<\/button>/);
  assert.match(html, />Don't Save<\/button>/);
  assert.match(html, />Cancel<\/button>/);
  assert.equal((app.match(/prepareWorkspaceSwitch\(projectSession/g) || []).length, 2);
  assert.match(app, /imported\.outcome === "matching-transcript"/);
  assert.match(app, /markTranscriptChanged\(projectSession\)/);
  assert.doesNotMatch(app, /confirmDiscardDirty/);
});
