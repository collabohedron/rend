from __future__ import annotations

import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

from .errors import RetrievalError

_SHARE_ID = re.compile(r"^[A-Za-z0-9-]+$")
_ALLOWED_HOSTS = {"chatgpt.com", "www.chatgpt.com"}
_REDIRECTS = {301, 302, 303, 307, 308}


def validate_share_url(url: str) -> str:
    """Validate the only remote resource this application may retrieve."""
    try:
        parsed = urlsplit(url)
    except ValueError as exc:
        raise RetrievalError("invalid ChatGPT Share URL") from exc
    segments = [segment for segment in parsed.path.split("/") if segment]
    if (
        parsed.scheme != "https"
        or (parsed.hostname or "").lower() not in _ALLOWED_HOSTS
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port not in (None, 443)
        or len(segments) != 2
        or segments[0] != "share"
        or not _SHARE_ID.fullmatch(segments[1])
        or parsed.fragment
    ):
        raise RetrievalError("only https://chatgpt.com/share/<id> URLs are allowed")
    return url


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        return None


@dataclass(frozen=True)
class RetrievedPage:
    requested_url: str
    final_url: str
    html: str
    content_type: str
    redirects: tuple[str, ...]


def retrieve_share_page(url: str, *, timeout: float = 30, max_redirects: int = 5) -> RetrievedPage:
    """Retrieve one Share page, validating every redirect before following it."""
    validate_share_url(url)
    opener = urllib.request.build_opener(_NoRedirect)
    current = url
    redirects: list[str] = []

    for _ in range(max_redirects + 1):
        request = urllib.request.Request(
            current,
            headers={"User-Agent": "rend/0.1", "Accept": "text/html"},
            method="GET",
        )
        try:
            response = opener.open(request, timeout=timeout)
        except urllib.error.HTTPError as exc:
            if exc.code not in _REDIRECTS:
                raise RetrievalError(f"Share page returned HTTP {exc.code}") from exc
            location = exc.headers.get("Location")
            if not location:
                raise RetrievalError("redirect response omitted Location") from exc
            destination = urljoin(current, location)
            validate_share_url(destination)
            redirects.append(destination)
            current = destination
            continue
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise RetrievalError(f"could not retrieve Share page: {exc}") from exc

        with response:
            content_type = response.headers.get_content_type()
            if content_type != "text/html":
                raise RetrievalError(f"expected text/html, received {content_type}")
            charset = response.headers.get_content_charset() or "utf-8"
            try:
                html = response.read().decode(charset)
            except (LookupError, UnicodeDecodeError) as exc:
                raise RetrievalError("Share page is not valid text HTML") from exc
        return RetrievedPage(url, current, html, content_type, tuple(redirects))

    raise RetrievalError("too many redirects")
