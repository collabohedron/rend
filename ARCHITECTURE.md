# Architecture

Rend deliberately separates retrieval, parsing, document modeling, and rendering.

The goal is to isolate ChatGPT-specific implementation details inside a single importer while allowing the rest of the application to operate on a stable, renderer-neutral document model.

This makes the renderer easier to evolve and limits the impact of future changes to ChatGPT Share pages.

---

## Design principles

The project is organized around several constraints.

### The renderer is not a scraper

Rend imports exactly one public ChatGPT Share page.

It does not:

- authenticate with ChatGPT
- access user accounts
- follow links
- crawl additional pages
- execute site JavaScript
- retrieve attachment contents

Everything displayed is reconstructed from the initial HTTP response.

---

### Parsing and rendering are separate concerns

The parser understands ChatGPT.

The renderer does not.

The parser converts ChatGPT's private Share serialization into a stable document model.

The renderer operates only on that document model.

Changing one should require little or no change to the other.

---

### Imported conversations are immutable

The imported transcript is never modified.

User edits create editorial content that exists alongside the transcript.

Examples include:

- Section Markers
- Notes
- Include / omit state

The original imported messages remain unchanged.

---

## Pipeline

```
ChatGPT Share URL
        │
        ▼
 retrieval.py
        │
        ▼
   parser.py
        │
        ▼
    model.py
        │
        ▼
     app.js
```

---

## Retrieval

`retrieval.py` accepts only public ChatGPT Share URLs.

It validates every request before downloading a page.

Redirects are not followed automatically.

No authentication, cookies, or secondary retrieval is performed.

Its responsibility ends when the HTML has been successfully retrieved.

---

## Parsing

`parser.py` reconstructs the conversation from serialized data embedded within the Share page.

It does **not** inspect ChatGPT's rendered DOM.

The rendered DOM is produced by ChatGPT's client-side application and is considered an unstable presentation layer.

Instead, the parser reconstructs the document from the serialized conversation data included in the initial response.

If required structures are missing, ambiguous, or inconsistent, parsing fails.

The parser intentionally fails rather than knowingly returning a partial conversation.

---

## Document model

`model.py` defines the application's stable document boundary.

Everything above this layer is ChatGPT-specific.

Everything below this layer is ChatGPT-independent.

Current document node types include:

- User Message
- Assistant Message
- Section Marker

Messages may contain user-authored annotations such as Notes.

Renderers, exporters, printers, and future navigation tools should depend only on this model.

---

## Rendering

`app.js` renders the document model.

It has no knowledge of ChatGPT's serialization format.

Its responsibilities include:

- continuous document rendering
- transcript curation
- annotations
- Markdown export
- printing

Rendering decisions should not require changes to the parser.

---

## Failure philosophy

ChatGPT Share pages are not a public API.

Their internal representation may change without notice.

When Rend cannot confidently reconstruct a complete document, it fails.

Returning an explicit error is preferred over silently producing an incomplete transcript.

---

## Attachments

Attachment contents are never downloaded.

When attachment metadata is available, Rend displays placeholders containing the available information.

This preserves document structure without attempting to retrieve external resources.

---

## Future changes

Whenever possible:

- parser changes stay inside `parser.py`
- renderer changes stay inside `app.js`
- document features extend `model.py`

The document model should remain the stable contract between the importer and every consumer of the imported conversation.