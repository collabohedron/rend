# Rend

**A ChatGPT conversation workspace**

*Read long ChatGPT conversations like documents again, then bring what matters into a new one.*


## Why Rend?

ChatGPT conversations become increasingly difficult to work with as they grow.

Long discussions are excellent for exploration, but poor for review. Finding earlier decisions, restructuring the conversation, removing dead ends, or producing a clean record all become increasingly difficult.

Rend imports a public ChatGPT Share page and presents it as a continuous document, alongside a non-destructive editorial workspace for organizing, annotating, and curating the transcript.  This makes it practical to distill and restore context, so we can start a new conversation from the ashes  of the original.

Once imported, Rend creates an editable local project. You can search it with normal browser tools, annotate the transcript, save your work as a local project file to open and continue editing later, export your curated transcript (with annotations) as a final Markdown file, or print it directly.

Rend provides editorial tools, not editorial decisions.



## Features

- Import a single public ChatGPT Share URL
- Render the entire conversation as one continuous document
- Save and reopen local `.rend` project files
- Search using your browser's built-in Find (`Ctrl+F`)
- Include or omit individual messages from exported output
- Add section markers to structure the transcript
- Include or omit marked sections with a single click
- Switch between transcript and section-level curation with Outline View
- Evaluate sections using message counts, word counts, timing, and Notes
- Add editorial notes to capture follow-up work and decisions
- Edit the document header independently from the imported conversation title
- Copy messages, sections, or the complete curated document as Markdown
- Print curated transcripts, or export them as Markdown

## Requirements

- Python 3.11 or newer
- A modern desktop browser

No third-party Python packages are required.

## Running Rend

Start the local server:

```powershell
py -3 server.py
```

Then open your browser to:

```text
http://127.0.0.1:8000/
```

Paste a public ChatGPT Share URL in the form:

```text
https://chatgpt.com/share/<id>
```

Select **Import**.

## Using Rend

After importing a conversation you can:

- Review the transcript as one continuous document.
- Include or omit individual messages or whole sections from either adjacent anchor.
- Add section markers to structure the transcript.
- Use **Switch Views** or `\` to switch between detailed message editing and rapid section-level curation.
- In Transcript View, use `Shift+Up` / `Shift+Down` for adjacent messages and `Ctrl+Up` / `Ctrl+Down` for adjacent sections.
- Add editorial notes for later review.
- Copy individual messages, individual outline sections, or the complete curated document as Markdown.
- Save the editable workspace with **Save Project** or **Save Project As...**.
- Save the curated transcript with **Save Markdown As...**.
- Print only the selected content with **Print Selected**.

The large document header is editable independently from the imported conversation title and supplies export filenames. The document header, section markers, and notes are editorial annotations stored separately from the immutable imported transcript. Section markers automatically appear in output whenever the section they introduce contains included content. Markers that do not introduce a section always appear.

New imports receive an ordinary trailing marker named `End of Document: <timestamp>`. When a later Share import strictly extends the existing transcript, Rend preserves the prior marker before the appended messages and creates a new trailing marker. 

Outline View is a screen-only curation view for working with entire sections at once. It displays section boundaries together with message counts, role word counts, timing information, and Notes, allowing sections to be evaluated and curated without displaying every message. These analytics are recalculated from the current document whenever the outline is shown and are never saved in the project. Omitted sections remain dimmed, but continue to display the same analytics and Notes so those can be evaluated and restored later. Non-empty Notes can be viewed directly in Outline View and used to return to their source messages.

**Print Selected** always prints the curated full transcript.

## Rend projects and output

Rend project files use the `.rend` extension. A project contains the immutable imported transcript, together with the separate editorial changes needed to continue working later. Select **Open Project...** to reopen one without retrieving the original Share URL.

Importing another Share URL while a project is open compares ordered canonical message hashes before changing the workspace. An exact match refreshes the stored transcript, while an imported transcript that begins with the complete existing hash sequence extends the project with its newly appended messages. Both retain the project file and every existing editorial change; appended messages begin included and unannotated. Any non-prefix difference opens the import as a new unsaved project without transferring editorial work. When switching away from a project with unsaved changes, Rend offers Save, Don't Save, and Cancel.

**Save Project** updates the active project. **Save Project As...** creates an independent copy. Rend displays whether the active project is saved or has unsaved changes.

Markdown export and printing are output operations; they are not substitutes for the editable `.rend` project.

When supported by the browser, Rend uses the File System Access API for native project and Markdown file dialogs. If native project file access is unavailable, saving a project falls back to a `.rend` download.

If native Markdown file access is unavailable or denied, Rend falls back to downloading a Markdown file.

## Privacy

Rend imports only the ChatGPT Share URL that you provide.

It does **not**:

- authenticate with ChatGPT
- access your account
- follow links
- crawl additional pages
- retrieve attachment contents

Imported conversations remain in memory until you explicitly save a local `.rend` project. Rend does not upload or remotely store project files. A `.rend` project contains conversation content, editorial notes, and the original Share URL as provenance; protect it accordingly.

## Share links

A ChatGPT Share URL remains publicly accessible on OpenAI's servers until you delete the link. Share links provide a viewable copy of the conversation to anyone with the link *(and, depending on ChatGPT's current Share-link behavior, recipients may also be able to import it into their own chat history).*

After saving or printing your transcript, delete the Share link if it no longer needs to remain public. Deleting a Share link prevents future access through that link, but does not remove copies that others have already imported or saved.


## Limitations

Rend relies on ChatGPT Share pages, which are not a public API and may change over time.

If Rend cannot confidently reconstruct a complete conversation, it reports the page as unsupported rather than knowingly rendering a partial transcript.

Rend imports only public ChatGPT Share pages. It cannot import private conversations directly from your ChatGPT account.

Share links represent a snapshot at the time they were created (and may contain only part of a conversation, depending on how they were shared). Rend renders exactly what is contained in the supplied Share page, rather than implying or inferring content that is not present.

Attachment metadata is preserved when available, but attachment contents are never downloaded.

## Development

Run the test suite with:

```powershell
py -3 -m unittest discover -s tests -v
node --test tests/*.test.mjs
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for implementation details and design rationale, and [COMPLIANCE.md](COMPLIANCE.md) for the project's intended scope and interaction with ChatGPT Share pages.
