"""Independent audit regressions; synthetic source responses only, no remote calls."""
from __future__ import annotations

import copy
from email.message import Message
import http.client
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.request import Request


SPEC = importlib.util.spec_from_file_location("office_audit_review", Path(__file__).resolve().parents[1] / "app.py")
office = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(office)
SOURCE = "https://hermes.example.test/hermes"
PRIVATE = "synthetic-transcript-only-marker"
HIDDEN = "synthetic-hidden-reasoning-marker"


def session(profile="alpha", identifier="session-1"):
    return {"id": identifier, "profile": profile, "title": "Existing session", "source": "telegram",
            "started_at": 10, "last_active": 20, "message_count": 5, "tool_call_count": 1,
            "preview": HIDDEN, "system_prompt": HIDDEN}


class AuditHermes:
    base = SOURCE

    def __init__(self):
        self.authenticated = True
        self.calls = []
        self.details = {}
        self.message_owner = None  # Genuine v0.21.1 response omits this field.
        self.resolved = "session-1"
        self.rows = [{"id": 1, "role": "user", "content": PRIVATE, "timestamp": 11}]
        self.failure = None
        self.sessions = None
        self.pagination_override = {}

    def has_session(self):
        return self.authenticated

    def login(self, username, password):
        self.calls.append(("POST", "/auth/password-login", None))
        self.authenticated = True

    def get(self, path, query=None):
        self.calls.append(("GET", path, copy.deepcopy(query)))
        if self.failure:
            raise self.failure
        profile = query["profile"]
        if path == "/api/profiles/sessions":
            rows = self.sessions if self.sessions is not None else [session(profile)]
            return {"sessions": copy.deepcopy(rows), "limit": query["limit"], "offset": query["offset"],
                    "total": len(rows) + query["offset"], "errors": []}
        if path.endswith("/messages"):
            result = {"session_id": self.resolved, "messages": copy.deepcopy(self.rows),
                      "pagination": {"limit": query["limit"], "offset": query["offset"], "order": query["order"],
                                     "returned": len(self.rows), **self.pagination_override}}
            if self.message_owner is not None:
                result["profile"] = self.message_owner
            return result
        identifier = path.rsplit("/", 1)[1]
        return copy.deepcopy(self.details.get((profile, identifier), session(profile, identifier)))


class AuditReviewTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.data = Path(self.temporary.name)
        self.client = AuditHermes()
        self.now = 1000
        self.monitor = office.Monitor(self.client, self.data, clock=lambda: self.now)
        self.monitor.profiles = {name: {"name": name, "display_name": name} for name in ("alpha", "beta")}

    def tearDown(self):
        self.monitor.close()
        self.temporary.cleanup()

    def messages(self, profile="alpha", identifier="session-1", **options):
        return self.monitor.audit_messages(profile, identifier, **options)

    def test_old_source_missing_message_owner_is_supported_after_exact_detail_proof(self):
        result = self.messages()
        self.assertTrue(result["available"])
        self.assertEqual(result["messages"][0]["content"], PRIVATE)
        self.assertEqual(result["session"]["profile"], "alpha")
        self.assertEqual([call[1] for call in self.client.calls],
                         ["/api/sessions/session-1", "/api/sessions/session-1/messages"])
        self.assertTrue(all(call[2]["profile"] == "alpha" for call in self.client.calls))

    def test_selected_detail_must_prove_both_profile_and_exact_id(self):
        for bad_detail in (session("beta"), session("alpha", "other-id"), {"id": "session-1"}):
            with self.subTest(detail=bad_detail):
                self.monitor.audit_cache.clear()
                self.client.calls.clear()
                self.client.details[("alpha", "session-1")] = bad_detail
                result = self.messages()
                self.assertFalse(result["available"])
                self.assertEqual(result["messages"], [])
                self.assertEqual(len(self.client.calls), 1)

    def test_present_message_owner_mismatch_is_refused(self):
        self.client.message_owner = "beta"
        result = self.messages()
        self.assertFalse(result["available"])
        self.assertNotIn(PRIVATE, json.dumps(result))

    def test_resumed_session_requires_its_own_explicit_ownership_proof(self):
        self.client.resolved = "resumed-2"
        self.client.details[("alpha", "resumed-2")] = session("beta", "resumed-2")
        result = self.messages()
        self.assertFalse(result["available"])
        self.assertNotIn(PRIVATE, json.dumps(result))
        self.assertEqual(self.client.calls[-1][1:], ("/api/sessions/resumed-2", {"profile": "alpha"}))
        self.monitor.audit_cache.clear()
        self.client.details[("alpha", "resumed-2")] = session("alpha", "resumed-2")
        result = self.messages()
        self.assertTrue(result["available"])
        self.assertEqual(result["requested_session_id"], "session-1")
        self.assertEqual(result["session_id"], "resumed-2")
        self.assertEqual(result["session"]["id"], "resumed-2")

    def test_same_session_id_in_two_profiles_never_shares_transcript_cache(self):
        first = self.messages()
        self.client.rows[0]["content"] = "beta transcript"
        second = self.messages("beta")
        self.assertEqual(first["messages"][0]["content"], PRIVATE)
        self.assertEqual(second["messages"][0]["content"], "beta transcript")
        self.assertFalse(second["cached"])
        self.assertEqual({call[2]["profile"] for call in self.client.calls}, {"alpha", "beta"})

    def test_bad_or_unknown_identity_is_rejected_before_source_calls(self):
        for profile, identifier in (("all", "session-1"), ("alpha", "../other"), ("alpha", "stats"),
                                    ("alpha", "https://other.test"), ("alpha", "encoded%2Fpath")):
            with self.subTest(profile=profile, identifier=identifier), self.assertRaises(ValueError):
                self.messages(profile, identifier)
        with self.assertRaises(KeyError):
            self.messages("unknown")
        self.assertEqual(self.client.calls, [])

    def test_login_absent_is_unavailable_and_does_not_read_private_routes(self):
        self.client.authenticated = False
        for result in (self.messages(), self.monitor.audit_sessions("alpha")):
            self.assertFalse(result["available"])
            self.assertTrue(result["requires_login"])
            self.assertTrue(result["error"])
        self.assertEqual(self.client.calls, [])

    def test_cached_transcript_is_removed_when_source_cookie_context_disappears(self):
        self.assertTrue(self.messages()["available"])
        self.client.authenticated = False
        result = self.messages()
        self.assertTrue(result["requires_login"])
        self.assertFalse(result["available"])
        self.assertEqual(result["messages"], [])
        self.assertEqual(self.monitor.audit_cache, {})
        self.assertNotIn(PRIVATE, json.dumps(result))

    def test_expired_cache_and_auth_error_never_claim_an_empty_success(self):
        self.messages()
        self.now += office.AUDIT_CACHE_SECONDS + 1
        self.client.failure = office.SourceError("native-response-should-not-leak " + HIDDEN, True)
        result = self.messages()
        self.assertFalse(result["available"])
        self.assertTrue(result["requires_login"])
        self.assertTrue(self.monitor.snapshot()["source"]["private_detail_requires_login"])
        self.assertNotIn(HIDDEN, json.dumps(result))

    def test_new_login_invalidates_all_old_profile_pages(self):
        self.messages()
        self.messages("beta")
        with patch.object(self.monitor, "request_refresh"):
            self.monitor.connect("synthetic-user", "synthetic-password")
        self.assertEqual(self.monitor.audit_cache, {})
        self.client.rows[0]["content"] = "new login transcript"
        self.assertEqual(self.messages()["messages"][0]["content"], "new login transcript")

    def test_source_order_and_real_missing_or_regressing_timestamps_are_preserved(self):
        self.client.rows = [{"id": 30, "role": "user", "content": "first", "timestamp": 999},
                            {"id": 31, "role": "assistant", "content": "second", "timestamp": 50},
                            {"id": 32, "role": "tool", "content": "third"}]
        result = self.messages()
        self.assertEqual([m["id"] for m in result["messages"]], ["30", "31", "32"])
        self.assertEqual([m["timestamp"] for m in result["messages"]], [999, 50, None])

    def test_pagination_counts_source_rows_even_when_display_hides_rows(self):
        self.client.rows = [{"id": 1, "role": "system", "content": HIDDEN},
                            {"id": 2, "role": "assistant", "content": HIDDEN, "display_kind": "hidden"},
                            {"id": 3, "role": "user", "content": PRIVATE}]
        result = self.messages(limit=3, offset=6, order="oldest")
        self.assertEqual([m["id"] for m in result["messages"]], ["3"])
        self.assertEqual(result["pagination"], {"limit": 3, "offset": 6, "order": "oldest", "returned": 3, "has_more": True})
        self.assertNotIn(HIDDEN, json.dumps(result))

    def test_wrong_source_pagination_is_unavailable(self):
        for pagination in ({"offset": 5}, {"limit": 90}, {"order": "oldest"}, {"returned": 7}):
            with self.subTest(pagination=pagination):
                self.monitor.audit_cache.clear()
                self.client.pagination_override = pagination
                result = self.messages()
                self.assertFalse(result["available"])
                self.assertEqual(result["messages"], [])

    def test_visible_content_is_plain_text_without_internal_fields_or_media_urls(self):
        hostile = "<img src=x onerror=alert(1)>\n<script>window.bad=true</script>"
        self.client.rows = [{"id": 1, "role": "assistant", "content": HIDDEN,
                             "display_content": [{"type": "text", "text": hostile},
                                                 {"type": "image_url", "image_url": {"url": "https://private.example/image"}}],
                             "reasoning": HIDDEN, "reasoning_content": HIDDEN, "api_content": HIDDEN,
                             "display_metadata": {"private": HIDDEN}}]
        result = self.messages()
        row = result["messages"][0]
        self.assertEqual(row["content"], hostile)
        self.assertEqual(row["attachment_count"], 1)
        self.assertNotIn(HIDDEN, json.dumps(result))
        self.assertNotIn("https://private.example", json.dumps(result))
        self.assertNotIn("reasoning", row)

    def test_long_content_and_tool_arguments_are_marked_truncated(self):
        self.client.rows = [{"id": 1, "role": "assistant", "content": "x" * (office.MAX_MESSAGE_TEXT + 1),
                             "tool_calls": [{"id": "tool-1", "type": "function", "function": {
                                 "name": "search", "arguments": "a" * (office.MAX_TOOL_ARGUMENTS + 1)}}]}]
        row = self.messages()["messages"][0]
        self.assertTrue(row["truncated"])
        self.assertEqual(len(row["content"]), office.MAX_MESSAGE_TEXT)
        self.assertEqual(len(row["tool_calls"][0]["arguments"]), office.MAX_TOOL_ARGUMENTS)

    def test_transcripts_stay_out_of_global_state_and_persistent_files(self):
        before = self.monitor.snapshot()
        result = self.messages()
        self.assertIn(PRIVATE, json.dumps(result))
        self.assertEqual(self.monitor.snapshot(), before)
        self.assertNotIn(PRIVATE, json.dumps(self.monitor.snapshot()))
        self.assertEqual(list(self.data.iterdir()), [])
        result["messages"][0]["content"] = "caller mutated copy"
        self.assertEqual(self.messages()["messages"][0]["content"], PRIVATE)

    def test_session_list_rejects_any_cross_profile_row(self):
        self.client.sessions = [session("alpha"), session("beta", "other")]
        result = self.monitor.audit_sessions("alpha")
        self.assertFalse(result["available"])
        self.assertEqual(result["sessions"], [])


class AuditOutboundReviewTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.client = office.HermesClient(SOURCE, Path(self.temporary.name))

    def tearDown(self):
        self.temporary.cleanup()

    def test_dynamic_read_requires_canonical_id_and_explicit_profile(self):
        class NoNetwork:
            def open(self, *args, **kwargs):
                raise AssertionError("Forbidden request reached transport")
        for path, query in (("/api/sessions/session-1", None), ("/api/sessions/session-1/messages", {}),
                            ("/api/sessions/session-1", {"profile": "all"}),
                            ("/api/sessions/%73ession-1", {"profile": "alpha"}),
                            ("/api/sessions/stats", {"profile": "alpha"}),
                            ("/api/sessions/../other", {"profile": "alpha"}),
                            ("/api/sessions/session-1/export", {"profile": "alpha"})):
            with self.subTest(path=path, query=query), self.assertRaises(office.SourceError):
                self.client._request(NoNetwork(), "GET", path, query)

    def test_scoped_audit_redirects_are_refused_even_to_same_origin(self):
        guard = office.SameSourceRedirects(SOURCE)
        headers = Message()
        requests = ("/api/sessions/session-1?profile=alpha", "/api/sessions/session-1/messages?profile=alpha",
                    "/api/profiles/sessions?profile=alpha")
        for path in requests:
            for target in (SOURCE + "/api/status", SOURCE + "/api/profiles/sessions?profile=beta"):
                with self.subTest(path=path, target=target), self.assertRaises(office.SourceError):
                    guard.redirect_request(Request(SOURCE + path), None, 302, "redirect", headers, target)


class AuditHTTPReviewTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.data = Path(self.temporary.name)
        self.client = AuditHermes()
        self.monitor = office.Monitor(self.client, self.data)
        self.monitor.profiles = {"alpha": {"name": "alpha"}}
        self.server = office.OfficeServer(("127.0.0.1", 0), self.monitor, Path(__file__).resolve().parents[1] / "web")
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.monitor.close()
        self.temporary.cleanup()

    def request(self, query, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        try:
            connection.request("GET", "/api/audit/messages?" + query, headers=headers or {})
            response = connection.getresponse()
            return response.status, json.loads(response.read()), dict(response.getheaders())
        finally:
            connection.close()

    def test_valid_audit_is_no_store_and_exposes_honest_unavailable_login(self):
        self.client.authenticated = False
        status, result, headers = self.request("profile=alpha&session_id=session-1")
        self.assertEqual(status, 200)
        self.assertFalse(result["available"])
        self.assertTrue(result["requires_login"])
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(self.client.calls, [])

    def test_audit_denies_rebinding_and_explicit_cross_site_reads(self):
        for headers in ({"Host": "attacker.example:" + str(self.server.server_port)},
                        {"Origin": "https://attacker.example"}, {"Sec-Fetch-Site": "cross-site"}):
            with self.subTest(headers=headers):
                self.assertEqual(self.request("profile=alpha&session_id=session-1", headers)[0], 403)
        self.assertEqual(self.client.calls, [])

    def test_unsafe_duplicate_or_extra_queries_never_reach_source(self):
        for query in ("profile=alpha&profile=beta&session_id=session-1", "profile=alpha&session_id=../beta",
                      "profile=alpha&session_id=session-1&source_url=https://attacker.example",
                      "profile=alpha&session_id=session-1&limit=101", "profile=alpha&session_id=session-1&offset=-1",
                      "profile=alpha&session_id=session-1&order=unknown"):
            with self.subTest(query=query):
                self.assertEqual(self.request(query)[0], 400)
        self.assertEqual(self.request("profile=unknown&session_id=session-1")[0], 404)
        self.assertEqual(self.client.calls, [])


if __name__ == "__main__":
    unittest.main()
