import unittest

from conversation_importer import UnsupportedSharePageFormat, parse_share_page
from tests.fixtures import known_share_html


class ParserTests(unittest.TestCase):
    def setUp(self):
        self.document = parse_share_page(known_share_html())

    def test_known_share_beginning_middle_and_end(self):
        self.assertEqual(self.document.id, "known-share")
        self.assertEqual(self.document.title, "Known Share Fixture")
        self.assertEqual([message.id for message in self.document.messages], ["begin", "middle", "end"])
        self.assertEqual([message.order for message in self.document.messages], [0, 1, 2])

    def test_markdown_is_preserved_verbatim(self):
        beginning, middle, _ = self.document.messages
        self.assertIn("- alpha\n- beta", beginning.markdown)
        self.assertIn("> quoted", beginning.markdown)
        self.assertIn("```python\nprint('unchanged')\n```", middle.markdown)
        self.assertIn("| A | B |\n| - | - |", middle.markdown)

    def test_metadata_and_attachments_are_preserved(self):
        beginning, middle, ending = self.document.messages
        self.assertEqual(beginning.citations[0]["url"], "https://example.com")
        self.assertEqual(middle.content_references[0]["title"], "Example")
        self.assertEqual(middle.model, "gpt-test")
        attachment = ending.attachments[0]
        self.assertEqual(attachment.filename, "photo.png")
        self.assertEqual((attachment.width, attachment.height), (640, 480))
        self.assertTrue(attachment.reference.startswith("sediment://"))

    def test_internal_messages_are_filtered(self):
        self.assertNotIn("hidden", [message.id for message in self.document.messages])
        self.assertNotIn("private reasoning", "".join(message.markdown for message in self.document.messages))

    def test_missing_serialization_fails_closed(self):
        with self.assertRaisesRegex(UnsupportedSharePageFormat, "unsupported share-page format"):
            parse_share_page("<html><body>not a share payload</body></html>")

    def test_incomplete_serialization_fails_closed(self):
        damaged = known_share_html().replace("current_node", "unexpected_node")
        with self.assertRaisesRegex(UnsupportedSharePageFormat, "unsupported share-page format"):
            parse_share_page(damaged)


if __name__ == "__main__":
    unittest.main()
