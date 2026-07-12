from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class Attachment:
    id: str | None = None
    filename: str | None = None
    mime_type: str | None = None
    size_bytes: int | None = None
    width: int | None = None
    height: int | None = None
    reference: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Message:
    id: str
    author: str
    markdown: str
    order: int
    parent_id: str | None = None
    child_ids: list[str] = field(default_factory=list)
    created_at: float | None = None
    updated_at: float | None = None
    model: str | None = None
    citations: list[Any] = field(default_factory=list)
    content_references: list[Any] = field(default_factory=list)
    attachments: list[Attachment] = field(default_factory=list)
    tool_invocations: list[Any] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ConversationDocument:
    id: str
    title: str
    messages: list[Message]
    created_at: float | None = None
    updated_at: float | None = None
    current_node_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
