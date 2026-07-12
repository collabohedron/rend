# Rend

**A ChatGPT conversation renderer**

*Read long ChatGPT conversations like documents again.*


## Why Rend?

ChatGPT conversations become increasingly difficult to work with as they grow.

Searching, reviewing earlier decisions, copying large sections, or producing a clean transcript can become cumbersome in the standard interface.

Rend imports a public ChatGPT Share page and renders the entire conversation as a continuous document.

Once imported, you can search with normal browser tools, annotate, curate for export, save as Markdown, or print a clean transcript.


## Features

- Import a single public ChatGPT Share URL
- Render the entire conversation as one continuous document
- Search using normal browser Find (`Ctrl+F`)
- Copy individual messages as Markdown
- Include or omit messages and section markers from exported output
- Add section markers to structure the transcript
- Add editorial notes for later review
- Save curated transcripts as Markdown
- Print curated transcripts without interface controls

## Requirements

- Python 3.11 or newer
- A modern desktop browser

No third-party Python packages are required.

## Running Rend

Start the local server:

```powershell
py -3 server.py
```

Then open:

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
- Include or omit individual messages and section markers.
- Add section markers to structure the transcript.
- Add editorial notes for later review.
- Copy individual messages as Markdown.
- Save the curated transcript with **Save Markdown As...**.
- Print only the selected content with **Print Selected**.

Section markers and notes are editorial annotations. They do not modify the imported conversation; they become part of the curated transcript used for Markdown export and printing.

*Annotations and inclusion choices exist only for the current session.  Refreshing the page starts with a clean transcript.*

## Saving

When supported by the browser, Rend uses the File System Access API to present the native **Save As...** dialog and remembers the last successfully used save location.

If native file access is unavailable or denied, Rend automatically falls back to downloading a Markdown file.

## Privacy

Rend imports only the ChatGPT Share URL that you provide.

It does **not**:

- authenticate with ChatGPT
- access your account
- follow links
- crawl additional pages
- retrieve attachment contents

Imported conversations remain in memory for the duration of the session but are not stored by Rend.

## Share links

A ChatGPT Share URL remains publicly accessible until you revoke it.

After saving or printing your transcript, revoke the Share link if it no longer needs to remain public.

## Limitations

Rend relies on ChatGPT Share pages, which are not a public API and may change over time.

If Rend cannot confidently reconstruct a complete conversation, it reports the page as unsupported rather than knowingly rendering a partial transcript.

Rend imports only public ChatGPT Share pages. It cannot import private conversations directly from your ChatGPT account.

Attachment metadata is preserved when available, but attachment contents are never downloaded.


## Development

Run the test suite with:

```powershell
py -3 -m unittest discover -s tests -v
node --test tests/document.test.mjs tests/save-markdown.test.mjs
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for implementation details and design rationale.