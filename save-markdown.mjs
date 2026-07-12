export async function saveMarkdown({ markdown, filename, windowObject, documentObject, handleStore }) {
  if (typeof windowObject.showSaveFilePicker === "function") {
    try {
      const previousHandle = await safelyGetHandle(handleStore);
      const options = {
        suggestedName: filename,
        id: "conversation-viewer-markdown",
        types: [{ description: "Markdown document", accept: { "text/markdown": [".md"] } }],
      };
      if (previousHandle) options.startIn = previousHandle;
      const handle = await windowObject.showSaveFilePicker(options);
      const writable = await handle.createWritable();
      await writable.write(markdown);
      await writable.close();
      await safelySetHandle(handleStore, handle);
      return { method: "file-system" };
    } catch (error) {
      if (error?.name === "AbortError") return { method: "cancelled" };
      return downloadMarkdown({ markdown, filename, windowObject, documentObject });
    }
  }
  return downloadMarkdown({ markdown, filename, windowObject, documentObject });
}

async function safelySetHandle(handleStore, handle) {
  try {
    await handleStore?.set(handle);
  } catch {
    // The transcript is already saved. Failure to remember its handle must not
    // produce a second download or turn a successful write into an error.
  }
}

async function safelyGetHandle(handleStore) {
  try {
    return await handleStore?.get() || null;
  } catch {
    return null;
  }
}

function downloadMarkdown({ markdown, filename, windowObject, documentObject }) {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = windowObject.URL.createObjectURL(blob);
  const link = documentObject.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  windowObject.URL.revokeObjectURL(url);
  return { method: "download" };
}
