import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  addNote,
  addSection,
  adjacentAnchorId,
  anchorOutputState,
  canMoveSection,
  countMarkdownWords,
  copyMarkdown,
  currentZoneState,
  curatedStream,
  documentSections,
  inclusionState,
  messageMarkdown,
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
  togglePreviousZone,
  toggleCurrentZone,
  toggleOutlineSection,
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

function automaticEndAnchor(project) {
  return project.editorial.nodes.find((node) => node.kind === "section" && node.text.startsWith("End of Document: "));
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
  assert.ok(markdown.startsWith("# Curated Fixture\n\n### USER\n\n# Existing heading"));
  assert.ok(markdown.indexOf("### USER") < markdown.indexOf("### ASSISTANT"));
  assert.ok(markdown.indexOf("### ASSISTANT") < markdown.lastIndexOf("### USER"));
  assert.ok(markdown.includes("```js\nconsole.log(1);\n```"));
  assert.ok(markdown.includes("[link](https://example.com)"));
});

test("copy returns only the selected original message body", () => {
  const copied = copyMarkdown(source.messages[1]);
  assert.equal(copied, source.messages[1].markdown);
  assert.ok(!copied.includes("ASSISTANT"));
  assert.ok(!copied.includes("Attachments"));
});

test("section-scoped Markdown reuses export formatting and current inclusion", async () => {
  const curated = await makeProject();
  const section = addSection(curated, bindingId(curated, "assistant-1"), "Selected Section");
  addNote(curated, bindingId(curated, "assistant-1"), "Section note");
  setMessageIncluded(curated, bindingId(curated, "user-2"), false);

  const headerMarkdown = toMarkdown(curated, { sectionId: "document-header" });
  assert.ok(headerMarkdown.startsWith("# Curated Fixture\n\n### USER"));
  assert.ok(headerMarkdown.includes("# Existing heading"));
  assert.ok(!headerMarkdown.includes("### ASSISTANT"));
  assert.ok(!headerMarkdown.includes("Selected Section"));

  const sectionMarkdown = toMarkdown(curated, { sectionId: section.id });
  assert.ok(sectionMarkdown.startsWith("## Selected Section\n\n### ASSISTANT"));
  assert.ok(sectionMarkdown.includes("```js\nconsole.log(1);\n```"));
  assert.ok(sectionMarkdown.includes("### Attachments"));
  assert.ok(sectionMarkdown.includes("> **Note**\n>\n> Section note"));
  assert.ok(!sectionMarkdown.includes("# Curated Fixture"));
  assert.ok(!sectionMarkdown.includes("Last message."));

  const endAnchor = automaticEndAnchor(curated);
  assert.equal(toMarkdown(curated, { sectionId: endAnchor.id }), `## ${endAnchor.text}\n`);
  assert.throws(() => toMarkdown(curated, { sectionId: "missing" }), /Unknown Markdown section/);
});

test("section markers are first-class nodes inserted before a selected message", async () => {
  const curated = await makeProject();
  const section = addSection(curated, bindingId(curated, "assistant-1"), "Lock Rule Redesign");
  assert.equal("included" in section, false);
  const nodes = curatedStream(curated, { includeOmitted: true });
  assert.deepEqual(nodes.slice(1, 3).map((node) => node.kind === "message" ? node.message.id : node.section.id), [section.id, "assistant-1"]);
  const markdown = toMarkdown(curated);
  assert.ok(markdown.includes("## Lock Rule Redesign"));
  assert.ok(markdown.indexOf("## Lock Rule Redesign") < markdown.indexOf("### ASSISTANT"));
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

test("current-section controls share exact boundaries with the outline projection", async () => {
  const curated = await makeProject();
  const section = addSection(curated, bindingId(curated, "assistant-1"), "Second section");
  const documentProjection = documentSections(curated);
  const outline = outlineSections(curated);
  assert.deepEqual(
    documentProjection.map(({ openerId, messageBindingIds }) => ({ openerId, messageBindingIds })),
    outline.map(({ openerId, messageBindingIds }) => ({ openerId, messageBindingIds })),
  );
  assert.ok(documentProjection.every((item) => !("analytics" in item)));
  assert.ok(outline.every((item) => "analytics" in item));
  assert.deepEqual(outline.map((item) => ({
    openerKind: item.openerKind, openerId: item.openerId, state: item.state,
    available: item.available, messageBindingIds: item.messageBindingIds,
  })), [
    { openerKind: "header", openerId: "document-header", state: "included", available: true, messageBindingIds: [bindingId(curated, "user-1")] },
    { openerKind: "anchor", openerId: section.id, state: "included", available: true, messageBindingIds: [bindingId(curated, "assistant-1"), bindingId(curated, "user-2")] },
    { openerKind: "anchor", openerId: automaticEndAnchor(curated).id, state: "included", available: false, messageBindingIds: [] },
  ]);
  setMessageIncluded(curated, bindingId(curated, "assistant-1"), false);
  assert.equal(currentZoneState(curated, section.id).state, "mixed");
  assert.equal(toggleCurrentZone(curated, section.id), true);
  assert.equal(currentZoneState(curated, section.id).state, "omitted");
  toggleCurrentZone(curated, section.id);
  assert.equal(currentZoneState(curated, section.id).state, "included");
});

test("deleting every explicit anchor leaves one header-opened outline section", async () => {
  const curated = await makeProject();
  removeSection(curated, automaticEndAnchor(curated).id);
  const outline = outlineSections(curated);
  assert.equal(outline.length, 1);
  assert.equal(outline[0].openerId, "document-header");
  assert.deepEqual(outline[0].messageBindingIds, curated.editorial.messageBindings.map((binding) => binding.id));
});

test("outline analytics retain all messages and non-empty Notes when content is omitted", () => {
  const analyticsSource = {
    title: "Analytics Fixture",
    messages: [
      { id: "m1", author: "user", markdown: "# Alpha beta", created_at: 1721660000, attachments: [] },
      { id: "m2", author: "assistant", markdown: "Gamma **delta** epsilon.", created_at: 1721663600, attachments: [] },
      { id: "m3", author: "user", markdown: "Hidden user words", created_at: 1721667200, attachments: [] },
      { id: "m4", author: "assistant", markdown: "`Final` answer.", created_at: null, attachments: [] },
    ],
  };
  const curated = createProject(analyticsSource, { sourceUrl: "https://chatgpt.com/share/analytics" });
  const finalSection = addSection(curated, bindingId(curated, "m4"), "Final");
  addNote(curated, bindingId(curated, "m1"), "Visible note");
  addNote(curated, bindingId(curated, "m2"), "   \n");
  addNote(curated, bindingId(curated, "m3"), "Note on omitted message");
  setMessageIncluded(curated, bindingId(curated, "m3"), false);

  const header = outlineSections(curated).find((item) => item.openerId === "document-header");
  assert.deepEqual({
    messageCount: header.analytics.messageCount,
    userWordCount: header.analytics.userWordCount,
    assistantWordCount: header.analytics.assistantWordCount,
    startTimestamp: header.analytics.startTimestamp,
    endTimestamp: header.analytics.endTimestamp,
    usableTimestampCount: header.analytics.usableTimestampCount,
    annotationCount: header.analytics.annotationCount,
  }, {
    messageCount: 3,
    userWordCount: 5,
    assistantWordCount: 3,
    startTimestamp: 1721660000000,
    endTimestamp: 1721667200000,
    usableTimestampCount: 3,
    annotationCount: 2,
  });
  assert.equal(header.analytics.annotations[0].bindingId, bindingId(curated, "m1"));
  assert.equal(header.analytics.annotations[0].note, curated.editorial.messageBindings[0].note);
  assert.equal(header.analytics.annotations[1].bindingId, bindingId(curated, "m3"));

  const final = outlineSections(curated).find((item) => item.openerId === finalSection.id);
  assert.equal(final.analytics.messageCount, 1);
  assert.equal(final.analytics.assistantWordCount, 2);
  assert.equal(final.analytics.usableTimestampCount, 0);

  setMessageIncluded(curated, bindingId(curated, "m1"), false);
  setMessageIncluded(curated, bindingId(curated, "m2"), false);
  const omitted = outlineSections(curated).find((item) => item.openerId === "document-header");
  assert.equal(omitted.state, "omitted");
  assert.equal(omitted.analytics.messageCount, 3);
  assert.equal(omitted.analytics.annotationCount, 2);

  setMessageIncluded(curated, bindingId(curated, "m3"), true);
  const refreshed = outlineSections(curated).find((item) => item.openerId === "document-header");
  assert.equal(refreshed.analytics.messageCount, 3);
  assert.equal(refreshed.analytics.userWordCount, 5);
  assert.equal(refreshed.analytics.endTimestamp, 1721667200000);
  assert.equal(refreshed.analytics.annotationCount, 2);
});

test("Markdown word counts ignore formatting punctuation", () => {
  assert.equal(countMarkdownWords("# One **two** and `three-four`.\n\n> Five"), 6);
  assert.equal(countMarkdownWords("L’été isn't over in 2026."), 5);
  assert.equal(countMarkdownWords("   \n"), 0);
});

test("outline timestamps collapse redundant dates and meridiems", () => {
  const timestamp = (day, hour, minute) => Date.UTC(2026, 6, day, hour, minute);
  assert.equal(outlineTimestampParts({
    messageCount: 0, usableTimestampCount: 0, startTimestamp: null, endTimestamp: null,
  }, { timeZone: "UTC" }), null);
  assert.deepEqual(outlineTimestampParts({
    messageCount: 2, usableTimestampCount: 1,
    startTimestamp: timestamp(8, 4, 12), endTimestamp: timestamp(8, 4, 12),
  }, { timeZone: "UTC" }), { range: "Jul 8, 4:12 AM", duration: null });
  assert.deepEqual(outlineTimestampParts({
    messageCount: 2, usableTimestampCount: 2,
    startTimestamp: timestamp(8, 4, 12), endTimestamp: timestamp(8, 4, 13),
  }, { timeZone: "UTC" }), { range: "Jul 8, 4:12 – 4:13 AM", duration: "1m" });
  assert.deepEqual(outlineTimestampParts({
    messageCount: 2, usableTimestampCount: 2,
    startTimestamp: timestamp(8, 11, 58), endTimestamp: timestamp(8, 12, 7),
  }, { timeZone: "UTC" }), { range: "Jul 8, 11:58 AM – 12:07 PM", duration: "9m" });
  assert.deepEqual(outlineTimestampParts({
    messageCount: 2, usableTimestampCount: 2,
    startTimestamp: timestamp(8, 4, 23), endTimestamp: timestamp(10, 10, 8),
  }, { timeZone: "UTC" }), { range: "Jul 8, 4:23 AM – Jul 10, 10:08 AM", duration: "2d 5h 45m" });
  assert.deepEqual(outlineTimestampParts({
    messageCount: 2, usableTimestampCount: 2,
    startTimestamp: timestamp(8, 4, 12), endTimestamp: timestamp(8, 4, 12),
  }, { timeZone: "UTC" }), { range: "Jul 8, 4:12 AM", duration: null });
});

test("the header section toggles messages without ever omitting the document header", async () => {
  const curated = await makeProject();
  const section = addSection(curated, bindingId(curated, "assistant-1"), "Second section");
  assert.equal(toggleOutlineSection(curated, "document-header"), true);
  assert.equal(bindingId(curated, "user-1") != null, true);
  assert.equal(curated.editorial.messageBindings.find((binding) => binding.id === bindingId(curated, "user-1")).included, false);
  const markdown = toMarkdown(curated);
  assert.ok(markdown.startsWith("# Curated Fixture"));
  assert.ok(!markdown.includes("# Existing heading"));
  assert.ok(markdown.includes(`## ${section.text}`));
});

test("an anchor inserted into an omitted message zone derives omitted output", async () => {
  const curated = await makeProject();
  setMessageIncluded(curated, bindingId(curated, "assistant-1"), false);
  setMessageIncluded(curated, bindingId(curated, "user-2"), false);
  const section = addSection(curated, bindingId(curated, "assistant-1"), "Omitted split");
  assert.deepEqual(anchorOutputState(curated, section.id).included, false);
  assert.ok(!toMarkdown(curated).includes("Omitted split"));
});

test("anchor navigation wraps through island and bounding anchors", async () => {
  const curated = await makeProject();
  removeSection(curated, automaticEndAnchor(curated).id);
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
  removeSection(curated, automaticEndAnchor(curated).id);
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
  assert.ok(markdown.indexOf("> **Note**") < markdown.lastIndexOf("### USER"));
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
  assert.equal(curatedStream(curated, { includeOmitted: true }).filter((node) => node.kind === "section").length, 2);
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
  assert.match(app, /createCopyControl\("Copy Message"/);
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
  assert.match(app, /sectionToggleAction\(previousZone\.state, "previous"\)/);
  assert.match(app, /sectionToggleAction\(currentZone\.state, "current"\)/);
  assert.match(app, /toggleCurrentZone/);
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
  const headerFunction = app.slice(app.indexOf("function createDocumentHeaderElement"), app.indexOf("function createOutlinePresentation"));
  assert.doesNotMatch(headerFunction, /checkbox|navigateAnchor|moveSection|removeSection|editingControls/);
  assert.match(headerFunction, /createOutlineButton\("document-header"\)/);
  assert.equal((headerFunction.match(/document\.createElement\("h1"\)/g) || []).length, 1);
});

test("Outline View is contextual, tri-state, and preserves reciprocal section navigation", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(html, /id="include-all"[\s\S]*Include All Messages/);
  assert.match(html, /id="include-all"[\s\S]*id="copy-document"[\s\S]*class="action-buttons"/);
  assert.match(app, /setAllMessagesIncluded\(curated, includeAll\.checked\)/);
  assert.match(app, /includeAll\.indeterminate = state === "mixed"/);
  assert.match(app, /outlineSections\(curated\)/);
  assert.match(app, /checkbox\.indeterminate = section\.state === "mixed"/);
  assert.match(app, /if \(section\.messageBindingIds\.length > 0\) content\.append\(createOutlineAnalytics\(section\)\)/);
  assert.match(app, /section\.analytics\.messageCount/);
  assert.match(app, /user\.textContent = "User"/);
  assert.match(app, /assistant\.textContent = "Assistant"/);
  assert.match(app, /outlineTimestampParts\(section\.analytics\)/);
  assert.match(app, /spanLabel\.textContent = "Span"/);
  assert.match(app, /durationLabel\.textContent = "Duration"/);
  assert.match(app, /time\.append\(" • ", durationLabel, ` \$\{timestamp\.duration\}`\)/);
  assert.doesNotMatch(app, /document\.createElement\("em"\)/);
  assert.doesNotMatch(app, /0 annotations/);
  assert.match(app, /outline-annotation-toggle/);
  assert.match(app, /disclosure\.setAttribute\("aria-expanded"/);
  assert.match(app, /returnToMessage\(section\.openerId, annotation\.bindingId\)/);
  assert.match(app, /expandedOutlineSections = new Set\(\)/);
  assert.match(app, /event\.target\.closest\("button, input, a, textarea, select"\)/);
  assert.match(app, /selectOutlineRow\(row, section\.openerId\)/);
  assert.match(app, /currentSectionId = sectionId;[\s\S]*row\.classList\.add\("selected"\)/);
  assert.match(css, /\.outline-row\.omitted h2, \.outline-row\.omitted \.outline-analytics \{ opacity: \.56; \}/);
  assert.match(app, /createOutlineButton\(sectionId\)/);
  assert.match(app, /createOutlineButton\("document-header"\)/);
  assert.match(app, /switchViewsAt\(sectionId\)/);
  assert.match(app, /if \(viewMode === "outline"\) returnToTranscript\(sectionId\)/);
  assert.match(app, /target\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(app, /function scrollTranscriptTarget\(target, gap = 12\)/);
  assert.match(app, /transcriptVisibleTop\(\) \+ gap/);
  assert.match(app, /scrollTranscriptTarget\(transcriptSectionElement\(sectionId\), 0\)/);
  assert.match(app, /window\.scrollTo\(\{ top: Math\.max\(0, top\), behavior: "smooth" \}\)/);
  assert.match(app, /currentSectionId = sectionId;[\s\S]*viewMode = "outline"/);
  assert.match(app, /currentSectionId = sectionId;[\s\S]*viewMode = "transcript"/);
  assert.match(app, /outlineIconButton\("Switch Views"/);
  assert.match(app, /const returnButton = outlineIconButton/);
  assert.match(app, /createCopyControl\("Copy Section"/);
  assert.match(app, /selectOutlineRow\(row, section\.openerId\);[\s\S]*toMarkdown\(curated, \{ sectionId: section\.openerId \}\)/);
  assert.match(app, /row\.append\(checkbox, copySectionButton, returnButton, content\)/);
});

test("viewport, sticky control, and keyboard navigation share one current section", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(html, /id="switch-views"[^>]*><\/button>/);
  assert.match(app, /let currentSectionId = "document-header"/);
  assert.doesNotMatch(app, /selectedSectionId/);
  assert.match(app, /window\.addEventListener\("scroll", scheduleCurrentSectionUpdate, \{ passive: true \}\)/);
  assert.match(app, /window\.addEventListener\("resize", scheduleCurrentSectionUpdate\)/);
  assert.match(app, /requestAnimationFrame\(\(\) => \{[\s\S]*syncCurrentSectionFromViewport\(\)/);
  assert.match(app, /querySelectorAll\("\.document-header, \.transcript-presentation \.section-marker"\)/);
  assert.match(app, /anchor\.getBoundingClientRect\(\)\.top > visibleTop \+ 1/);
  assert.match(app, /currentSectionId = current/);
  assert.match(app, /return Math\.max\(0, sticky\.height\)/);
  assert.doesNotMatch(app, /sticky\.top <= 1/);
  assert.match(app, /configureOutlineIconButton\(switchViewsButton, "Switch Views", toggleViews\)/);
  assert.match(app, /button\.classList\.add\("outline-entry-control", "no-print"\)/);
  assert.match(app, /if \(viewMode === "transcript"\) syncCurrentSectionFromViewport\(\);[\s\S]*switchViewsAt\(currentSectionId\)/);
  assert.match(app, /event\.key === "\\\\"/);
  assert.match(app, /if \(event\.shiftKey && !event\.ctrlKey\) return "message"/);
  assert.match(app, /if \(event\.ctrlKey && !event\.shiftKey\) return "section"/);
  assert.match(app, /if \(navigation === "message"\) navigateTranscriptMessage\(direction\)/);
  assert.match(app, /else navigateTranscriptSection\(direction\)/);
  assert.match(app, /allowedEditorShortcut = editingTranscriptText && navigation/);
  assert.match(app, /target\.closest\("\.document-header-editor, \.section-editor, \.note-editor"\)/);
  assert.match(app, /event\.altKey \|\| event\.metaKey/);
  assert.match(app, /event\.shiftKey && !event\.ctrlKey/);
  assert.match(app, /event\.ctrlKey && !event\.shiftKey/);
  assert.match(app, /const target = messages\[targetIndex\];[\s\S]*finishActiveEditing\(\);[\s\S]*scrollTranscriptTarget\(target\)/);
  assert.match(app, /if \(viewMode !== "transcript"[\s\S]*return;/);
  assert.match(app, /scrollTranscriptTarget\(target\)/);
  const scrollHelper = app.slice(app.indexOf("function scrollTranscriptTarget"), app.indexOf("function handleTranscriptNavigation"));
  assert.doesNotMatch(scrollHelper, /\.focus\(/);
  assert.match(app, /function activateTranscriptSection\(sectionId\)/);
  assert.match(app, /beginDocumentHeaderEditing\(target\)/);
  assert.match(app, /beginSectionEditing\(section, target\)/);
  assert.match(app, /activeTitleEditor\.closest\("\[data-section-id\]"\)/);
  assert.match(app, /if \(activeTitleEditor\)[\s\S]*else \{[\s\S]*syncCurrentSectionFromViewport\(\)/);
  assert.match(app, /documentSections\(curated\)\.map/);
  assert.match(app, /currentSectionId = sectionIds\[targetIndex\];[\s\S]*activateTranscriptSection\(currentSectionId\)/);
});

test("all copy scopes share clipboard handling and transient icon feedback", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(html, /aria-label="Copy Document" title="Copy Document"/);
  assert.match(app, /configureCopyControl\(copyDocumentButton, "Copy Document", \(\) => toMarkdown\(curated\)\)/);
  assert.match(app, /createCopyControl\("Copy Message", \(\) => copyMarkdown\(message\)\)/);
  assert.match(app, /createCopyControl\("Copy Section"/);
  assert.match(app, /navigator\.clipboard\.writeText\(await markdownProvider\(\)\)/);
  assert.match(app, /showCopyFeedback\(button, "success", 1000\)/);
  assert.match(app, /showCopyFeedback\(button, "failure", 2000\)/);
  assert.match(app, /feedback\.textContent = state === "success" \? "✓" : "✖"/);
  const sharedCopyFunctions = app.slice(app.indexOf("function createCopyControl"), app.indexOf("function textButton"));
  assert.doesNotMatch(sharedCopyFunctions, /showStatus|focus\(/);
  assert.match(css, /\.copy-success \{ color: #198a35; \}/);
  assert.match(css, /\.copy-failure \{ color: #c62828; \}/);
});

test("print CSS excludes omitted messages and interface controls", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css, /@media print/);
  assert.match(css, /\.application-chrome[\s\S]*\.omitted[\s\S]*display: none !important/);
  assert.match(css, /\.outline-presentation \{ display: none !important; \}/);
  assert.match(css, /\.transcript-presentation \{ display: block !important; \}/);
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
