import io
import json
import unittest
import uuid
import zipfile

from project_container import ProjectContainerError, pack_project, unpack_project


def payload():
    return {
        "projectId": str(uuid.uuid4()),
        "createdAt": "2026-07-18T00:00:00.000Z",
        "savedAt": "2026-07-18T01:00:00.000Z",
        "saveGeneration": 1,
        "transcript": {
            "schema": "rend-transcript", "schemaVersion": 1,
            "provenance": {"kind": "chatgpt-share"},
            "document": {
                "id": "c", "title": "Title",
                "messages": [{"id": "m1", "author": "user", "markdown": "Hello", "attachments": []}],
            },
        },
        "editorial": {
            "schema": "rend-editorial", "schemaVersion": 1,
            "documentHeader": "Title",
            "messageEdits": [], "sections": [],
        },
    }


class ProjectContainerTests(unittest.TestCase):
    def test_round_trip_has_separate_versioned_components(self):
        archive = pack_project(payload())
        result = unpack_project(archive)
        self.assertEqual(result["manifest"]["format"], "rend-project")
        self.assertEqual(result["transcript"]["schema"], "rend-transcript")
        self.assertEqual(result["editorial"]["schema"], "rend-editorial")
        with zipfile.ZipFile(io.BytesIO(archive)) as project:
            self.assertEqual(
                set(project.namelist()),
                {"manifest.json", "transcript/document.json", "editorial/state.json"},
            )

    def test_component_tampering_is_detected(self):
        original = pack_project(payload())
        output = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(original)) as source, zipfile.ZipFile(output, "w") as target:
            for info in source.infolist():
                data = source.read(info.filename)
                if info.filename == "editorial/state.json":
                    data = json.dumps({"schema": "rend-editorial", "schemaVersion": 1}).encode()
                target.writestr(info.filename, data)
        with self.assertRaisesRegex(ProjectContainerError, "does not match"):
            unpack_project(output.getvalue())

    def test_duplicate_and_unsafe_members_are_rejected(self):
        for members in [
            [("manifest.json", b"{}"), ("manifest.json", b"{}")],
            [("../manifest.json", b"{}")],
        ]:
            with self.subTest(members=members):
                output = io.BytesIO()
                with zipfile.ZipFile(output, "w") as archive:
                    for name, data in members:
                        archive.writestr(name, data)
                with self.assertRaises(ProjectContainerError):
                    unpack_project(output.getvalue())

    def test_truncated_and_unsupported_projects_fail_closed(self):
        with self.assertRaises(ProjectContainerError):
            unpack_project(pack_project(payload())[:-12])
        value = payload()
        value["transcript"]["schemaVersion"] = 2
        with self.assertRaisesRegex(ProjectContainerError, "unsupported transcript"):
            pack_project(value)

    def test_redundant_default_editorial_state_is_rejected(self):
        value = payload()
        value["editorial"]["messageBindings"] = []
        with self.assertRaisesRegex(ProjectContainerError, "redundant fields"):
            pack_project(value)
        value = payload()
        value["editorial"]["messageEdits"] = [{"messageIndex": 0, "included": True}]
        with self.assertRaisesRegex(ProjectContainerError, "only omitted messages"):
            pack_project(value)
        value = payload()
        value["editorial"]["sections"] = [{
            "id": str(uuid.uuid4()), "text": "Anchor", "beforeMessageIndex": 0, "included": True,
        }]
        with self.assertRaisesRegex(ProjectContainerError, "section marker is invalid"):
            pack_project(value)

    def test_document_header_is_required_editorial_state(self):
        value = payload()
        del value["editorial"]["documentHeader"]
        with self.assertRaisesRegex(ProjectContainerError, "redundant fields"):
            pack_project(value)


if __name__ == "__main__":
    unittest.main()
