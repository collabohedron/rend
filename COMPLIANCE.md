# Compliance

## Intended use

Rend imports a single, user-supplied ChatGPT Share link.

It performs one user-initiated retrieval of the associated ChatGPT Share page, renders the contained conversation as a continuous document, and provides local annotation, curation, export, and printing.

Rend does **not**:

- authenticate with ChatGPT
- access user accounts
- discover ChatGPT Share links
- crawl additional pages
- enumerate conversations
- perform bulk retrieval
- download attachment contents

The application operates only on conversations that have already been shared through ChatGPT Share. The supplied Share URL is the application's only external input.

## Scope

Rend is designed as a local document renderer and transcript curation tool.

Its purpose is to improve the readability of a single shared conversation while preserving the imported transcript and allowing users to add local editorial annotations for export and printing.

If OpenAI provides an official conversation export format in the future, Rend's intended direction is to support that import mechanism in place of retrieving ChatGPT Share pages whenever practical.