from __future__ import annotations

import hashlib
import io
import json
import stat
import uuid
import zipfile
from typing import Any


MANIFEST_PATH = "manifest.json"
TRANSCRIPT_PATH = "transcript/document.json"
EDITORIAL_PATH = "editorial/state.json"
REQUIRED_PATHS = {MANIFEST_PATH, TRANSCRIPT_PATH, EDITORIAL_PATH}
MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_COMPONENT_BYTES = 128 * 1024 * 1024
MAX_TOTAL_UNCOMPRESSED_BYTES = 192 * 1024 * 1024


class ProjectContainerError(ValueError):
    pass


def pack_project(value: dict[str, Any]) -> bytes:
    """Build and validate a complete version-1 Rend project container."""
    if not isinstance(value, dict):
        raise ProjectContainerError("project payload must be an object")
    project_id = _project_id(value.get("projectId"))
    created_at = _text(value.get("createdAt"), "createdAt")
    saved_at = _text(value.get("savedAt"), "savedAt")
    generation = value.get("saveGeneration")
    if not isinstance(generation, int) or isinstance(generation, bool) or generation < 1:
        raise ProjectContainerError("saveGeneration must be a positive integer")

    transcript = _component(value.get("transcript"), "rend-transcript", "transcript")
    editorial = _component(value.get("editorial"), "rend-editorial", "editorial")
    _validate_project_components(transcript, editorial)
    transcript_bytes = _json_bytes(transcript)
    editorial_bytes = _json_bytes(editorial)
    _check_component_size(transcript_bytes, "transcript")
    _check_component_size(editorial_bytes, "editorial")

    manifest = {
        "format": "rend-project",
        "manifestVersion": 1,
        "projectId": project_id,
        "createdAt": created_at,
        "savedAt": saved_at,
        "saveGeneration": generation,
        "generator": {"name": "rend", "version": "0.2.0"},
        "components": {
            "transcript": _manifest_component(TRANSCRIPT_PATH, transcript_bytes, transcript["schemaVersion"]),
            "editorial": _manifest_component(EDITORIAL_PATH, editorial_bytes, editorial["schemaVersion"]),
        },
    }
    manifest_bytes = _json_bytes(manifest)

    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path, data in (
            (MANIFEST_PATH, manifest_bytes),
            (TRANSCRIPT_PATH, transcript_bytes),
            (EDITORIAL_PATH, editorial_bytes),
        ):
            info = zipfile.ZipInfo(path, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            archive.writestr(info, data)
    result = output.getvalue()
    if len(result) > MAX_ARCHIVE_BYTES:
        raise ProjectContainerError("project archive exceeds the supported size")
    unpack_project(result)
    return result


def unpack_project(data: bytes) -> dict[str, Any]:
    """Validate a version-1 Rend container and return its parsed components."""
    if not isinstance(data, bytes) or not data:
        raise ProjectContainerError("project archive is empty")
    if len(data) > MAX_ARCHIVE_BYTES:
        raise ProjectContainerError("project archive exceeds the supported size")
    try:
        with zipfile.ZipFile(io.BytesIO(data), "r") as archive:
            infos = archive.infolist()
            names = [info.filename for info in infos]
            if len(names) != len(set(names)):
                raise ProjectContainerError("project archive contains duplicate members")
            if set(names) != REQUIRED_PATHS:
                raise ProjectContainerError("project archive has missing or unexpected members")
            total = 0
            for info in infos:
                _validate_member(info)
                total += info.file_size
            if total > MAX_TOTAL_UNCOMPRESSED_BYTES:
                raise ProjectContainerError("project archive expands beyond the supported size")
            raw = {name: archive.read(name) for name in REQUIRED_PATHS}
    except ProjectContainerError:
        raise
    except (zipfile.BadZipFile, OSError, RuntimeError) as exc:
        raise ProjectContainerError("project is not a valid Rend container") from exc

    manifest = _parse_json(raw[MANIFEST_PATH], "manifest")
    if manifest.get("format") != "rend-project" or manifest.get("manifestVersion") != 1:
        raise ProjectContainerError("unsupported Rend manifest version")
    _project_id(manifest.get("projectId"))
    _text(manifest.get("createdAt"), "createdAt")
    _text(manifest.get("savedAt"), "savedAt")
    generation = manifest.get("saveGeneration")
    if not isinstance(generation, int) or isinstance(generation, bool) or generation < 1:
        raise ProjectContainerError("manifest saveGeneration is invalid")

    transcript = _parse_json(raw[TRANSCRIPT_PATH], "transcript")
    editorial = _parse_json(raw[EDITORIAL_PATH], "editorial")
    _component(transcript, "rend-transcript", "transcript")
    _component(editorial, "rend-editorial", "editorial")
    components = manifest.get("components")
    if not isinstance(components, dict):
        raise ProjectContainerError("manifest components are missing")
    _verify_manifest_component(components.get("transcript"), TRANSCRIPT_PATH, raw[TRANSCRIPT_PATH], transcript)
    _verify_manifest_component(components.get("editorial"), EDITORIAL_PATH, raw[EDITORIAL_PATH], editorial)
    _validate_project_components(transcript, editorial)
    return {"manifest": manifest, "transcript": transcript, "editorial": editorial}


def _validate_member(info: zipfile.ZipInfo) -> None:
    name = info.filename
    if info.is_dir() or name.startswith(("/", "\\")) or "\\" in name or ".." in name.split("/"):
        raise ProjectContainerError("project archive contains an unsafe member name")
    if info.flag_bits & 0x1:
        raise ProjectContainerError("encrypted project members are not supported")
    if info.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
        raise ProjectContainerError("unsupported project compression method")
    mode = info.external_attr >> 16
    if mode and stat.S_ISLNK(mode):
        raise ProjectContainerError("project archive may not contain symbolic links")
    if info.file_size > MAX_COMPONENT_BYTES:
        raise ProjectContainerError("project component exceeds the supported size")
    if info.file_size > 1_048_576 and info.compress_size and info.file_size / info.compress_size > 1000:
        raise ProjectContainerError("project archive has an unsafe compression ratio")


def _component(value: Any, schema: str, label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != schema or value.get("schemaVersion") != 1:
        raise ProjectContainerError(f"unsupported {label} schema")
    return value


def _validate_project_components(transcript: dict[str, Any], editorial: dict[str, Any]) -> None:
    document = transcript.get("document")
    messages = document.get("messages") if isinstance(document, dict) else None
    if not isinstance(messages, list) or not messages:
        raise ProjectContainerError("transcript document is invalid")
    if set(editorial) != {"schema", "schemaVersion", "documentHeader", "messageEdits", "sections"}:
        raise ProjectContainerError("editorial overlay contains unsupported or redundant fields")
    if not isinstance(editorial.get("documentHeader"), str) or not editorial["documentHeader"].strip():
        raise ProjectContainerError("document header is empty")
    edits = editorial.get("messageEdits")
    sections = editorial.get("sections")
    if not isinstance(edits, list) or not isinstance(sections, list):
        raise ProjectContainerError("editorial overlay collections are invalid")
    edited: set[int] = set()
    for edit in edits:
        if not isinstance(edit, dict) or not set(edit).issubset({"messageIndex", "included", "note"}):
            raise ProjectContainerError("message edit is invalid")
        index = edit.get("messageIndex")
        if not isinstance(index, int) or isinstance(index, bool) or index < 0 or index >= len(messages) or index in edited:
            raise ProjectContainerError("message edit target is invalid or duplicated")
        edited.add(index)
        if "included" in edit and edit["included"] is not False:
            raise ProjectContainerError("editorial overlay may persist only omitted messages")
        if "note" in edit:
            _validate_note(edit["note"])
        if edit.get("included") is not False and "note" not in edit:
            raise ProjectContainerError("message edit contains no non-default state")
    section_ids: set[str] = set()
    previous_boundary = -1
    for section in sections:
        if not isinstance(section, dict) or not set(section).issubset({"id", "text", "beforeMessageIndex"}):
            raise ProjectContainerError("section marker is invalid")
        section_id = section.get("id")
        text = section.get("text")
        boundary = section.get("beforeMessageIndex")
        if not isinstance(section_id, str) or not section_id or section_id in section_ids:
            raise ProjectContainerError("section marker ID is invalid or duplicated")
        section_ids.add(section_id)
        if not isinstance(text, str) or not text.strip():
            raise ProjectContainerError("section marker text is empty")
        if not isinstance(boundary, int) or isinstance(boundary, bool) or boundary < 0 or boundary > len(messages) or boundary < previous_boundary:
            raise ProjectContainerError("section marker position is invalid")
        previous_boundary = boundary


def _validate_note(note: Any) -> None:
    if not isinstance(note, dict) or set(note) != {"id", "text"}:
        raise ProjectContainerError("message note is invalid")
    if not isinstance(note.get("id"), str) or not note["id"] or not isinstance(note.get("text"), str):
        raise ProjectContainerError("message note is invalid")


def _verify_manifest_component(entry: Any, path: str, data: bytes, parsed: dict[str, Any]) -> None:
    if not isinstance(entry, dict):
        raise ProjectContainerError("manifest component entry is invalid")
    if (
        entry.get("path") != path
        or entry.get("mediaType") != "application/json"
        or entry.get("schemaVersion") != parsed.get("schemaVersion")
        or entry.get("byteLength") != len(data)
        or entry.get("sha256") != hashlib.sha256(data).hexdigest()
    ):
        raise ProjectContainerError("project component does not match its manifest")


def _manifest_component(path: str, data: bytes, schema_version: int) -> dict[str, Any]:
    return {
        "path": path,
        "schemaVersion": schema_version,
        "mediaType": "application/json",
        "byteLength": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _parse_json(data: bytes, label: str) -> dict[str, Any]:
    try:
        value = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ProjectContainerError(f"{label} is not valid UTF-8 JSON") from exc
    if not isinstance(value, dict):
        raise ProjectContainerError(f"{label} must be a JSON object")
    return value


def _project_id(value: Any) -> str:
    if not isinstance(value, str):
        raise ProjectContainerError("projectId must be a UUID")
    try:
        uuid.UUID(value)
    except ValueError as exc:
        raise ProjectContainerError("projectId must be a UUID") from exc
    return value


def _text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise ProjectContainerError(f"{field} must be text")
    return value


def _check_component_size(data: bytes, label: str) -> None:
    if len(data) > MAX_COMPONENT_BYTES:
        raise ProjectContainerError(f"{label} exceeds the supported size")
