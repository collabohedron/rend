import unittest

from conversation_importer import UnsupportedSharePageFormat
from conversation_importer.parser import _ReferenceDecoder, _MISSING


class SerializationTests(unittest.TestCase):
    def test_deferred_promise_marker_is_omitted(self):
        values = [{"_1": 2}, "deferred", ["P", 2]]
        self.assertEqual(_ReferenceDecoder(values).decode(0), {})
        self.assertIs(_ReferenceDecoder(values).decode(2), _MISSING)

    def test_unknown_typed_value_fails_closed(self):
        with self.assertRaisesRegex(UnsupportedSharePageFormat, "unrecognized serialized type"):
            _ReferenceDecoder([["Unexpected", 0]]).decode(0)


if __name__ == "__main__":
    unittest.main()
