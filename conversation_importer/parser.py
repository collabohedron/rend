from __future__ import annotations

import json
from html.parser import HTMLParser
from typing import Any

from .errors import UnsupportedSharePageFormat
from .model import Attachment, ConversationDocument, Message

_ENQUEUE = "window.__reactRouterContext.streamController.enqueue("
_MISSING = object()


class _ScriptCollector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.scripts: list[str] = []
        self._inside = False
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "script":
            self._inside = True
            self._parts = []

    def handle_data(self, data: str) -> None:
        if self._inside:
            self._parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "script" and self._inside:
            self.scripts.append("".join(self._parts))
            self._inside = False


class _ReferenceDecoder:
    """Decode the flattened reference graph used by current route data."""

    def __init__(self, values: list[Any]) -> None:
        self.values = values
        self.memo: dict[int, Any] = {}

    def decode(self, index: int) -> Any:
        if index < 0:
            return _MISSING
        if index >= len(self.values):
            raise UnsupportedSharePageFormat("serialized reference is out of range")
        if index in self.memo:
            return self.memo[index]
        value = self.values[index]
        if value is None or isinstance(value, (str, bool, float, int)):
            return value
        if isinstance(value, list):
            # Turbo Stream uses ["P", <id>] for a deferred Promise whose value is
            # delivered in a later protocol frame. Share-page conversation data is
            # not deferred; unrelated root-loader experiments currently are. Omit
            # that explicitly recognized value rather than attempting to execute or
            # await page code. Unknown typed values still fail closed below.
            if value and isinstance(value[0], str):
                if value[0] == "P" and len(value) == 2 and isinstance(value[1], int):
                    self.memo[index] = _MISSING
                    return _MISSING
                raise UnsupportedSharePageFormat(f"unrecognized serialized type {value[0]!r}")
            result: list[Any] = []
            self.memo[index] = result
            for item in value:
                decoded = self._decode_reference(item)
                if decoded is not _MISSING:
                    result.append(decoded)
            return result
        if isinstance(value, dict):
            result: dict[str, Any] = {}
            self.memo[index] = result
            for key, item in value.items():
                if key.startswith("_") and key[1:].isdigit():
                    decoded_key = self.decode(int(key[1:]))
                else:
                    decoded_key = key
                if not isinstance(decoded_key, str):
                    raise UnsupportedSharePageFormat("serialized object key is not text")
                decoded = self._decode_reference(item)
                if decoded is not _MISSING:
                    result[decoded_key] = decoded
            return result
        raise UnsupportedSharePageFormat("unrecognized serialized value")

    def _decode_reference(self, value: Any) -> Any:
        if isinstance(value, bool) or not isinstance(value, int):
            raise UnsupportedSharePageFormat("serialized container contains a non-reference")
        return self.decode(value)


def _extract_route_root(html: str) -> dict[str, Any]:
    collector = _ScriptCollector()
    collector.feed(html)
    chunks: list[str] = []
    decoder = json.JSONDecoder()
    for script in collector.scripts:
        start = 0
        while (position := script.find(_ENQUEUE, start)) >= 0:
            argument_at = position + len(_ENQUEUE)
            try:
                chunk, consumed = decoder.raw_decode(script[argument_at:])
            except json.JSONDecodeError as exc:
                raise UnsupportedSharePageFormat("route-data stream is not valid JSON") from exc
            if isinstance(chunk, str):
                chunks.append(chunk)
            start = argument_at + consumed
    candidates = [chunk.strip() for chunk in chunks if chunk.lstrip().startswith("[")]
    if len(candidates) != 1:
        raise UnsupportedSharePageFormat("expected one embedded route-data payload")
    try:
        flattened = json.loads(candidates[0])
    except json.JSONDecodeError as exc:
        raise UnsupportedSharePageFormat("embedded route data is not valid JSON") from exc
    if not isinstance(flattened, list) or not flattened:
        raise UnsupportedSharePageFormat("embedded route data is not a value table")
    root = _ReferenceDecoder(flattened).decode(0)
    if not isinstance(root, dict):
        raise UnsupportedSharePageFormat("route-data root is not an object")
    return root


def _find_conversation(root: dict[str, Any]) -> dict[str, Any]:
    loader_data = root.get("loaderData")
    if not isinstance(loader_data, dict):
        raise UnsupportedSharePageFormat("loaderData is missing")
    matches: list[dict[str, Any]] = []
    for route in loader_data.values():
        if not isinstance(route, dict):
            continue
        response = route.get("serverResponse")
        if not isinstance(response, dict) or response.get("type") != "data":
            continue
        data = response.get("data")
        if isinstance(data, dict) and isinstance(data.get("linear_conversation"), list):
            matches.append(data)
    if len(matches) != 1:
        raise UnsupportedSharePageFormat("expected one conversation server response")
    return matches[0]


def _attachments(content: dict[str, Any], metadata: dict[str, Any]) -> list[Attachment]:
    by_id: dict[str, dict[str, Any]] = {}
    for raw in metadata.get("attachments", []):
        if isinstance(raw, dict):
            key = str(raw.get("id") or raw.get("name") or len(by_id))
            by_id[key] = dict(raw)
    pointers: dict[str, dict[str, Any]] = {}
    for part in content.get("parts", []):
        if isinstance(part, dict) and part.get("content_type") == "image_asset_pointer":
            reference = part.get("asset_pointer")
            file_id = None
            if isinstance(reference, str) and reference.startswith("sediment://"):
                file_id = reference.removeprefix("sediment://").split("?", 1)[0]
            pointers[str(file_id or reference or len(pointers))] = part
    keys = list(dict.fromkeys([*by_id, *pointers]))
    result: list[Attachment] = []
    for key in keys:
        raw = by_id.get(key, {})
        pointer = pointers.get(key, {})
        result.append(
            Attachment(
                id=raw.get("id") or (key if key.startswith("file_") else None),
                filename=raw.get("name"),
                mime_type=raw.get("mime_type") or pointer.get("mime_type"),
                size_bytes=raw.get("size") or pointer.get("size_bytes"),
                width=raw.get("width") or pointer.get("width"),
                height=raw.get("height") or pointer.get("height"),
                reference=pointer.get("asset_pointer"),
                metadata={"attachment": raw, "pointer": pointer},
            )
        )
    return result


def parse_share_page(html: str) -> ConversationDocument:
    """Parse a complete Share response without executing page JavaScript."""
    data = _find_conversation(_extract_route_root(html))
    required = ("conversation_id", "title", "linear_conversation", "mapping", "current_node")
    if any(key not in data for key in required):
        raise UnsupportedSharePageFormat("conversation metadata is incomplete")
    linear = data["linear_conversation"]
    mapping = data["mapping"]
    if not isinstance(mapping, dict) or not linear:
        raise UnsupportedSharePageFormat("conversation ordering is empty or invalid")

    messages: list[Message] = []
    for node in linear:
        if not isinstance(node, dict):
            raise UnsupportedSharePageFormat("linear conversation contains an invalid node")
        raw = node.get("message")
        if raw is None:
            continue
        if not isinstance(raw, dict):
            raise UnsupportedSharePageFormat("message record is invalid")
        metadata = raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {}
        author = raw.get("author") if isinstance(raw.get("author"), dict) else {}
        content = raw.get("content") if isinstance(raw.get("content"), dict) else {}
        role = author.get("role")
        content_type = content.get("content_type")
        visible = (
            role in {"user", "assistant"}
            and content_type in {"text", "multimodal_text"}
            and metadata.get("is_visually_hidden_from_conversation") is not True
        )
        if not visible:
            continue
        message_id = raw.get("id")
        if not isinstance(message_id, str) or message_id not in mapping:
            raise UnsupportedSharePageFormat("visible message lacks a mapped id")
        parts = content.get("parts")
        if not isinstance(parts, list):
            raise UnsupportedSharePageFormat("visible message content has no parts")
        markdown = "".join(part for part in parts if isinstance(part, str))
        attachments = _attachments(content, metadata)
        if not markdown and not attachments:
            raise UnsupportedSharePageFormat("visible message has neither text nor attachment metadata")
        model = metadata.get("resolved_model_slug") or metadata.get("model_slug")
        tool_invocations = metadata.get("tool_invocations", [])
        if not isinstance(tool_invocations, list):
            tool_invocations = [tool_invocations]
        messages.append(
            Message(
                id=message_id,
                author=role,
                markdown=markdown,
                order=len(messages),
                parent_id=node.get("parent"),
                child_ids=[item for item in node.get("children", []) if isinstance(item, str)],
                created_at=raw.get("create_time"),
                updated_at=raw.get("update_time"),
                model=model if isinstance(model, str) else None,
                citations=metadata.get("citations", []) if isinstance(metadata.get("citations", []), list) else [],
                content_references=(
                    metadata.get("content_references", [])
                    if isinstance(metadata.get("content_references", []), list)
                    else []
                ),
                attachments=attachments,
                tool_invocations=tool_invocations,
                metadata=metadata,
            )
        )
    if not messages:
        raise UnsupportedSharePageFormat("conversation contains no visible messages")
    current = data.get("current_node")
    if current not in mapping:
        raise UnsupportedSharePageFormat("current node is absent from the conversation mapping")
    return ConversationDocument(
        id=str(data["conversation_id"]),
        title=str(data["title"]),
        messages=messages,
        created_at=data.get("create_time"),
        updated_at=data.get("update_time"),
        current_node_id=current,
        metadata={
            "default_model_slug": data.get("default_model_slug"),
            "is_public": data.get("is_public"),
            "model": data.get("model"),
        },
    )
