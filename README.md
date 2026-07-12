# ChatGPT Conversation Viewer — import milestone

This milestone imports exactly one public `https://chatgpt.com/share/<id>` page into a
renderer-neutral conversation document and displays it as one continuous browser DOM.

## Run

Python 3.11 or newer is required. No third-party packages are used.
There is no install step: do not run `pip install` or `npm install`, and do not vendor
libraries into the repository.

```powershell
py -3 server.py
```

Open `http://127.0.0.1:8000/`, paste a ChatGPT Share URL, and choose **Import**.

The viewer reports exact model-derived import and validation totals. **Export Markdown**
creates a role-labeled document from the same ordered model used by the renderer. Original
message Markdown is not normalized. Attachment bytes are never fetched; available
attachment metadata is retained in an `Attachments` section.

Run the independent parser tests with:

```powershell
py -3 -m unittest discover -s tests -v
node --test tests/document.test.mjs
```

## Repository contents

The repository contains application source, standard-library tests, and documentation
only. Python virtual environments, `node_modules`, interpreter caches, editor metadata,
logs, and local agent state are ignored. Imported conversations are held in memory and
are not written into the repository.

## Architecture

The pipeline has four deliberately separate layers:

1. `retrieval.py` accepts only an HTTPS ChatGPT Share URL. Automatic redirects are
   disabled; every destination is validated before a new GET is made. No cookies,
   authentication, crawling, or secondary-resource retrieval is performed.
2. `parser.py` reads serialized React Router route data embedded in the initial HTML,
   expands its reference-indexed object graph, validates the expected structures, and
   constructs the model. It does not inspect rendered message DOM.
3. `model.py` defines the stable renderer-neutral document boundary. ChatGPT-specific
   serialization details stop at the parser.
4. `app.js` knows only the document model. It performs minimal continuous rendering and
   displays attachment metadata as placeholders.

JavaScript execution is unnecessary during import because the initial HTTP response
already contains the complete ordered conversation payload. ChatGPT's rendered DOM is
intentionally ignored: it is produced by application JavaScript, may be virtualized,
and is less complete and less stable than the stored Markdown source.

The Share serialization is private and may change. The parser therefore fails closed:
missing, ambiguous, inconsistent, or incomplete required structures produce an
`unsupported share-page format` diagnostic. It never returns a knowingly partial
document. Internal system, reasoning, context, moderation, hidden, and tool records are
excluded from rendered messages. Visible messages retain original Markdown, timestamps,
model and citation metadata, attachment metadata, and any visible invocation metadata.

The parser is the stable boundary between ChatGPT's changing private serialization and
the rest of the application. Future format changes should require changes inside the
importer, not in rendering, navigation, or export code.
