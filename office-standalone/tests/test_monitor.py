"""Offline contract/security tests: all Hermes responses and logins are fake."""
import copy
import http.client
import http.cookiejar
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app


PROFILES = ["default", "crm-kim", "kim-corporate", "plus-ultra", "pms-bot"]


class FakeHermes:
    base = "https://hermes.example.test"

    def __init__(self):
        self.calls = []
        self.failure = False
        self.status_failure = False
        self.authenticated = True
        self.private_failure = False
        self.messages = 2
        self.tools = 1
        self.login_count = 0
        self.gateways = {name: {"gateway_running": True, "gateway_state": "running", "active_agents": 0,
                               "gateway_busy": False, "gateway_shared_with": None, "gateway_mode": "multiple"}
                         for name in PROFILES}
        self.gateways["crm-kim"]["active_agents"] = 1

    def get(self, path, query=None):
        self.calls.append(("GET", path, query))
        if self.failure:
            raise app.SourceError("Sesi login Hermes perlu disambungkan ulang.", True)
        if self.private_failure and path in ("/api/profiles", "/api/profiles/sessions"):
            raise app.SourceError("Sesi login Hermes perlu disambungkan ulang.", True)
        if path == "/api/profiles":
            return {"profiles": [{"name": n, "display_name": n.upper(), "model": "must-not-leak-model-config"} for n in PROFILES]}
        if path == "/api/profiles/sessions":
            return {"sessions": [{"id": "real-session-1", "profile": "crm-kim", "source": "telegram",
                                  "started_at": 100, "ended_at": None, "last_active": 1000, "is_active": True,
                                  "message_count": self.messages, "tool_call_count": self.tools,
                                  "title": "CRM daily report", "preview": "SECRET TOOL OUTPUT", "system_prompt": "SECRET SYSTEM"}],
                    "profile_totals": {"crm-kim": 12}, "errors": []}
        if path == "/api/status":
            if self.status_failure:
                raise app.SourceError()
            status = copy.deepcopy(self.gateways[(query or {}).get("profile", "default")])
            if not query:
                status["profiles"] = PROFILES
            return status
        raise AssertionError("Unexpected source route: " + path)

    def has_session(self):
        return self.authenticated

    def login(self, username, password):
        self.calls.append(("POST", "/auth/password-login", None))
        if username != "test-user" or password != "test-password":
            raise app.SourceError("Login Hermes belum berhasil.", True)
        self.login_count += 1


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.data = Path(self.temp.name)
        self.now = 1000
        self.client = FakeHermes()
        self.monitor = app.Monitor(self.client, self.data, clock=lambda: self.now)

    def tearDown(self):
        self.monitor.close()
        self.temp.cleanup()

    def test_real_profiles_are_persistent_independent_of_sessions(self):
        self.monitor.refresh_now()
        state = self.monitor.snapshot()
        agents = {a["profile"]: a for a in state["agents"]}
        self.assertEqual(set(agents), set(PROFILES))
        self.assertEqual(agents["crm-kim"]["status"], "working")
        self.assertEqual(agents["crm-kim"]["session_count"], 12)
        self.assertTrue(agents["crm-kim"]["recent_activity"])
        self.assertEqual(agents["pms-bot"]["status"], "idle")
        self.assertFalse(agents["pms-bot"]["recent_activity"])
        self.assertNotIn("real-session-1", agents)
        for secret in ("SECRET TOOL OUTPUT", "SECRET SYSTEM", "must-not-leak-model-config"):
            self.assertNotIn(secret, json.dumps(state))

    def test_public_status_mode_discovers_real_bots_without_private_reads(self):
        self.client.authenticated = False
        self.monitor.refresh_now()
        state = self.monitor.snapshot()
        source = state["source"]
        self.assertTrue(source["connected"])
        self.assertFalse(source["stale"])
        self.assertFalse(source["requires_login"])
        self.assertEqual(source["mode"], "status_only")
        self.assertFalse(source["sessions_available"])
        self.assertEqual({a["id"] for a in state["agents"]}, set(PROFILES))
        self.assertEqual(next(a for a in state["agents"] if a["id"] == "crm-kim")["status"], "working")
        self.assertTrue(all(a["session_count"] is None for a in state["agents"]))
        self.assertEqual(state["sessions"], [])
        self.assertTrue(all(method == "GET" and path == "/api/status" for method, path, _ in self.client.calls))
        self.assertEqual(state["gateway"]["active_agents"], 1)
        self.assertEqual(state["gateway"]["reported_active_agents"], 0)
        self.assertEqual(state["gateway"]["scope"], "all_profiles")

    def test_expired_optional_detail_login_preserves_live_public_bot_status(self):
        self.monitor.refresh_now()
        old_sessions = self.monitor.snapshot()["sessions"]
        self.now += 11
        self.client.private_failure = True
        self.monitor.refresh_now()
        state = self.monitor.snapshot()
        self.assertTrue(state["source"]["connected"])
        self.assertFalse(state["source"]["stale"])
        self.assertFalse(state["source"]["requires_login"])
        self.assertTrue(state["source"]["private_detail_requires_login"])
        self.assertFalse(state["source"]["sessions_available"])
        self.assertEqual(state["source"]["mode"], "status_only")
        self.assertEqual(state["sessions"], old_sessions)
        self.assertEqual(next(a for a in state["agents"] if a["id"] == "crm-kim")["status"], "working")
        self.client.authenticated = False
        self.now += 11
        self.client.calls.clear()
        self.monitor.refresh_now()
        self.assertTrue(self.monitor.snapshot()["source"]["private_detail_requires_login"])
        self.assertTrue(all(path == "/api/status" for _, path, _ in self.client.calls))

    def test_global_public_failure_invalidates_every_cached_bot_status(self):
        self.client.authenticated = False
        self.monitor.refresh_now()
        self.now += 11
        self.client.status_failure = True
        self.monitor.refresh_now()
        state = self.monitor.snapshot()
        self.assertFalse(state["source"]["connected"])
        self.assertTrue(state["source"]["stale"])
        self.assertEqual(len(state["agents"]), 5)
        self.assertTrue(all(a["status"] == "unknown" for a in state["agents"]))
        self.assertIsNone(state["gateway"]["active_agents"])

    def test_global_counter_is_unknown_when_a_profile_counter_is_unavailable(self):
        self.client.authenticated = False
        original = self.client.get
        def partial_status(path, query=None):
            if query and query.get("profile") == "pms-bot":
                raise app.SourceError()
            return original(path, query)
        self.client.get = partial_status
        self.monitor.refresh_now()
        state = self.monitor.snapshot()
        self.assertTrue(state["source"]["stale"])
        self.assertIsNone(state["gateway"]["active_agents"])
        self.assertFalse(state["gateway"]["count_complete"])
        self.assertEqual(next(a for a in state["agents"] if a["id"] == "crm-kim")["status"], "working")
        self.assertEqual(next(a for a in state["agents"] if a["id"] == "pms-bot")["status"], "unknown")

    def test_shared_global_count_is_reported_once_without_summing_profiles(self):
        self.client.authenticated = False
        for gateway in self.client.gateways.values():
            gateway.update(gateway_mode="multiplex", gateway_shared_with=PROFILES, active_agents=2)
        self.monitor.refresh_now()
        state = self.monitor.snapshot()
        self.assertEqual(state["gateway"]["active_agents"], 2)
        self.assertEqual(state["gateway"]["scope"], "shared_gateway")
        self.assertTrue(state["gateway"]["count_complete"])
        self.assertTrue(all(a["status"] == "unknown" for a in state["agents"]))
        for gateway in self.client.gateways.values():
            gateway["gateway_shared_with"] = None
        self.monitor.refresh_now(force=True)
        self.assertIsNone(self.monitor.snapshot()["gateway"]["active_agents"])
        self.assertFalse(self.monitor.snapshot()["gateway"]["count_complete"])

    def test_stopped_or_unready_multiplexer_cannot_report_a_complete_busy_count(self):
        for running, state in ((False, "stopped"), (True, "starting"), (True, "stopped")):
            with self.subTest(running=running, state=state):
                raw = {"gateway_running": running, "gateway_state": state, "active_agents": 2,
                       "gateway_mode": "multiplex", "gateway_shared_with": PROFILES}
                gateway = app.normalize_gateway(raw, self.now)
                aggregate = app.aggregate_gateway(gateway, {}, dict.fromkeys(PROFILES))
                self.assertIsNone(aggregate["active_agents"])
                self.assertIsNone(aggregate["busy"])
                self.assertFalse(aggregate["count_complete"])

    def test_public_profile_discovery_rejects_missing_or_malformed_roster(self):
        self.client.authenticated = False
        original = self.client.get
        for names in (None, [], ["default", None], ["x" * 101], {"default": {}}):
            with self.subTest(names=names):
                def malformed(path, query=None):
                    payload = original(path, query)
                    if path == "/api/status" and not query:
                        payload["profiles"] = names
                    return payload
                self.client.get = malformed
                self.monitor.last_profiles_attempt = 0
                self.monitor.refresh_now(force=True)
                state = self.monitor.snapshot()
                self.assertTrue(state["source"]["stale"])
                self.assertFalse(state["source"]["connected"])
                self.assertEqual(state["agents"], [])
                self.assertEqual(state["sessions"], [])

    def test_shared_counts_do_not_fabricate_bot_work(self):
        gateway = app.normalize_gateway({"gateway_running": True, "gateway_state": "running", "active_agents": 3,
                                         "gateway_shared_with": PROFILES, "gateway_mode": "multiplex"}, self.now)
        self.assertEqual(app.bot_status(gateway)[0], "unknown")
        gateway["active_agents"] = 0
        self.assertEqual(app.bot_status(gateway)[0], "idle")
        gateway["running"] = False
        self.assertEqual(app.bot_status(gateway)[0], "offline")
        gateway.update(running=True, active_agents=None)
        self.assertEqual(app.bot_status(gateway)[0], "unknown")

    def test_positive_work_requires_verified_profile_ownership(self):
        base = {"gateway_running": True, "gateway_state": "running", "active_agents": 1}
        ambiguous = ({}, {"gateway_mode": "unknown"},
                     {"gateway_mode": "multiple", "gateway_shared_with": {"name": "crm-kim"}},
                     {"gateway_mode": "multiple", "gateway_shared_with": [None]},
                     {"gateway_mode": "multiple", "gateway_shared_with": ["default"]},
                     {"gateway_shared_with": ["crm-kim", "default"]})
        for metadata in ambiguous:
            with self.subTest(metadata=metadata):
                gateway = app.normalize_gateway({**base, **metadata}, self.now, profile="crm-kim")
                self.assertEqual(app.bot_status(gateway)[0], "unknown")
        for metadata in ({"gateway_mode": "multiple", "gateway_shared_with": None},
                         {"gateway_mode": "single", "gateway_shared_with": ["crm-kim"]},
                         {"gateway_shared_with": ["crm-kim"]}):
            with self.subTest(metadata=metadata):
                gateway = app.normalize_gateway({**base, **metadata}, self.now, profile="crm-kim")
                self.assertEqual(app.bot_status(gateway)[0], "working")

    def test_partial_session_scan_preserves_failed_profiles_rows_and_counts(self):
        self.monitor.refresh_now()
        last_good = self.monitor.snapshot()["sessions"]
        original = self.client.get
        def partial(path, query=None):
            if path == "/api/profiles/sessions":
                return {"sessions": [{"id": "healthy-session", "profile": "pms-bot", "message_count": 2}],
                        "profile_totals": {"pms-bot": 4},
                        "errors": [{"profile": "crm-kim", "error": "SECRET DATABASE ERROR"}]}
            return original(path, query)
        self.client.get = partial
        self.now += 11
        self.monitor.refresh_now()
        state = self.monitor.snapshot()
        agents = {a["profile"]: a for a in state["agents"]}
        self.assertEqual(agents["crm-kim"]["session_count"], 12)
        self.assertEqual(agents["pms-bot"]["session_count"], 4)
        self.assertEqual([s for s in state["sessions"] if s["profile"] == "crm-kim"], last_good)
        self.assertEqual(len(state["sessions"]), 2)
        self.assertTrue(state["source"]["stale"])
        self.assertNotIn("SECRET DATABASE ERROR", json.dumps(state))
        self.assertEqual(state["events"], [])

    def test_unattributed_partial_error_preserves_entire_session_snapshot(self):
        self.monitor.refresh_now()
        previous = self.monitor.snapshot()
        original = self.client.get
        def partial(path, query=None):
            if path == "/api/profiles/sessions":
                return {"sessions": [], "profile_totals": {}, "errors": [{"error": "UNKNOWN PRIVATE ERROR"}]}
            return original(path, query)
        self.client.get = partial
        self.now += 11
        self.monitor.refresh_now()
        state = self.monitor.snapshot()
        self.assertEqual(state["sessions"], previous["sessions"])
        self.assertEqual(next(a for a in state["agents"] if a["profile"] == "crm-kim")["session_count"], 12)
        self.assertTrue(state["source"]["stale"])
        self.assertNotIn("UNKNOWN PRIVATE ERROR", json.dumps(state))

    def test_activity_events_are_metadata_and_counts_only(self):
        self.monitor.refresh_now()
        self.now += 11
        self.client.messages += 3
        self.client.tools += 2
        self.monitor.refresh_now()
        event = self.monitor.snapshot()["events"][0]
        self.assertEqual(event["messages_added"], 3)
        self.assertEqual(event["tools_added"], 2)
        self.assertEqual(set(event), {"id", "type", "profile", "agent_id", "label", "detail", "timestamp", "session_id", "at", "messages_added", "tools_added"})

    def test_auth_failure_retains_last_good_and_marks_unknown(self):
        self.monitor.refresh_now()
        old_sessions = self.monitor.snapshot()["sessions"]
        self.now += 11
        self.client.failure = True
        self.monitor.refresh_now()
        state = self.monitor.snapshot()
        self.assertEqual(state["sessions"], old_sessions)
        self.assertEqual(len(state["agents"]), 5)
        self.assertTrue(all(a["status"] == "unknown" for a in state["agents"]))
        self.assertTrue(state["source"]["stale"])
        self.assertTrue(state["source"]["requires_login"])
        self.assertFalse(state["source"]["connected"])
        self.assertEqual(state["gateway"]["state"], "unknown")

    def test_restart_loads_roster_as_unverified(self):
        self.monitor.refresh_now()
        restored = app.Monitor(self.client, self.data, clock=lambda: self.now)
        try:
            state = restored.snapshot()
            self.assertEqual(len(state["agents"]), 5)
            self.assertTrue(all(a["status"] == "unknown" for a in state["agents"]))
            self.assertTrue(state["source"]["stale"])
            self.assertEqual(state["source"]["last_sync"], self.now)
            if os.name == "posix":
                self.assertEqual(self.monitor.snapshot_file.stat().st_mode & 0o777, 0o600)
        finally:
            restored.close()

    def test_cache_ttls_apply_to_success_and_failure_without_background_polling(self):
        self.monitor.refresh_now()
        first = len(self.client.calls)
        self.assertFalse(self.monitor.refresh_now())
        self.assertEqual(len(self.client.calls), first)
        self.now += 11
        self.client.failure = True
        self.monitor.refresh_now()
        self.assertEqual(sum(path == "/api/profiles" for _, path, _ in self.client.calls), 1)
        failed_count = len(self.client.calls)
        self.assertFalse(self.monitor.refresh_now())
        self.assertEqual(len(self.client.calls), failed_count)
        self.now += 60
        self.monitor.refresh_now()
        self.assertEqual(sum(path == "/api/profiles" for _, path, _ in self.client.calls), 2)
        self.assertTrue(all(method == "GET" for method, _, _ in self.client.calls))
        self.assertTrue(all(path != "/api/sessions" for _, path, _ in self.client.calls))

    def test_single_flight_nonblocking_refresh(self):
        entered, release = threading.Event(), threading.Event()
        original = self.client.get
        def blocked(path, query=None):
            if path == "/api/profiles":
                entered.set()
                release.wait(2)
            return original(path, query)
        self.client.get = blocked
        self.monitor.request_refresh()
        self.assertTrue(entered.wait(1))
        for _ in range(20):
            self.monitor.request_refresh()
        self.assertTrue(self.monitor.snapshot()["source"]["syncing"])
        release.set()
        self.monitor.worker.join(2)
        self.assertEqual(sum(path == "/api/profiles" for _, path, _ in self.client.calls), 1)


class ClientTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.data = Path(self.temp.name)
        self.client = app.HermesClient("https://hermes.example.test", self.data)

    def tearDown(self):
        self.temp.cleanup()

    def test_no_write_or_maintenance_remote_routes(self):
        with self.assertRaises(app.SourceError):
            self.client.get("/api/sessions")
        with self.assertRaises(app.SourceError):
            self.client._request(None, "POST", "/api/gateway/restart")

    def test_redirects_never_cross_origin_or_replay_password(self):
        handler = app.SameSourceRedirects(self.client.base)
        with self.assertRaises(app.SourceError):
            handler.redirect_request(Request(self.client.base + "/api/status"), None, 302, "", {}, "https://evil.test/api/status")
        with self.assertRaises(app.SourceError):
            handler.redirect_request(Request(self.client.base + "/auth/password-login", data=b"fake-password", method="POST"), None, 307, "", {}, self.client.base + "/api/status")
        with self.assertRaises(app.SourceError):
            handler.redirect_request(Request(self.client.base + "/api/status"), None, 302, "", {}, self.client.base + "/login")

    def test_cookie_refresh_is_saved_without_password(self):
        cookie = http.cookiejar.Cookie(0, "__Host-hermes_session_at", "fake-token", None, False,
                                       "hermes.example.test", False, False, "/", True, True,
                                       int(time.time()) + 3600, False, None, None, {"HttpOnly": None}, False)
        def fake(opener, method, path, query=None, payload=None):
            self.client.jar.set_cookie(cookie)
            return {"profiles": []}
        with patch.object(self.client, "_request", side_effect=fake):
            self.client.get("/api/profiles")
        saved = self.client.cookie_file.read_text()
        self.assertIn("fake-token", saved)
        self.assertNotIn("password", saved)
        if os.name == "posix":
            self.assertEqual(self.client.cookie_file.stat().st_mode & 0o777, 0o600)
        restored = app.HermesClient(self.client.base, self.data)
        self.assertEqual(next(iter(restored.jar)).value, "fake-token")

    def test_remote_http_error_body_is_never_reported(self):
        error = HTTPError(self.client.base + "/api/status", 500, "PRIVATE PASSWORD", {}, io.BytesIO(b"PRIVATE PASSWORD"))
        opener = type("Opener", (), {"open": lambda *a, **kw: (_ for _ in ()).throw(error)})()
        with self.assertRaises(app.SourceError) as caught:
            self.client._request(opener, "GET", "/api/status")
        self.assertNotIn("PRIVATE", str(caught.exception))


class ConfigurationTests(unittest.TestCase):
    def test_missing_or_invalid_source_fails_before_data_directory_creation(self):
        with tempfile.TemporaryDirectory() as temporary:
            data = Path(temporary) / "not-created"
            for configured in (None, "http://hermes.example.test", "https://user:secret@hermes.example.test"):
                environment = {"OFFICE_DATA_DIR": str(data)}
                if configured is not None:
                    environment["HERMES_URL"] = configured
                with self.subTest(configured=configured), patch.dict(os.environ, environment, clear=True), \
                     patch.object(sys, "argv", ["app.py"]), patch.object(sys, "stderr", io.StringIO()) as stderr, \
                     self.assertRaises(SystemExit) as raised:
                    app.main()
                self.assertEqual(raised.exception.code, 2)
                self.assertIn("HERMES_URL", stderr.getvalue())
                self.assertNotIn("secret", stderr.getvalue())
                self.assertFalse(data.exists())

    def test_valid_environment_source_is_used_without_a_hardcoded_dashboard(self):
        with tempfile.TemporaryDirectory() as temporary:
            data = Path(temporary) / "private-data"
            configured = "https://hermes.example.test/custom-prefix/"
            environment = {"HERMES_URL": configured, "OFFICE_DATA_DIR": str(data)}
            with patch.dict(os.environ, environment, clear=True), patch.object(sys, "argv", ["app.py"]), \
                 patch.object(sys, "stdout", io.StringIO()), patch.object(app, "HermesClient") as client, \
                 patch.object(app, "Monitor") as monitor, patch.object(app, "OfficeServer") as server:
                server.return_value.server_port = 9134
                server.return_value.serve_forever.side_effect = KeyboardInterrupt
                app.main()
                client.assert_called_once_with(configured.rstrip("/"), data)
                self.assertEqual(server.call_args.args[0], ("127.0.0.1", 9134))
                server.return_value.server_close.assert_called_once()
                monitor.return_value.close.assert_called_once()
                self.assertTrue(data.is_dir())


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.web = self.root / "web"
        self.web.mkdir()
        (self.web / "index.html").write_text("<html>monitor</html>")
        (self.root / "secret.txt").write_text("DO NOT SERVE")
        self.client = FakeHermes()
        self.monitor = app.Monitor(self.client, self.root)
        self.monitor.refresh_now()
        self.server = app.OfficeServer(("127.0.0.1", 0), self.monitor, self.web)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": .01}, daemon=True)
        self.thread.start()
        self.origin = "http://127.0.0.1:" + str(self.server.server_port)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.monitor.close()
        self.thread.join(1)
        self.temp.cleanup()

    def request(self, method, path, payload=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        try:
            body = json.dumps(payload) if payload is not None else None
            conn.request(method, path, body=body, headers=headers or {})
            response = conn.getresponse()
            return response.status, response.read()
        finally:
            conn.close()

    def test_get_metadata_and_static_no_traversal_or_hidden_proxy(self):
        code, body = self.request("GET", "/api/state")
        self.assertEqual(code, 200)
        self.assertEqual(len(json.loads(body)["agents"]), 5)
        self.assertEqual(self.request("GET", "/api/health")[0], 200)
        self.assertEqual(self.request("GET", "/")[0], 200)
        self.assertEqual(self.request("GET", "/%2e%2e/secret.txt")[0], 404)
        self.assertEqual(self.request("GET", "/api/proxy?url=https://evil.test")[0], 404)
        self.assertEqual(self.request("GET", "/api/state", headers={"Host": "evil.test"})[0], 403)

    def test_login_requires_exact_origin_csrf_and_json(self):
        payload = {"username": "test-user", "password": "test-password"}
        good = {"Origin": self.origin, "X-CSRF-Token": self.server.csrf_token, "Content-Type": "application/json"}
        self.assertEqual(self.request("POST", "/api/connect", payload)[0], 403)
        self.assertEqual(self.request("POST", "/api/connect", payload, {**good, "Origin": "https://evil.test"})[0], 403)
        self.assertEqual(self.request("POST", "/api/connect", payload, {**good, "X-CSRF-Token": "wrong"})[0], 403)
        self.assertEqual(self.request("POST", "/api/connect", payload, {**good, "Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.client.login_count, 0)
        self.assertEqual(self.request("POST", "/api/connect", payload, good)[0], 200)
        self.monitor.worker.join(2)
        self.assertEqual(self.client.login_count, 1)
        state = json.dumps(self.monitor.snapshot())
        self.assertNotIn("test-password", state)
        self.assertNotIn("test-password", self.monitor.snapshot_file.read_text())
        posts = [(method, path) for method, path, _ in self.client.calls if method == "POST"]
        self.assertEqual(posts, [("POST", "/auth/password-login")])

    def test_input_limits_and_all_action_routes_disabled(self):
        good = {"Origin": self.origin, "X-CSRF-Token": self.server.csrf_token, "Content-Type": "application/json"}
        self.assertEqual(self.request("POST", "/api/connect", {"username": "a", "password": "x" * (app.MAX_BODY + 1)}, good)[0], 413)
        self.assertEqual(self.request("POST", "/api/connect", {"username": "a", "password": "x", "url": "https://evil.test"}, good)[0], 400)
        for method, path in (("POST", "/api/tasks"), ("POST", "/api/model"), ("POST", "/api/gateway/restart"), ("DELETE", "/api/state"), ("PUT", "/api/connect")):
            self.assertEqual(self.request(method, path, {}, good)[0], 405)
        self.assertEqual(self.client.login_count, 0)

    def test_nonloopback_bind_is_refused(self):
        with self.assertRaises(ValueError):
            app.OfficeServer(("0.0.0.0", 0), self.monitor, self.web)


if __name__ == "__main__":
    unittest.main()
