import assert from "node:assert/strict";
import test from "node:test";

import { safeFilename, summarize, toMarkdown } from "../document.mjs";

const documentModel = {
  title: "Dandelion",
  messages: [
    { id: "one", author: "user", markdown: "# Existing heading\n\n- one\n- two\n\n> quote", attachments: [], citations: [], content_references: [] },
    {
      id: "two", author: "assistant", markdown: "Use `code`.\n\n```js\nconsole.log(1);\n```",
      attachments: [{ id: "file_1", filename: "image.png", mime_type: "image/png", size_bytes: 42, width: 10, height: 20, reference: "sediment://file_1?shared_conversation_id=example" }],
      citations: [{ url: "https://example.com" }], content_references: [{ type: "webpage" }],
    },
  ],
};

test("summary uses exact model counts", () => {
  assert.deepEqual(summarize(documentModel), { title: "Dandelion", totalMessages: 2, userMessages: 1, assistantMessages: 1, messagesWithMarkdown: 2, attachments: 1, citations: 1, contentReferences: 1 });
});

test("Markdown export preserves source and order", () => {
  const markdown = toMarkdown(documentModel);
  assert.ok(markdown.startsWith("# Dandelion\n\n## USER\n\n# Existing heading"));
  assert.ok(markdown.indexOf("## USER") < markdown.indexOf("## ASSISTANT"));
  assert.ok(markdown.includes("```js\nconsole.log(1);\n```"));
  assert.ok(markdown.includes("### Attachments"));
  assert.ok(markdown.includes("image.png"));
  assert.ok(markdown.includes("sediment://file_1?shared_conversation_id=example"));
});

test("export filename is safe", () => {
  assert.equal(safeFilename("A: conversation?"), "A- conversation-.md");
});
