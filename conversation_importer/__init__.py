"""Import public ChatGPT Share pages into a renderer-neutral document model."""

from .errors import ImporterError, RetrievalError, UnsupportedSharePageFormat
from .model import Attachment, ConversationDocument, Message
from .parser import parse_share_page
from .retrieval import retrieve_share_page, validate_share_url

__all__ = [
    "Attachment",
    "ConversationDocument",
    "ImporterError",
    "Message",
    "RetrievalError",
    "UnsupportedSharePageFormat",
    "parse_share_page",
    "retrieve_share_page",
    "validate_share_url",
]
