from __future__ import annotations

import json


def _flatten(value):
    values = []

    def add(item):
        index = len(values)
        values.append(None)
        if isinstance(item, dict):
            encoded = {}
            for key, child in item.items():
                key_index = add(str(key))
                encoded[f"_{key_index}"] = add(child)
            values[index] = encoded
        elif isinstance(item, list):
            values[index] = [add(child) for child in item]
        else:
            values[index] = item
        return index

    add(value)
    return values


def known_share_html():
    visible = [
        {
            "id": "begin",
            "author": {"role": "user"},
            "create_time": 1.0,
            "update_time": 1.5,
            "content": {"content_type": "text", "parts": ["# Start\n\n- alpha\n- beta\n\n> quoted"]},
            "metadata": {"citations": [{"url": "https://example.com"}]},
        },
        {
            "id": "middle",
            "author": {"role": "assistant"},
            "create_time": 2.0,
            "update_time": 2.5,
            "content": {
                "content_type": "text",
                "parts": ["```python\nprint('unchanged')\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |"],
            },
            "metadata": {
                "model_slug": "gpt-test",
                "content_references": [{"type": "webpage", "title": "Example"}],
            },
        },
        {
            "id": "end",
            "author": {"role": "user"},
            "create_time": 3.0,
            "update_time": 3.5,
            "content": {
                "content_type": "multimodal_text",
                "parts": [
                    {
                        "content_type": "image_asset_pointer",
                        "asset_pointer": "sediment://file_image?shared_conversation_id=known-share",
                        "size_bytes": 42,
                        "width": 640,
                        "height": 480,
                    },
                    "The end.",
                ],
            },
            "metadata": {
                "attachments": [
                    {"id": "file_image", "name": "photo.png", "mime_type": "image/png", "size": 42}
                ]
            },
        },
    ]
    hidden = {
        "id": "hidden",
        "author": {"role": "assistant"},
        "content": {"content_type": "reasoning_recap", "parts": ["private reasoning"]},
        "metadata": {"is_visually_hidden_from_conversation": True},
    }
    nodes = [
        {"id": "root", "children": ["hidden"]},
        {"id": "hidden", "message": hidden, "parent": "root", "children": ["begin"]},
        {"id": "begin", "message": visible[0], "parent": "hidden", "children": ["middle"]},
        {"id": "middle", "message": visible[1], "parent": "begin", "children": ["end"]},
        {"id": "end", "message": visible[2], "parent": "middle", "children": []},
    ]
    data = {
        "conversation_id": "known-share",
        "title": "Known Share Fixture",
        "create_time": 1.0,
        "update_time": 3.5,
        "mapping": {node["id"]: node for node in nodes},
        "linear_conversation": nodes,
        "current_node": "end",
        "default_model_slug": "gpt-test",
        "is_public": True,
    }
    root = {
        "loaderData": {
            "root": {},
            "routes/share.$shareId.($action)": {"serverResponse": {"type": "data", "data": data}},
        },
        "actionData": None,
        "errors": None,
    }
    stream = json.dumps(_flatten(root), separators=(",", ":"))
    script = f"window.__reactRouterContext.streamController.enqueue({json.dumps(stream)});"
    return f"<!doctype html><html><body><script>{script}</script></body></html>"
