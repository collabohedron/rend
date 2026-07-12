import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  addNote,
  addSection,
  canMoveSection,
  copyMarkdown,
  createCuratedDocument,
  curatedStream,
  inclusionState,
  messageMarkdown,
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
} from "../document.mjs";

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

test("all messages are included by default and global state is tri-state", () => {
  const curated = createCuratedDocument(source);
  assert.equal(inclusionState(curated), "all");
  assert.deepEqual(Array.from(curated.included.values()), [true, true, true]);
  setMessageIncluded(curated, "assistant-1", false);
  assert.equal(inclusionState(curated), "mixed");
  setAllMessagesIncluded(curated, false);
  assert.equal(inclusionState(curated), "none");
  setAllMessagesIncluded(curated, true);
  assert.equal(inclusionState(curated), "all");
});

test("omitted messages are excluded from Markdown and curated print stream", () => {
  const curated = createCuratedDocument(source);
  setMessageIncluded(curated, "assistant-1", false);
  assert.ok(!toMarkdown(curated).includes("console.log"));
  const printableIds = curatedStream(curated).filter((node) => node.kind === "message").map((node) => node.message.id);
  assert.deepEqual(printableIds, ["user-1", "user-2"]);
});

test("authorship, source Markdown, and message order are preserved", () => {
  const markdown = toMarkdown(createCuratedDocument(source));
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

test("section markers are first-class nodes inserted before a selected message", () => {
  const curated = createCuratedDocument(source);
  const section = addSection(curated, "assistant-1", "Lock Rule Redesign");
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

test("section markers move without changing imported message order", () => {
  const curated = createCuratedDocument(source);
  const section = addSection(curated, "assistant-1", "Movable");
  assert.equal(canMoveSection(curated, section.id, "up"), true);
  moveSection(curated, section.id, "up");
  assert.deepEqual(curatedStream(curated, { includeOmitted: true }).map((node) => node.kind === "message" ? node.message.id : "section"), ["section", "user-1", "assistant-1", "user-2"]);
  moveSection(curated, section.id, "down");
  moveSection(curated, section.id, "down");
  assert.deepEqual(curatedStream(curated, { includeOmitted: true }).map((node) => node.kind === "message" ? node.message.id : "section"), ["user-1", "assistant-1", "section", "user-2"]);
  assert.deepEqual(curated.source.messages.map((message) => message.id), ["user-1", "assistant-1", "user-2"]);
});

test("a note belongs to its message and exports immediately after it", () => {
  const curated = createCuratedDocument(source);
  const note = addNote(curated, "assistant-1", "Settled here.\nKeep child rules.");
  const messageNode = curatedStream(curated, { includeOmitted: true }).find((node) => node.kind === "message" && node.message.id === "assistant-1");
  assert.equal(messageNode.note, note);
  let markdown = toMarkdown(curated);
  assert.ok(markdown.includes("> **Note**\n>\n> Settled here.\n> Keep child rules."));
  assert.ok(markdown.indexOf("### Attachments") < markdown.indexOf("> **Note**"));
  assert.ok(markdown.indexOf("> **Note**") < markdown.lastIndexOf("## USER"));
  updateNote(curated, "assistant-1", "Edited note");
  assert.ok(toMarkdown(curated).includes("> Edited note"));
  removeNote(curated, "assistant-1");
  assert.ok(!toMarkdown(curated).includes("Edited note"));
});

test("omitting a message omits its note but not structural sections", () => {
  const curated = createCuratedDocument(source);
  addSection(curated, "assistant-1", "Still exported");
  addNote(curated, "assistant-1", "Attached note");
  setMessageIncluded(curated, "assistant-1", false);
  let markdown = toMarkdown(curated);
  assert.ok(markdown.includes("Still exported"));
  assert.ok(!markdown.includes("Attached note"));
  setAllMessagesIncluded(curated, false);
  markdown = toMarkdown(curated);
  assert.ok(markdown.includes("Still exported"));
  assert.ok(!markdown.includes("Last message"));
});

test("summary and attachment metadata remain exact", () => {
  assert.deepEqual(summarize(source), { title: "Curated Fixture", totalMessages: 3, userMessages: 2, assistantMessages: 1, messagesWithMarkdown: 3, attachments: 1, citations: 1, contentReferences: 1 });
  assert.ok(messageMarkdown(source.messages[1]).includes("sediment://file_1"));
  assert.equal(safeFilename("A: conversation?"), "A- conversation-.md");
});

test("message body has no inclusion click handler", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(app, /checkbox\.addEventListener\("change"/);
  assert.doesNotMatch(app, /article\.addEventListener\("click"/);
});

test("notes render inside their message and compact controls have tooltips", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(app, /article\.append\(createNoteElement\(note\)\)/);
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

test("print CSS excludes omitted messages and interface controls", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css, /@media print/);
  assert.match(css, /\.application-chrome[\s\S]*\.omitted[\s\S]*display: none !important/);
});
