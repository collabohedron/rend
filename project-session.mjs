export function createProjectSession(project, { persisted = false, handle = null, archiveDigest = null } = {}) {
  return {
    project,
    handle,
    archiveDigest,
    revisions: { transcript: 0, editorial: 0 },
    savedRevisions: { transcript: persisted ? 0 : -1, editorial: persisted ? 0 : -1 },
  };
}

export function markTranscriptChanged(session) {
  session.revisions.transcript += 1;
}

export function markEditorialChanged(session) {
  session.revisions.editorial += 1;
}

export function dirtyState(session) {
  const transcript = session.revisions.transcript !== session.savedRevisions.transcript;
  const editorial = session.revisions.editorial !== session.savedRevisions.editorial;
  return { transcript, editorial, any: transcript || editorial };
}

export function captureSave(session, project = session.project) {
  return {
    project,
    revisions: { ...session.revisions },
  };
}

export function commitSave(session, capture, { project, handle, archiveDigest }) {
  session.project.id = project.id;
  session.project.createdAt = project.createdAt;
  session.project.savedAt = project.savedAt;
  session.project.saveGeneration = project.saveGeneration;
  session.handle = handle;
  session.archiveDigest = archiveDigest;
  session.savedRevisions.transcript = capture.revisions.transcript;
  session.savedRevisions.editorial = capture.revisions.editorial;
}
