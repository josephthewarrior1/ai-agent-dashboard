"""Read-only chat history tests. All Hermes data and authentication are synthetic."""
import copy
import http.client
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.parse import unquote
from urllib.request import Request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app


class AuditClient:
    base = "https://hermes.example.test"

    def __init__(self):
        self.calls = []
        self.authenticated = True
        self.failure = None
        self.owner_override = None
        self.resolved = "session:shared"
        self.messages_profile = False  # Official Hermes v0.21.1 omits this field.
        self.rows = [
            {"id": 1, "role": "user", "content": "Actual request\n<script>alert('literal text')</script>", "timestamp": 200},
            {"id": 2, "role": "assistant", "content": "Checking the report", "timestamp": 190,
             "reasoning": "PRIVATE REASONING", "api_content": "PRIVATE API CONTENT",
             "tool_calls": [{"id": "call-1", "function": {"name": "read_report", "arguments": {"day": "Monday"}}}]},
            {"id": 3, "role": "tool", "content": "Report complete", "tool_name": "read_report", "tool_call_id": "call-1"},
            {"id": 4, "role": "system", "content": "PRIVATE SYSTEM PROMPT"},
            {"id": 5, "role": "assistant", "display_kind": "hidden", "content": "PRIVATE COMPACTION"},
            {"id": 6, "role": "user", "content": [{"type": "text", "text": "See attachment"},
                {"type": "image_url", "image_url": {"url": "https://do-not-load.example/private.png"}},
                {"type": "thinking", "thinking": "PRIVATE STRUCTURED REASONING"}]},
        ]

    def has_session(self):
        return self.authenticated

    def login(self, username, password):
        self.authenticated = True

    def get(self, path, query=None):
        self.calls.append((path, copy.deepcopy(query)))
        if self.failure:
            raise self.failure
        profile = query["profile"]
        if path == "/api/profiles/sessions":
            return {"sessions": [{"id": "session:shared", "profile": profile, "title": "Existing report chat",
                                  "source": "telegram", "message_count": 6, "preview": "PRIVATE PREVIEW",
                                  "model_config": {"api_key": "PRIVATE CONFIG"}}],
                    "total": 1, "limit": query["limit"], "offset": query["offset"], "errors": []}
        if path.endswith("/messages"):
            selected = self.rows[query["offset"]:query["offset"] + query["limit"]]
            payload = {"session_id": self.resolved, "messages": copy.deepcopy(selected),
                       "pagination": {"limit": query["limit"], "offset": query["offset"], "order": query["order"], "returned": len(selected)}}
            if self.messages_profile:
                payload["profile"] = profile
            return payload
        if path.startswith("/api/sessions/"):
            identifier = unquote(path.rsplit("/", 1)[-1])
            return {"id": identifier, "profile": self.owner_override or profile, "title": "Existing report chat",
                    "message_count": 6, "system_prompt": "PRIVATE SYSTEM", "model_config": {"api_key": "PRIVATE CONFIG"}}
        raise AssertionError("Unexpected upstream endpoint")


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.client = AuditClient()
        self.now = 1000
        self.monitor = app.Monitor(self.client, self.directory, clock=lambda: self.now)
        self.monitor.profiles = {name: {"name": name, "display_name": name} for name in ("alpha", "beta")}

    def tearDown(self):
        self.monitor.close()
        self.temporary.cleanup()

    def test_actual_chat_fields_preserve_order_and_source_pagination(self):
        response = self.monitor.audit_messages("alpha", "session:shared", limit=6)
        self.assertTrue(response["available"])
        self.assertEqual([m["id"] for m in response["messages"]], ["1", "2", "3", "6"])
        self.assertEqual(response["messages"][0]["timestamp"], 200)
        self.assertEqual(response["messages"][1]["timestamp"], 190)
        self.assertIsNone(response["messages"][2]["timestamp"])
        self.assertIn("\n<script>", response["messages"][0]["content"])
        self.assertEqual(response["messages"][1]["tool_calls"], [{"id": "call-1", "name": "read_report", "arguments": '{"day":"Monday"}'}])
        self.assertEqual(response["messages"][2]["tool_name"], "read_report")
        self.assertEqual(response["messages"][3]["content"], "See attachment")
        self.assertEqual(response["messages"][3]["attachment_count"], 1)
        self.assertEqual(response["pagination"]["returned"], 6)
        self.assertTrue(response["pagination"]["has_more"])
        for value in ("PRIVATE REASONING", "PRIVATE API CONTENT", "PRIVATE SYSTEM PROMPT", "PRIVATE COMPACTION",
                      "PRIVATE STRUCTURED REASONING", "PRIVATE CONFIG", "do-not-load.example"):
            self.assertNotIn(value, json.dumps(response))
        self.assertTrue(all(query["profile"] == "alpha" for _, query in self.client.calls))
        self.assertEqual(self.client.calls[1][1]["include_compacted"], "false")

    def test_session_list_returns_only_selected_profile_metadata(self):
        response = self.monitor.audit_sessions("beta")
        self.assertTrue(response["available"])
        self.assertEqual(response["sessions"][0]["profile"], "beta")
        self.assertEqual(response["sessions"][0]["title"], "Existing report chat")
        self.assertEqual(response["pagination"]["total"], 1)
        self.assertNotIn("PRIVATE", json.dumps(response))
        self.assertEqual(self.client.calls, [("/api/profiles/sessions", {"profile": "beta", "limit": 50, "offset": 0, "order": "recent"})])

    def test_no_transcript_content_enters_global_state_or_disk(self):
        self.monitor.audit_messages("alpha", "session:shared")
        self.assertNotIn("Actual request", json.dumps(self.monitor.snapshot()))
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_cache_ttl_and_connection_change_invalidate_history(self):
        first = self.monitor.audit_messages("alpha", "session:shared")
        self.assertFalse(first["cached"])
        count = len(self.client.calls)
        self.assertTrue(self.monitor.audit_messages("alpha", "session:shared")["cached"])
        self.assertEqual(len(self.client.calls), count)
        self.now += 11
        self.monitor.audit_messages("alpha", "session:shared")
        self.assertEqual(len(self.client.calls), count * 2)
        with patch.object(self.monitor, "request_refresh"):
            self.monitor.connect("synthetic-user", "synthetic-password")
        self.assertEqual(self.monitor.audit_cache, {})
        self.monitor.audit_messages("alpha", "session:shared")
        self.assertEqual(len(self.client.calls), count * 3)
        self.client.authenticated = False
        unavailable = self.monitor.audit_messages("alpha", "session:shared")
        self.assertFalse(unavailable["available"])
        self.assertTrue(unavailable["requires_login"])
        self.assertEqual(unavailable["messages"], [])
        self.assertEqual(self.monitor.audit_cache, {})

    def test_owner_mismatch_is_unavailable_without_chat_content(self):
        self.client.owner_override = "beta"
        response = self.monitor.audit_messages("alpha", "session:shared")
        self.assertFalse(response["available"])
        self.assertEqual(response["messages"], [])
        self.assertEqual(len(self.client.calls), 1)
        self.assertNotIn("Actual request", json.dumps(response))

    def test_errors_are_honest_sanitized_and_retry_is_bounded(self):
        self.client.failure = app.SourceError("PRIVATE SERVER TRACE", requires_login=True)
        response = self.monitor.audit_messages("alpha", "session:shared")
        self.assertFalse(response["available"])
        self.assertTrue(response["requires_login"])
        self.assertNotIn("PRIVATE", json.dumps(response))
        count = len(self.client.calls)
        self.monitor.audit_messages("alpha", "session:shared")
        self.assertEqual(len(self.client.calls), count)
        self.now += 11
        self.monitor.audit_messages("alpha", "session:shared")
        self.assertEqual(len(self.client.calls), count + 1)

    def test_text_tool_arguments_and_cache_size_are_bounded(self):
        self.client.rows = [{"id": i, "role": "assistant", "content": "x" * 20_000,
                            "tool_calls": [{"id": "call", "function": {"name": "read", "arguments": "y" * 10_000}}]} for i in range(100)]
        response = self.monitor.audit_messages("alpha", "session:shared", limit=100)
        self.assertTrue(all(len(m["content"]) <= app.MAX_MESSAGE_TEXT for m in response["messages"]))
        self.assertTrue(any(m["truncated"] for m in response["messages"]))
        self.assertLess(len(json.dumps(response).encode()), app.MAX_REMOTE_BODY)
        for offset in range(app.MAX_AUDIT_CACHE + 5):
            self.monitor.audit_messages("alpha", "session:shared", limit=1, offset=offset)
        self.assertLessEqual(len(self.monitor.audit_cache), app.MAX_AUDIT_CACHE)


class AuditHttpTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.client = AuditClient()
        self.monitor = app.Monitor(self.client, self.directory)
        self.monitor.profiles = {name: {"name": name, "display_name": name} for name in ("alpha", "beta")}
        web = self.directory / "web"
        web.mkdir()
        (web / "index.html").write_text("<p>History</p>")
        self.server = app.OfficeServer(("127.0.0.1", 0), self.monitor, web)
        self.worker = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": .01}, daemon=True)
        self.worker.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join(1)
        self.monitor.close()
        self.temporary.cleanup()

    def get(self, path, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        try:
            connection.request("GET", path, headers=headers or {})
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def test_routes_reject_invalid_scope_cross_site_and_unknown_profiles(self):
        base = "/api/audit/messages?profile=alpha&session_id=session%3Ashared"
        self.assertEqual(self.get(base)[0], 200)
        calls = len(self.client.calls)
        for path in (base + "&url=https://evil.test", base + "&profile=beta", base + "&limit=101",
                     base + "&offset=-1", base + "&order=wrong", "/api/audit/messages?profile=alpha&session_id=..%2Fconfig"):
            self.assertEqual(self.get(path)[0], 400)
        self.assertEqual(self.get("/api/audit/sessions?profile=unknown")[0], 404)
        self.assertEqual(self.get(base, {"Host": "evil.test"})[0], 403)
        self.assertEqual(self.get(base, {"Origin": "https://evil.test"})[0], 403)
        self.assertEqual(self.get(base, {"Sec-Fetch-Site": "cross-site"})[0], 403)
        self.assertEqual(len(self.client.calls), calls)


if __name__ == "__main__":
    unittest.main()
