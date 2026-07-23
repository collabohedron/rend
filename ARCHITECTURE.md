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

### Imported transcript snapshots are immutable during editing

Normal editing never modifies the imported transcript snapshot.

User edits create editorial content that exists alongside the transcript.

A later import may transactionally replace the snapshot when its ordered canonical message hashes are identical, or extend it when the complete existing sequence is an exact prefix of the imported sequence. Appended messages receive new default editorial bindings; all existing editorial state remains attached by ordinal to the verified prefix. The comparison hashes role, line-ending-normalized Markdown, and stable attachment descriptors. It performs no fuzzy matching, relocation, or editorial reconciliation. A non-prefix import becomes an independent project, and any retrieval, parsing, validation, or comparison failure leaves the active project untouched.

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

The normalized importer model contains User and Assistant messages. The separate browser-owned editorial model adds document nodes and annotations including:

- User Message
- Assistant Message
- Section Marker

Messages may contain user-authored annotations such as Notes.

The editable document header is persistent editorial metadata, not a node in the ordered transcript/section-marker stream.

The inclusion state of each section marker is not stored directly, but is derived from the state of the next adjacent message zone. Island markers remain included, and no marker inclusion state is persisted.

Section projection begins with the implicit document-header boundary and creates another section at every explicit marker. The implicit boundary is never serialized. New imported projects do serialize one ordinary trailing end-of-document marker; strict prefix refreshes append messages after the prior boundary and add a new trailing marker. Outline View and the transcript consume the same derived section projection, so their tri-state controls cannot diverge.

Outline analytics are ephemeral projections over every message in a section, independent of export inclusion. Message counts, role word counts, usable timestamp ranges, elapsed duration, and non-empty message Notes are recalculated from the runtime transcript/editorial state rather than cached or persisted. Omission is represented visually in Outline View but filters only export and print projections. Annotation disclosure stores only expanded section IDs for the active workspace.

Markdown serialization uses shared formatting and clipboard infrastructure across message, section, and document scopes. Save Markdown and Copy Document use the complete curated projection, while Copy Section supplies one section and its currently included messages. Clipboard controls share one icon and transient feedback implementation; clipboard state is never persisted.

Transcript and Outline navigation share one ephemeral current-section identifier. In Transcript View it is continuously derived from the last document header or explicit anchor at or above the sticky-header-adjusted viewport boundary; explicit outline selection and programmatic navigation update the same value. View switching, message navigation, section navigation, and scroll tracking therefore cannot create competing selection states.

Renderers, exporters, printers, and future navigation tools should depend only on this model.

---

## Rendering

`app.js` renders a Rend project composed of an immutable normalized transcript, together with the user's editorial changes.

It has no knowledge of ChatGPT's serialization format.

Its responsibilities include:

- continuous document rendering
- transcript curation
- annotations
- Markdown export
- printing

The transcript and outline are alternate screen presentations derived from the same section structure. Only the active view is rendered.  Print-specific CSS always suppresses the outline and prints the curated transcript, regardless of the active screen view.

Project persistence is divided between browser-side project/session modules and the local Python container boundary. 

`.rend` files are validated ZIP containers with separate manifest, transcript, and editorial JSON components. 

The persisted editorial component is a sparse overlay: untouched transcript messages inherit membership, inclusion, and order directly from the immutable transcript, while the document header, notes, omissions, section markers, and their actual positions are stored. 

The local server packs and unpacks container bytes but does not retain project data or filesystem paths.

Project persistence preserves the editable workspace. Markdown export and printing are projections of that workspace, rather than editable project formats.

`transcript-import.mjs` owns canonical message hashing, exact refresh, and strict append-only prefix extension. `workspace-switch.mjs` owns the shared Save / Don't Save / Cancel decision used before replacing an active dirty workspace. Neither changes the `.rend` container schema.

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
