"""Offline boundary tests. Only the Office HTTP server binds a test loopback port."""
from __future__ import annotations

from collections import deque
from email.message import Message
import http.client
import http.cookiejar
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, HTTPSHandler, Request, build_opener
from urllib.response import addinfourl


APP_PATH = Path(__file__).resolve().parents[1] / "app.py"
SPEC = importlib.util.spec_from_file_location("office_security_app", APP_PATH)
office = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(office)
SOURCE = "https://hermes.example.test/hermes"
SECRET = "synthetic-private-value-for-offline-test"


class FakeHTTPS(HTTPSHandler):
    """Use urllib's actual cookie/redirect processors without opening any socket."""

    def __init__(self, responses):
        super().__init__()
        self.responses = deque(responses)
        self.requests = []

    def https_open(self, request):
        self.requests.append(request)
        if not self.responses:
            raise AssertionError("Unexpected upstream request")
        code, payload, extra_headers = self.responses.popleft()
        headers = Message()
        headers["Content-Type"] = "application/json"
        for name, value in extra_headers:
            headers.add_header(name, value)
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        response = addinfourl(io.BytesIO(body), headers, request.full_url, code)
        response.msg = "Synthetic response"
        return response


def response(payload, headers=(), code=200):
    return code, payload, headers


def transport_for(client, responses):
    transport = FakeHTTPS(responses)

    def opener(jar):
        return build_opener(HTTPCookieProcessor(jar), office.SameSourceRedirects(client.base), transport)

    client._opener = opener
    client.opener = opener(client.jar)
    return transport


class ClientSecurityTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.data = Path(self.temporary.name)
        self.client = office.HermesClient(SOURCE, self.data)

    def tearDown(self):
        self.temporary.cleanup()

    def test_source_rejects_credentials_queries_and_unsafe_paths(self):
        for value in (
            "http://hermes.example.test", "https://user:password@hermes.example.test",
            "https://hermes.example.test/?token=private", "https://hermes.example.test/#private",
            "https://hermes.example.test/a/%2e%2e", "https://hermes.example.test/a\\b",
            "https://hermes.example.test/with space", "https://hermes.example.test:999999",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                office.source_url(value)
        self.assertEqual(office.source_url(SOURCE + "/"), SOURCE)

    def test_only_usable_source_session_cookies_enable_private_reads(self):
        self.assertFalse(self.client.has_session())
        cases = (
            ("hermes_session_provider", "basic", "hermes.example.test", "/hermes", 4102444800, False),
            ("hermes_session_pkce", SECRET, "hermes.example.test", "/hermes", 4102444800, False),
            ("tracking_hermes_session_at", SECRET, "hermes.example.test", "/hermes", 4102444800, False),
            ("__Secure-hermes_session_at", SECRET, "hermes.example.test", "/hermes", 1, False),
            ("__Secure-hermes_session_at", "", "hermes.example.test", "/hermes", 4102444800, False),
            ("__Secure-hermes_session_at", SECRET, "another.example.test", "/hermes", 4102444800, False),
            ("__Secure-hermes_session_at", SECRET, "hermes.example.test", "/different", 4102444800, False),
            ("__Secure-hermes_session_at", SECRET, "hermes.example.test", "/hermes", 4102444800, True),
            ("__Host-hermes_session_rt", SECRET, "hermes.example.test", "/", 4102444800, True),
        )
        for name, value, domain, path, expires, expected in cases:
            with self.subTest(name=name, domain=domain, path=path, expires=expires, empty=not value):
                self.client.jar.clear()
                self.client.jar.set_cookie(http.cookiejar.Cookie(
                    0, name, value, None, False, domain, False, False, path, True, True,
                    expires, False, None, None, {"HttpOnly": None}, False))
                self.assertEqual(self.client.has_session(), expected)

    def test_only_monitor_gets_and_official_login_can_go_outbound(self):
        transport = transport_for(self.client, [])
        for method, path in (
            ("GET", "/api/config"), ("GET", "/api/env"), ("GET", "/api/sessions/abc"),
            ("GET", "https://other.example.test/api/status"),
            ("POST", "/api/gateway/restart"), ("POST", "/api/chat"),
            ("DELETE", "/api/profiles/alpha"), ("PATCH", "/api/status"),
        ):
            with self.subTest(method=method, path=path), self.assertRaises(office.SourceError):
                self.client._request(self.client.opener, method, path)
        self.assertEqual(transport.requests, [])
        for path in office.GET_PATHS:
            transport.responses.append(response({"ok": True}))
            self.client.get(path)
        self.assertEqual({request.get_method() for request in transport.requests}, {"GET"})
        self.assertTrue(all(request.full_url.startswith(SOURCE + "/api/") for request in transport.requests))

    def test_redirects_cannot_replay_passwords_or_leave_read_allowlist(self):
        redirector = office.SameSourceRedirects(SOURCE)
        targets = (
            "https://attacker.example.test/api/status", SOURCE + "/login",
            SOURCE + "/api/gateway/restart", "http://hermes.example.test/hermes/api/status",
        )
        for target in targets:
            with self.subTest(target=target), self.assertRaises(office.SourceError):
                redirector.redirect_request(Request(SOURCE + "/api/status"), None, 302, "", Message(), target)
        with self.assertRaises(office.SourceError):
            redirector.redirect_request(
                Request(SOURCE + "/auth/password-login", data=b"synthetic-password", method="POST"),
                None, 302, "", Message(), SOURCE + "/api/status")
        allowed = redirector.redirect_request(
            Request(SOURCE + "/api/status"), None, 302, "", Message(), SOURCE + "/api/auth/me")
        self.assertEqual(allowed.full_url, SOURCE + "/api/auth/me")

    def test_cookie_rotation_and_expiry_are_persisted_without_password(self):
        transport = transport_for(self.client, [
            response({"ok": True, "next": "https://never-follow.example.test"}, (
                ("Set-Cookie", "__Secure-hermes_session_at=synthetic-access-old; Path=/hermes; Secure; HttpOnly; Max-Age=3600"),
                ("Set-Cookie", "__Secure-hermes_session_rt=synthetic-refresh-old; Path=/hermes; Secure; HttpOnly; Max-Age=3600"),
                ("Set-Cookie", "__Secure-hermes_session_provider=basic; Path=/hermes; Secure; HttpOnly; Max-Age=3600"),
            )),
            response({"provider": "basic", "user_id": "synthetic-user"}),
            response({"profiles": []}, (
                ("Set-Cookie", "__Secure-hermes_session_at=synthetic-access-new; Path=/hermes; Secure; HttpOnly; Max-Age=3600"),
                ("Set-Cookie", "__Secure-hermes_session_rt=; Path=/hermes; Secure; HttpOnly; Max-Age=0"),
            )),
        ])
        self.client.login("synthetic-user", SECRET)
        self.client.get("/api/profiles")
        self.assertEqual(len(transport.requests), 3)
        sent = json.loads(transport.requests[0].data)
        self.assertEqual(sent, {"provider": "basic", "username": "synthetic-user", "password": SECRET, "next": "/"})
        self.assertIn("synthetic-access-old", transport.requests[2].get_header("Cookie"))
        self.assertEqual(transport.requests[1].full_url, SOURCE + "/api/auth/me")
        saved = self.client.cookie_file.read_text()
        self.assertIn("synthetic-access-new", saved)
        self.assertNotIn("synthetic-refresh-old", saved)
        self.assertNotIn(SECRET, saved)
        reloaded = office.HermesClient(SOURCE, self.data)
        self.assertEqual({cookie.name: cookie.value for cookie in reloaded.jar}, {
            "__Secure-hermes_session_at": "synthetic-access-new", "__Secure-hermes_session_provider": "basic"})

    def test_unauthenticated_cookie_deletion_is_saved_and_remote_error_is_hidden(self):
        transport = transport_for(self.client, [
            response({"ok": True}, (("Set-Cookie", "hermes_session_at=synthetic-old; Path=/hermes; Secure; Max-Age=3600"),)),
            response({"provider": "basic", "user_id": "synthetic-user"}),
            response({"detail": SECRET}, (("Set-Cookie", "hermes_session_at=; Path=/hermes; Secure; Max-Age=0"),), code=401),
        ])
        self.client.login("synthetic-user", SECRET)
        with self.assertRaises(office.SourceError) as raised:
            self.client.get("/api/profiles")
        self.assertTrue(raised.exception.requires_login)
        self.assertNotIn(SECRET, str(raised.exception))
        self.assertEqual(list(self.client.jar), [])
        self.assertNotIn("synthetic-old", self.client.cookie_file.read_text())
        self.assertEqual(len(transport.requests), 3)

    def test_login_identity_must_be_verified_before_cookie_jar_replacement(self):
        old_jar = self.client.jar
        for identity in ({}, {"provider": "unexpected", "user_id": "synthetic-user"}, {"provider": "basic", "user_id": ""}):
            with self.subTest(identity=identity):
                transport_for(self.client, [
                    response({"ok": True}, (("Set-Cookie", "hermes_session_at=synthetic-unverified; Path=/hermes; Secure; Max-Age=3600"),)),
                    response(identity),
                ])
                with self.assertRaises(office.SourceError) as raised:
                    self.client.login("synthetic-user", SECRET)
                self.assertTrue(raised.exception.requires_login)
                self.assertIs(self.client.jar, old_jar)
                self.assertFalse(self.client.cookie_file.exists())

    def test_response_size_shape_and_http_errors_do_not_expose_body(self):
        for payload in ([{"raw_prompt": SECRET}], b"not-json " + SECRET.encode(), b"x" * (office.MAX_REMOTE_BODY + 1)):
            with self.subTest(payload_type=type(payload).__name__):
                transport_for(self.client, [response(payload)])
                with self.assertRaises(office.SourceError) as raised:
                    self.client.get("/api/profiles")
                self.assertNotIn(SECRET, str(raised.exception))
        for code in (401, 403, 429, 500, 503):
            with self.subTest(code=code):
                transport_for(self.client, [response({"detail": SECRET, "password": SECRET}, code=code)])
                with self.assertRaises(office.SourceError) as raised:
                    self.client.get("/api/profiles")
                self.assertNotIn(SECRET, str(raised.exception))
                self.assertEqual(raised.exception.requires_login, code in (401, 403))


class StubMonitor:
    def __init__(self):
        self.client = type("Client", (), {"base": SOURCE})()
        self.connects = []
        self.refreshes = 0
        self.failure = None

    def request_refresh(self):
        self.refreshes += 1

    def snapshot(self):
        return {"source": {"url": SOURCE, "read_only": True}, "agents": [], "sessions": [], "events": []}

    def connect(self, username, password):
        if self.failure:
            raise self.failure
        self.connects.append((username, password))


class HttpSecurityTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.web = self.root / "web"
        self.web.mkdir()
        (self.web / "index.html").write_text("<p>Synthetic Office</p>")
        (self.web / "connect.html").write_text("<form>Synthetic connector</form>")
        (self.web / "app.js").write_text("console.log('synthetic');")
        (self.root / "private.json").write_text(json.dumps({"credential": SECRET}))
        self.monitor = StubMonitor()
        self.server = office.OfficeServer(("127.0.0.1", 0), self.monitor, self.web)
        self.worker = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
        self.worker.start()
        self.origin = "http://127.0.0.1:" + str(self.server.server_port)

    def tearDown(self):
        self.server.shutdown()
        self.worker.join(timeout=2)
        self.server.server_close()
        self.temporary.cleanup()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            answer = connection.getresponse()
            return answer.status, dict(answer.getheaders()), answer.read()
        finally:
            connection.close()

    def connect_headers(self):
        return {"Origin": self.origin, "X-CSRF-Token": self.server.csrf_token, "Content-Type": "application/json"}

    def test_dns_rebinding_hosts_cannot_read_state_token_or_assets(self):
        for host in ("attacker.example.test", "localhost.evil.test", "user@127.0.0.1:" + str(self.server.server_port), "127.0.0.1:1"):
            for path in ("/", "/api/state", "/api/connect-options"):
                with self.subTest(host=host, path=path):
                    status, _, body = self.request("GET", path, headers={"Host": host})
                    self.assertEqual(status, 403)
                    self.assertNotIn(self.server.csrf_token.encode(), body)
        self.assertEqual(self.monitor.refreshes, 0)

    def test_connect_requires_matching_origin_and_csrf(self):
        body = json.dumps({"username": "synthetic-user", "password": SECRET})
        for headers in (
            {"Content-Type": "application/json"},
            {**self.connect_headers(), "Origin": "https://attacker.example.test"},
            {**self.connect_headers(), "Origin": "null"},
            {**self.connect_headers(), "X-CSRF-Token": "incorrect"},
            {**self.connect_headers(), "X-CSRF-Token": "é"},
        ):
            with self.subTest(headers=headers):
                self.assertEqual(self.request("POST", "/api/connect", body, headers)[0], 403)
        self.assertEqual(self.monitor.connects, [])
        status, _, answer = self.request("POST", "/api/connect", body, self.connect_headers())
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(answer), {"ok": True})
        self.assertNotIn(SECRET.encode(), answer)
        self.assertEqual(self.monitor.connects, [("synthetic-user", SECRET)])

    def test_connect_rejects_extra_destination_fields_and_invalid_credential_shapes(self):
        for payload in (
            {"username": "synthetic-user", "password": SECRET, "url": "https://attacker.example.test"},
            {"username": "synthetic-user", "password": SECRET, "provider": "evil"},
            {"username": "synthetic-user", "password": SECRET, "cookie": SECRET},
            {"username": "synthetic-user", "password": "x" * 4097},
            {"username": "u" * 257, "password": SECRET},
            {"username": [], "password": SECRET}, {"username": "synthetic-user", "password": None},
            {"username": " ", "password": SECRET}, [], None,
        ):
            with self.subTest(payload_type=type(payload).__name__):
                self.assertEqual(self.request("POST", "/api/connect", json.dumps(payload), self.connect_headers())[0], 400)
        self.assertEqual(self.monitor.connects, [])

    def test_connect_body_framing_and_type_limits(self):
        for content_length in ("0", "-1", str(office.MAX_BODY + 1)):
            with self.subTest(content_length=content_length):
                headers = {**self.connect_headers(), "Content-Length": content_length}
                self.assertEqual(self.request("POST", "/api/connect", b"", headers)[0], 413)
        self.assertEqual(self.request("POST", "/api/connect", b"{}", {**self.connect_headers(), "Content-Length": "invalid"})[0], 400)
        self.assertEqual(self.request("POST", "/api/connect", b"{}", {**self.connect_headers(), "Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.request("POST", "/api/connect", b"", {**self.connect_headers(), "Transfer-Encoding": "chunked"})[0], 415)
        self.assertEqual(self.monitor.connects, [])

    def test_private_files_and_source_code_are_not_static_assets(self):
        for path in (
            "/../private.json", "/%2e%2e/private.json", "/assets/%2e%2e/%2e%2e/private.json",
            "/%5c..%5cprivate.json", "/%00private.json", "/app.py", "/hermes-cookies.txt", "/snapshot.json",
        ):
            with self.subTest(path=path):
                status, _, body = self.request("GET", path)
                self.assertEqual(status, 404)
                self.assertNotIn(SECRET.encode(), body)
        self.assertEqual(self.request("GET", "/app.js")[0], 200)

    def test_symlink_escape_is_not_served(self):
        try:
            (self.web / "leak.json").symlink_to(self.root / "private.json")
        except OSError:
            self.skipTest("Creating test symlinks is unavailable on this host")
        status, _, body = self.request("GET", "/leak.json")
        self.assertEqual(status, 404)
        self.assertNotIn(SECRET.encode(), body)

    def test_api_does_not_return_login_errors_or_credentials_and_rejects_actions(self):
        self.monitor.failure = RuntimeError(SECRET)
        status, _, body = self.request("POST", "/api/connect", json.dumps({"username": "synthetic-user", "password": SECRET}), self.connect_headers())
        self.assertEqual(status, 502)
        self.assertNotIn(SECRET.encode(), body)
        for method, path in (("POST", "/api/chat"), ("POST", "/api/gateway/restart"), ("DELETE", "/api/state"), ("PUT", "/api/config"), ("PATCH", "/api/agents")):
            with self.subTest(method=method, path=path):
                self.assertEqual(self.request(method, path)[0], 405)
        for path in ("/api/state", "/api/connect-options", "/api/health"):
            status, headers, body = self.request("GET", path)
            self.assertEqual(status, 200)
            self.assertNotIn(SECRET.encode(), body)
            self.assertNotIn("Set-Cookie", headers)
            self.assertEqual(headers["Cache-Control"], "no-store")


class NormalizationSecurityTests(unittest.TestCase):
    def test_gateway_requires_boolean_liveness_and_bounds_untrusted_values(self):
        for payload in ({}, {"gateway_running": "true"}, {"gateway_running": 1}, {"gateway_running": None}):
            with self.subTest(payload=payload), self.assertRaises(office.SourceError):
                office.normalize_gateway(payload, 1000)
        for active in (True, -1, "1", 1.5, None, {}):
            with self.subTest(active=active):
                gateway = office.normalize_gateway({"gateway_running": True, "gateway_state": "running", "active_agents": active}, 1000)
                self.assertIsNone(gateway["active_agents"])
                self.assertEqual(office.bot_status(gateway)[0], "unknown")
        gateway = office.normalize_gateway({"gateway_running": True, "active_agents": 10**200,
                                            "gateway_shared_with": ["p" * 200] * 200,
                                            "gateway_platforms": {str(i): {"state": "s" * 200, "password": SECRET} for i in range(200)},
                                            "runtime": {"raw_prompt": SECRET}, "env_path": SECRET}, 1000)
        self.assertEqual(gateway["active_agents"], 1_000_000_000)
        self.assertLessEqual(len(gateway["shared_with"]), office.MAX_PROFILES)
        self.assertFalse(gateway["ownership_verified"])
        self.assertEqual(len(gateway["platforms"]), 100)
        self.assertTrue(all(len(value["state"]) <= 40 for value in gateway["platforms"].values()))
        self.assertNotIn(SECRET, json.dumps(gateway))

    def test_shared_gateway_busy_count_does_not_identify_a_working_bot(self):
        raw = {"gateway_running": True, "gateway_state": "running", "active_agents": 1,
               "gateway_mode": "multiplex", "gateway_shared_with": ["alpha", "beta"]}
        self.assertEqual(office.bot_status(office.normalize_gateway(raw, 1000))[0], "unknown")
        raw["gateway_shared_with"] = None
        self.assertEqual(office.bot_status(office.normalize_gateway(raw, 1000))[0], "unknown")
        raw["active_agents"] = 0
        self.assertEqual(office.bot_status(office.normalize_gateway(raw, 1000))[0], "idle")
        raw.update(gateway_mode="single", gateway_shared_with=None, active_agents=1)
        self.assertEqual(office.bot_status(office.normalize_gateway(raw, 1000))[0], "working")
        raw["gateway_running"] = False
        self.assertEqual(office.bot_status(office.normalize_gateway(raw, 1000))[0], "offline")

    def test_missing_or_malformed_gateway_ownership_cannot_attribute_work(self):
        for ownership in ({}, {"gateway_mode": "multiple", "gateway_shared_with": "alpha,beta"}):
            with self.subTest(ownership=ownership):
                raw = {"gateway_running": True, "gateway_state": "running", "active_agents": 2, **ownership}
                self.assertEqual(office.bot_status(office.normalize_gateway(raw, 1000))[0], "unknown")

    def test_sessions_drop_raw_prompts_and_unknown_profiles_and_bound_counts(self):
        rows = [{"id": "same-id", "profile": "alpha", "source": "telegram", "title": "Synthetic session metadata",
                 "messages": [{"content": SECRET}], "system_prompt": SECRET, "model_config": {"api_key": SECRET},
                 "tool_args": {"command": SECRET}, "message_count": -1, "tool_call_count": 10**200,
                 "is_active": "true", "started_at": float("nan"), "last_active": float("inf")}]
        rows += [{"id": "unknown", "profile": "not-in-roster", "message_count": 100}]
        rows += [{"id": str(i), "profile": "alpha", "message_count": 1} for i in range(200)]
        sessions, totals = office.normalize_sessions({"sessions": rows, "profile_totals": {"alpha": True, "unknown": SECRET}}, {"alpha": {}})
        self.assertLessEqual(len(sessions), office.MAX_SESSIONS)
        self.assertEqual(totals, {"alpha": 0})
        self.assertNotIn(SECRET, json.dumps(sessions))
        self.assertEqual(sessions[0]["message_count"], 0)
        self.assertEqual(sessions[0]["tool_call_count"], 1_000_000_000)
        self.assertFalse(sessions[0]["recent_activity"])
        self.assertIsNone(sessions[0]["started_at"])
        self.assertIsNone(sessions[0]["last_active"])

    def test_activity_identity_uses_profile_and_session_together(self):
        class SyntheticClient:
            base = SOURCE
            counts = {"alpha": 2, "beta": 5}

            def has_session(self):
                return True

            def get(self, path, query=None):
                if path == "/api/profiles":
                    return {"profiles": [{"name": "alpha", "display_name": "Alpha"}, {"name": "beta", "display_name": "Beta"}]}
                if path == "/api/profiles/sessions":
                    return {"sessions": [{"id": "same-id", "profile": name, "message_count": total, "tool_call_count": 0, "last_active": 900}
                                         for name, total in self.counts.items()], "profile_totals": {"alpha": 1, "beta": 1}}
                return {"gateway_running": True, "gateway_state": "running", "active_agents": 0}

        with tempfile.TemporaryDirectory() as temporary:
            client = SyntheticClient()
            monitor = office.Monitor(client, Path(temporary), clock=lambda: 1000)
            try:
                monitor.refresh_now(force=True)
                client.counts = {"alpha": 3, "beta": 8}
                monitor.refresh_now(force=True)
                events = monitor.snapshot()["events"]
                self.assertEqual({event["profile"]: event["messages_added"] for event in events}, {"alpha": 1, "beta": 3})
                self.assertTrue(all(event["session_id"] == "same-id" for event in events))
            finally:
                monitor.close()


class PublicStatusSecurityTests(unittest.TestCase):
    class PublicClient:
        base = SOURCE

        def __init__(self):
            self.calls = []
            self.global_failure = False
            self.private_expired = False
            self.authenticated = False
            self.profiles = ["alpha", "beta"]

        def has_session(self):
            return self.authenticated

        def get(self, path, query=None):
            self.calls.append((path, query))
            if path == "/api/status":
                if self.global_failure and not query:
                    raise office.SourceError("Sesi login Hermes perlu disambungkan ulang.", requires_login=True)
                return {"profiles": self.profiles, "gateway_running": True, "gateway_state": "running",
                        "active_agents": 1 if (query or {}).get("profile") == "alpha" else 0,
                        "gateway_mode": "multiple", "gateway_shared_with": None}
            if not self.authenticated:
                raise AssertionError("Public monitoring must never request a private endpoint")
            if self.private_expired:
                raise office.SourceError("Sesi login Hermes perlu disambungkan ulang.", requires_login=True)
            if path == "/api/profiles":
                return {"profiles": [{"name": "alpha"}, {"name": "beta"}]}
            if path == "/api/profiles/sessions":
                return {"sessions": [{"id": "alpha-session", "profile": "alpha", "message_count": 2}],
                        "profile_totals": {"alpha": 4, "beta": 0}, "errors": []}
            raise AssertionError("Unexpected upstream path")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.client = self.PublicClient()
        self.now = 1000
        self.monitor = office.Monitor(self.client, Path(self.temporary.name), clock=lambda: self.now)

    def tearDown(self):
        self.monitor.close()
        self.temporary.cleanup()

    def test_default_mode_reads_only_public_status_and_never_invents_session_counts(self):
        self.monitor.refresh_now()
        state = self.monitor.snapshot()
        self.assertTrue(state["source"]["connected"])
        self.assertFalse(state["source"]["stale"])
        self.assertFalse(state["source"]["requires_login"])
        self.assertEqual(state["source"]["mode"], "status_only")
        self.assertFalse(state["source"]["sessions_available"])
        self.assertEqual({agent["profile"]: agent["status"] for agent in state["agents"]}, {"alpha": "working", "beta": "idle"})
        self.assertTrue(all(agent["session_count"] is None for agent in state["agents"]))
        self.assertEqual(state["sessions"], [])
        self.assertEqual(state["events"], [])
        self.assertTrue(all(path == "/api/status" for path, _ in self.client.calls))

    def test_public_global_401_preserves_roster_as_unverified_source_failure(self):
        self.monitor.refresh_now()
        self.client.calls.clear()
        self.client.global_failure = True
        self.now += 11
        self.monitor.refresh_now()
        state = self.monitor.snapshot()
        self.assertFalse(state["source"]["connected"])
        self.assertTrue(state["source"]["stale"])
        self.assertTrue(state["source"]["requires_login"])
        self.assertFalse(state["source"]["sessions_available"])
        self.assertEqual({agent["profile"] for agent in state["agents"]}, {"alpha", "beta"})
        self.assertTrue(all(agent["status"] == "unknown" for agent in state["agents"]))
        self.assertEqual(state["gateway"]["state"], "unknown")
        self.assertEqual(self.client.calls, [("/api/status", None)])

    def test_expired_optional_detail_login_does_not_hide_verified_public_bots(self):
        self.client.authenticated = True
        self.monitor.refresh_now()
        prior_sessions = self.monitor.snapshot()["sessions"]
        self.assertTrue(self.monitor.snapshot()["source"]["sessions_available"])
        self.client.private_expired = True
        self.now += 61
        self.monitor.refresh_now()
        state = self.monitor.snapshot()
        self.assertTrue(state["source"]["connected"])
        self.assertFalse(state["source"]["requires_login"])
        self.assertTrue(state["source"]["private_detail_requires_login"])
        self.assertEqual(state["source"]["mode"], "status_only")
        self.assertFalse(state["source"]["sessions_available"])
        self.assertTrue(state["source"]["sessions_stale"])
        self.assertEqual(state["sessions"], prior_sessions)
        self.assertEqual({agent["profile"]: agent["status"] for agent in state["agents"]}, {"alpha": "working", "beta": "idle"})

    def test_malformed_public_roster_is_not_an_authoritative_empty_result(self):
        self.monitor.refresh_now()
        self.client.profiles = [{"name": "unexpected-object"}]
        self.now += 61
        self.monitor.refresh_now()
        state = self.monitor.snapshot()
        self.assertTrue(state["source"]["stale"])
        self.assertIsNotNone(state["source"]["error"])
        self.assertEqual({agent["profile"] for agent in state["agents"]}, {"alpha", "beta"})
        self.assertFalse(state["source"]["sessions_available"])
        self.assertTrue(all(path == "/api/status" for path, _ in self.client.calls))

    def test_partial_profile_store_error_retains_cached_sessions_and_counts(self):
        class PartialClient:
            base = SOURCE
            partial = False

            def has_session(self):
                return True

            def get(self, path, query=None):
                if path == "/api/profiles":
                    return {"profiles": [{"name": "alpha"}, {"name": "beta"}]}
                if path == "/api/profiles/sessions":
                    alpha = {"id": "alpha-session", "profile": "alpha", "message_count": 2, "tool_call_count": 3}
                    beta = {"id": "beta-session", "profile": "beta", "message_count": 5, "tool_call_count": 1}
                    if self.partial:
                        return {"sessions": [beta], "profile_totals": {"beta": 1}, "errors": [{"profile": "alpha", "error": SECRET}]}
                    return {"sessions": [alpha, beta], "profile_totals": {"alpha": 4, "beta": 1}, "errors": []}
                return {"gateway_running": True, "gateway_state": "running", "active_agents": 0,
                        "gateway_mode": "multiple", "gateway_shared_with": None}

        with tempfile.TemporaryDirectory() as temporary:
            client = PartialClient()
            monitor = office.Monitor(client, Path(temporary), clock=lambda: 1000)
            try:
                monitor.refresh_now(force=True)
                prior = next(session for session in monitor.snapshot()["sessions"] if session["profile"] == "alpha")
                client.partial = True
                monitor.refresh_now(force=True)
                state = monitor.snapshot()
                self.assertTrue(state["source"]["stale"])
                self.assertIn(prior, state["sessions"])
                self.assertEqual(next(agent for agent in state["agents"] if agent["profile"] == "alpha")["session_count"], 4)
                self.assertNotIn(SECRET, json.dumps(state))
                self.assertNotIn(SECRET, monitor.snapshot_file.read_text())
            finally:
                monitor.close()


if __name__ == "__main__":
    unittest.main()
