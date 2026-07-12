import unittest

from conversation_importer import RetrievalError, validate_share_url


class RetrievalValidationTests(unittest.TestCase):
    def test_accepts_known_share_url(self):
        url = "https://chatgpt.com/share/6a531ecc-ab7c-83e8-9e35-1286eca25d48"
        self.assertEqual(validate_share_url(url), url)

    def test_rejects_non_share_and_lookalike_urls(self):
        invalid = [
            "http://chatgpt.com/share/example",
            "https://evil.example/share/example",
            "https://chatgpt.com.evil.example/share/example",
            "https://chatgpt.com/backend-api/conversations",
            "https://user@chatgpt.com/share/example",
            "https://chatgpt.com/share/example/continue",
            "https://chatgpt.com/share/example#fragment",
        ]
        for url in invalid:
            with self.subTest(url=url), self.assertRaises(RetrievalError):
                validate_share_url(url)


if __name__ == "__main__":
    unittest.main()
