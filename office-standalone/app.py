#!/usr/bin/env python3
"""A local, read-only control room for an existing Hermes dashboard.

Set HERMES_URL to the existing HTTPS source, then run:
DATA_DIR=/private/office-data python3 app.py --port 9134
HERMES_URL selects the existing HTTPS dashboard. No Hermes code or model runs
here. If a trusted reverse proxy is used, set OFFICE_ORIGIN to its exact origin
and protect that proxy separately; this service only binds to loopback.
"""
from __future__ import annotations

import argparse
import copy
import http.cookiejar
import ipaddress
import json
import math
import mimetypes
import os
from pathlib import Path
import secrets
import socket
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from http.cookies import SimpleCookie
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, unquote, urlsplit
from urllib.request import HTTPCookieProcessor, HTTPRedirectHandler, Request, build_opener

POLL_SECONDS = 10
PROFILE_SECONDS = 60
MAX_BODY = 16_384
MAX_REMOTE_BODY = 1_048_576
MAX_PROFILES = 100
MAX_SESSIONS = 100
MAX_EVENTS = 100
GET_PATHS = frozenset({"/api/profiles", "/api/profiles/sessions", "/api/status", "/api/auth/providers", "/api/auth/me"})


class SourceError(Exception):
    def __init__(self, message="Hermes tidak dapat dihubungi.", requires_login=False):
        super().__init__(message)
        self.requires_login = requires_login


def origin(url):
    parsed = urlsplit(url)
    return parsed.scheme.lower(), parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80)


def source_url(value):
    if not isinstance(value, str) or len(value) > 500 or any(ord(c) < 33 for c in value):
        raise ValueError("HERMES_URL harus berupa URL HTTPS.")
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("HERMES_URL harus berupa URL HTTPS tanpa kredensial/query.")
    _ = parsed.port
    if "\\" in value or any(s in (".", "..") for s in unquote(parsed.path).split("/")):
        raise ValueError("Path HERMES_URL tidak valid.")
    return value.rstrip("/")


def private_write(path, value):
    """Atomic private file; never place a credential in an intermediate public file."""
    fd, temporary = tempfile.mkstemp(prefix=".office-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(value)
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class SameSourceRedirects(HTTPRedirectHandler):
    def __init__(self, base):
        self.base = base

    def redirect_request(self, request, fp, code, msg, headers, newurl):
        # Login returns JSON. Never replay its password body through a redirect.
        if request.get_method() != "GET" or origin(newurl) != origin(self.base):
            raise SourceError("Redirect Hermes ditolak.")
        prefix = urlsplit(self.base).path.rstrip("/")
        if urlsplit(newurl).path not in {prefix + p for p in GET_PATHS}:
            raise SourceError("Sesi login Hermes perlu disambungkan ulang.", requires_login=True)
        return super().redirect_request(request, fp, code, msg, headers, newurl)


class HermesClient:
    def __init__(self, base, data_dir):
        self.base = source_url(base)
        self.cookie_file = data_dir / "hermes-cookies.txt"
        self.lock = threading.RLock()
        self.jar = http.cookiejar.LWPCookieJar()
        if self.cookie_file.is_file() and not self.cookie_file.is_symlink() and self.cookie_file.stat().st_size <= 65_536:
            try:
                self.jar.load(str(self.cookie_file), ignore_discard=True)
            except (OSError, http.cookiejar.LoadError):
                self.jar.clear()
        self.opener = self._opener(self.jar)

    def _opener(self, jar):
        return build_opener(HTTPCookieProcessor(jar), SameSourceRedirects(self.base))

    def _save(self):
        fd, temporary = tempfile.mkstemp(prefix=".cookies-", dir=self.cookie_file.parent)
        os.close(fd)
        try:
            self.jar.save(temporary, ignore_discard=True, ignore_expires=True)
            os.chmod(temporary, 0o600)
            os.replace(temporary, self.cookie_file)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def _request(self, opener, method, path, query=None, payload=None):
        if method == "GET" and path not in GET_PATHS:
            raise SourceError("Endpoint monitoring tidak diizinkan.")
        if method != "GET" and (method != "POST" or path != "/auth/password-login"):
            raise SourceError("Connector ini hanya membaca Hermes.")
        url = self.base + path + ("?" + urlencode(query) if query else "")
        headers = {"Accept": "application/json", "User-Agent": "HermesOfficeMonitor/1.0"}
        body = None
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            parsed_base = urlsplit(self.base)
            headers.update({"Content-Type": "application/json", "Origin": parsed_base.scheme + "://" + parsed_base.netloc})
        request = Request(url, data=body, headers=headers, method=method)
        try:
            with opener.open(request, timeout=10) as response:
                if origin(response.geturl()) != origin(self.base):
                    raise SourceError("Redirect Hermes ditolak.")
                if response.headers.get_content_type() != "application/json":
                    raise SourceError("Respons Hermes bukan data monitoring.")
                data = response.read(MAX_REMOTE_BODY + 1)
                if len(data) > MAX_REMOTE_BODY:
                    raise SourceError("Respons Hermes terlalu besar.")
                value = json.loads(data)
                if not isinstance(value, dict):
                    raise SourceError("Format respons Hermes tidak dikenali.")
                return value
        except HTTPError as error:
            error.close()
            if error.code in (401, 403):
                raise SourceError("Sesi login Hermes perlu disambungkan ulang.", requires_login=True) from None
            if error.code == 429:
                raise SourceError("Hermes membatasi request; tunggu sebelum mencoba lagi.") from None
            raise SourceError("Endpoint Hermes belum tersedia.") from None
        except (URLError, OSError, ValueError, TimeoutError):
            raise SourceError() from None

    def get(self, path, query=None):
        with self.lock:
            try:
                return self._request(self.opener, "GET", path, query)
            finally:
                # Refresh and expired-cookie deletion arrive on ordinary GET responses.
                self._save()

    def has_session(self):
        with self.lock:
            request = Request(self.base + "/api/profiles")
            self.jar.add_cookie_header(request)
            eligible = SimpleCookie()
            eligible.load(request.get_header("Cookie", ""))
            return any(name in eligible and eligible[name].value for name in {
                "hermes_session_at", "hermes_session_rt", "__Host-hermes_session_at", "__Host-hermes_session_rt",
                "__Secure-hermes_session_at", "__Secure-hermes_session_rt"})

    def login(self, username, password):
        with self.lock:
            jar = http.cookiejar.LWPCookieJar()
            opener = self._opener(jar)
            response = self._request(opener, "POST", "/auth/password-login", payload={
                "provider": "basic", "username": username, "password": password, "next": "/"})
            if response.get("ok") is not True or not list(jar):
                raise SourceError("Login Hermes belum berhasil.", requires_login=True)
            identity = self._request(opener, "GET", "/api/auth/me")
            if identity.get("provider") != "basic" or not identity.get("user_id"):
                raise SourceError("Sesi login Hermes belum terverifikasi.", requires_login=True)
            self.jar, self.opener = jar, opener
            self._save()


def text(value, maximum=160):
    if not isinstance(value, str):
        return ""
    return "".join(c for c in value if ord(c) >= 32)[:maximum]


def count(value):
    return min(max(value, 0), 1_000_000_000) if isinstance(value, int) and not isinstance(value, bool) else 0


def timestamp(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0 else None


def normalize_sessions(payload, profiles):
    if not isinstance(payload.get("sessions"), list):
        raise SourceError("Format daftar sesi Hermes tidak dikenali.")
    result = []
    for row in payload["sessions"][:MAX_SESSIONS]:
        if not isinstance(row, dict) or not text(row.get("id"), 200):
            continue
        profile = text(row.get("profile"), 100) or "default"
        if profile not in profiles:
            continue
        result.append({"id": text(row["id"], 200), "profile": profile, "agent_id": profile, "title": text(row.get("title"), 160),
                       "source": text(row.get("source"), 60), "started_at": timestamp(row.get("started_at")),
                       "ended_at": timestamp(row.get("ended_at")), "last_active": timestamp(row.get("last_active")),
                       "recent_activity": row.get("is_active") is True,
                       "message_count": count(row.get("message_count")), "tool_call_count": count(row.get("tool_call_count"))})
    totals = payload.get("profile_totals") if isinstance(payload.get("profile_totals"), dict) else {}
    return result, {name: count(totals.get(name)) for name in profiles}


def public_profiles(payload, previous):
    names = payload.get("profiles")
    if not isinstance(names, list) or not names or len(names) > MAX_PROFILES or not all(
        isinstance(name, str) and name and name == text(name, 100) for name in names):
        raise SourceError("Daftar bot pada status Hermes belum dikenali.")
    return {name: {"name": name, "display_name": previous.get(name, {}).get("display_name") or name} for name in names}


def normalize_gateway(raw, now, profile=None):
    if not isinstance(raw.get("gateway_running"), bool):
        raise SourceError("Status gateway Hermes belum dikenali.")
    platforms = raw.get("gateway_platforms") if isinstance(raw.get("gateway_platforms"), dict) else {}
    active = raw.get("active_agents")
    active = count(active) if isinstance(active, int) and not isinstance(active, bool) and active >= 0 else None
    raw_shared = raw.get("gateway_shared_with")
    valid_shared = isinstance(raw_shared, list) and len(raw_shared) <= MAX_PROFILES and all(
        isinstance(s, str) and s == text(s, 100) and s for s in raw_shared)
    shared = [text(s, 100) for s in raw_shared[:MAX_PROFILES] if isinstance(s, str)] if isinstance(raw_shared, list) else []
    mode = text(raw.get("gateway_mode"), 40)
    own_shared = valid_shared and len(shared) == 1 and (profile is None or shared[0] == profile)
    dedicated = mode in ("single", "multiple") and (raw_shared is None or valid_shared and len(shared) <= 1)
    if profile is not None and valid_shared and shared and profile not in shared:
        dedicated = False
    return {"running": raw["gateway_running"], "state": text(raw.get("gateway_state"), 40) or "unknown",
            "active_agents": active, "busy": raw.get("gateway_busy") if isinstance(raw.get("gateway_busy"), bool) else None,
            "shared_with": shared, "shared_verified": valid_shared, "mode": mode,
            "ownership_verified": dedicated or own_shared, "updated_at": now,
            "platforms": {text(k, 60): {"state": text(v.get("state"), 40) or "unknown"}
                          for k, v in list(platforms.items())[:100] if isinstance(v, dict)}}


def bot_status(gateway):
    if not gateway or gateway.get("stale"):
        return "unknown", "Status bot belum terverifikasi."
    if gateway["running"] is False:
        return "offline", "Gateway bot tidak berjalan."
    active = gateway["active_agents"]
    if gateway["state"] == "running" and active == 0:
        return "idle", "Gateway siap; tidak ada pekerjaan aktif yang dilaporkan."
    shared = len(gateway["shared_with"]) > 1 or not gateway.get("ownership_verified", False)
    if gateway["state"] == "running" and active and not shared:
        return "working", "Gateway profile melaporkan pekerjaan aktif."
    if active and shared:
        return "unknown", "Gateway sedang aktif; bot yang bekerja belum teridentifikasi."
    return "unknown", "Gateway terhubung; status pekerjaan belum terverifikasi."


def aggregate_gateway(gateway, per_profile, profiles):
    if not gateway:
        return None
    result = {**gateway, "reported_active_agents": gateway.get("active_agents"),
              "scope": "all_profiles", "count_complete": False, "active_agents": None, "busy": None}
    if gateway.get("stale") or not profiles:
        return result
    dedicated = gateway["mode"] == "multiple" or gateway["mode"] == "single" and len(profiles) == 1
    if dedicated and all(name in per_profile and not per_profile[name].get("stale") and
                         per_profile[name]["ownership_verified"] and per_profile[name]["active_agents"] is not None and
                         (per_profile[name]["running"] and per_profile[name]["state"] == "running" or
                          per_profile[name]["running"] is False and per_profile[name]["active_agents"] == 0)
                         for name in profiles):
        result["active_agents"] = min(sum(per_profile[name]["active_agents"] for name in profiles), 1_000_000_000)
        result["busy"] = result["active_agents"] > 0
        result["count_complete"] = True
    elif gateway["running"] is True and gateway["state"] == "running" and gateway["mode"] == "multiplex" and gateway["shared_verified"] and set(gateway["shared_with"]) == set(profiles) and gateway["active_agents"] is not None:
        result.update(scope="shared_gateway", active_agents=gateway["active_agents"], busy=gateway["active_agents"] > 0, count_complete=True)
    return result


class Monitor:
    def __init__(self, client, data_dir, clock=time.time):
        self.client, self.data_dir, self.clock = client, data_dir, clock
        self.lock = threading.RLock()
        self.last_attempt = self.last_profiles_attempt = 0
        self.refreshing = False
        self.closed = False
        self.generation = 0
        self.worker = None
        self.profiles = {}
        self.profile_error = None
        self.profile_gateways = {}
        self.state = {"source": {"url": client.base, "connected": False, "stale": True,
                                "requires_login": False, "last_sync": None, "error": "Belum tersambung.", "read_only": True,
                                "mode": "status_only", "sessions_available": False, "sessions_stale": True,
                                "private_detail_requires_login": False},
                      "agents": [], "sessions": [], "events": [], "gateway": None}
        self.snapshot_file = data_dir / "snapshot.json"
        if self.snapshot_file.is_file() and not self.snapshot_file.is_symlink() and self.snapshot_file.stat().st_size <= MAX_REMOTE_BODY:
            try:
                saved = json.loads(self.snapshot_file.read_text(encoding="utf-8"))
                self.profiles = {a["profile"]: {"name": a["profile"], "display_name": a["label"]}
                                 for a in saved.get("agents", [])[:MAX_PROFILES] if isinstance(a, dict) and a.get("profile")}
                self.state["agents"] = [{**a, "status": "unknown", "detail": "Menunggu sinkronisasi Hermes."} for a in saved.get("agents", [])[:MAX_PROFILES]]
                self.state["sessions"] = saved.get("sessions", [])[:MAX_SESSIONS]
                self.state["events"] = saved.get("events", [])[-MAX_EVENTS:]
                self.state["source"]["last_sync"] = saved.get("source", {}).get("last_sync")
            except (OSError, ValueError, TypeError, KeyError):
                pass

    def snapshot(self):
        with self.lock:
            result = copy.deepcopy(self.state)
            result["source"]["syncing"] = self.refreshing
            source = result["source"]
            source.update(label="Hermes", checked_at=self.last_attempt or None,
                          last_success_at=source["last_sync"], message=source["error"] or source.get("message") or "Metadata Hermes tersambung.",
                          state="needs_login" if source["requires_login"] else "stale" if source["stale"] else "connected" if source["connected"] else "disconnected")
            return result

    def _admit(self, force):
        with self.lock:
            now = self.clock()
            if self.closed or self.refreshing or (not force and self.last_attempt and now - self.last_attempt < POLL_SECONDS):
                return False
            self.last_attempt = now
            self.refreshing = True
            return True

    def request_refresh(self, force=False):
        if self._admit(force):
            self.worker = threading.Thread(target=self._refresh, name="hermes-monitor-sync", daemon=True)
            self.worker.start()

    def refresh_now(self, force=False):
        """Synchronous seam for offline tests; HTTP uses request_refresh instead."""
        if self._admit(force):
            self._refresh()
            return True
        return False

    def _refresh(self):
        with self.lock:
            now, generation = self.clock(), self.generation
            profiles = copy.deepcopy(self.profiles)
            profile_due = not self.last_profiles_attempt or now - self.last_profiles_attempt >= PROFILE_SECONDS
            if profile_due:
                self.last_profiles_attempt = now
            previous = copy.deepcopy(self.state)
            old_gateways = copy.deepcopy(self.profile_gateways)
            profile_error = self.profile_error
        errors, private_errors, requires_login = [], [], False
        sessions, totals, global_gateway = previous["sessions"], {}, previous["gateway"]
        gateways = {}
        sessions_ok = global_ok = False
        private_detail_requires_login = False
        try:
            authenticated = self.client.has_session()
            if not authenticated:
                private_detail_requires_login = previous["source"].get("private_detail_requires_login", False)
            public_payload = None
            try:
                public_payload = self.client.get("/api/status")
                global_gateway = normalize_gateway(public_payload, now)
                global_ok = True
            except SourceError as error:
                errors.append(str(error)); requires_login |= error.requires_login
                if global_gateway:
                    global_gateway = {**global_gateway, "running": None, "state": "unknown", "busy": None, "active_agents": None, "stale": True}
            if profile_due and authenticated:
                try:
                    payload = self.client.get("/api/profiles")
                    if not isinstance(payload.get("profiles"), list):
                        raise SourceError("Format profile Hermes belum dikenali.")
                    profiles = {text(p["name"], 100): {"name": text(p["name"], 100), "display_name": text(p.get("display_name"), 160)}
                                for p in payload["profiles"][:MAX_PROFILES] if isinstance(p, dict) and text(p.get("name"), 100)}
                    profile_error = None
                except SourceError as error:
                    profile_error = (str(error), error.requires_login)
            if not authenticated:
                profile_error = None
            if profile_error:
                private_errors.append(profile_error[0])
                private_detail_requires_login |= profile_error[1]
            if (profile_due and not authenticated or profile_error or not profiles) and global_ok:
                try:
                    profiles = public_profiles(public_payload, profiles)
                except SourceError as error:
                    # A failed discovery is not an authoritative empty roster.
                    if not authenticated or not profiles:
                        errors.append(str(error))
            if authenticated and not private_detail_requires_login:
                try:
                    payload = self.client.get("/api/profiles/sessions", {"profile": "all", "limit": MAX_SESSIONS, "order": "recent"})
                    fresh_sessions, fresh_totals = normalize_sessions(payload, profiles)
                    scan_errors = payload.get("errors")
                    if scan_errors:
                        # Hermes omits failed profile DBs from both rows and totals.
                        # Never turn their last-good activity/counts into an empty page.
                        if not isinstance(scan_errors, list) or not all(
                            isinstance(e, dict) and e.get("profile") in profiles for e in scan_errors):
                            raise SourceError("Sebagian profile belum dapat dibaca.")
                        failed = {e["profile"] for e in scan_errors}
                        retained = [s for s in previous["sessions"] if s["profile"] in failed]
                        fresh_sessions = retained + [s for s in fresh_sessions if s["profile"] not in failed]
                        for name in failed:
                            fresh_totals.pop(name, None)
                        private_errors.append("Sebagian profile belum dapat dibaca.")
                    sessions, totals = fresh_sessions[:MAX_SESSIONS], fresh_totals
                    sessions_ok = True
                except SourceError as error:
                    private_errors.append(str(error)); private_detail_requires_login |= error.requires_login
            if global_ok:
                for name in profiles:
                    try:
                        gateways[name] = normalize_gateway(self.client.get("/api/status", {"profile": name}), now, profile=name)
                    except SourceError as error:
                        errors.append(str(error)); requires_login |= error.requires_login
                        if old_gateways.get(name):
                            gateways[name] = {**old_gateways[name], "running": None, "state": "unknown", "busy": None, "active_agents": None, "stale": True}
            else:
                gateways = {name: {**value, "running": None, "state": "unknown", "busy": None,
                                   "active_agents": None, "stale": True} for name, value in old_gateways.items()}
            agents = []
            old_agents = {a["profile"]: a for a in previous["agents"]}
            for name, profile in profiles.items():
                status, detail = bot_status(gateways.get(name))
                if requires_login:
                    status, detail = "unknown", "Sambungkan ulang login dashboard untuk memverifikasi bot."
                own = [s for s in sessions if s["profile"] == name]
                agents.append({"id": name, "profile": name, "label": profile["display_name"] or name,
                               "role": "Hermes bot", "status": status, "detail": detail, "updated_at": now,
                               "session_count": totals.get(name, old_agents.get(name, {}).get("session_count", len(own) if sessions_ok else None)),
                               "recent_activity": sessions_ok and any(s["recent_activity"] for s in own),
                               "last_active": max((s["last_active"] or 0 for s in own), default=0) or None,
                               "gateway": gateways.get(name), "platforms": list((gateways.get(name) or {}).get("platforms", {}))})
            events = previous["events"]
            if sessions_ok:
                old_sessions = {(s["profile"], s["id"]): s for s in previous["sessions"]}
                for session in sessions:
                    old = old_sessions.get((session["profile"], session["id"]))
                    messages = max(0, session["message_count"] - (old["message_count"] if old else session["message_count"]))
                    tools = max(0, session["tool_call_count"] - (old["tool_call_count"] if old else session["tool_call_count"]))
                    if messages or tools:
                        profile = session["profile"]
                        events.append({"id": profile + ":" + session["id"] + ":" + str(now), "type": "activity", "profile": profile,
                                       "agent_id": profile, "label": profiles[profile]["display_name"] or profile,
                                       "detail": str(messages) + " pesan baru; " + str(tools) + " tool tercatat.",
                                       "session_id": session["id"], "at": now, "timestamp": now,
                                       "messages_added": messages, "tools_added": tools})
            with self.lock:
                if generation == self.generation and not self.closed:
                    self.profiles, self.profile_gateways = profiles, gateways
                    self.profile_error = profile_error
                    # An expired optional detail login must not hide fresh public bot status.
                    detail_errors = private_errors if not private_detail_requires_login else []
                    all_errors = errors + detail_errors
                    self.state = {"agents": agents, "sessions": sessions, "events": events[-MAX_EVENTS:],
                                  "gateway": aggregate_gateway(global_gateway, gateways, profiles),
                                  "source": {"url": self.client.base, "connected": global_ok and bool(profiles) and not requires_login,
                                             "stale": bool(all_errors), "requires_login": requires_login, "read_only": True,
                                             "mode": "full" if sessions_ok else "status_only", "sessions_available": sessions_ok,
                                             "sessions_stale": not sessions_ok or bool(private_errors),
                                             "private_detail_requires_login": private_detail_requires_login,
                                             "last_sync": now if not all_errors else previous["source"]["last_sync"],
                                             "message": "Metadata Hermes tersambung." if sessions_ok else "Status bot live. Detail sesi bisa dilihat di Hermes.",
                                             "error": all_errors[0] if all_errors else None}}
                    private_write(self.snapshot_file, json.dumps(self.state, ensure_ascii=False))
        except Exception:
            # No remote body, password or arbitrary exception string enters the snapshot.
            with self.lock:
                if generation == self.generation:
                    self.state["source"].update(stale=True, error="Sinkronisasi Hermes belum berhasil.")
                    for agent in self.state["agents"]:
                        agent.update(status="unknown", detail="Status bot belum terverifikasi.")
        finally:
            with self.lock:
                self.refreshing = False

    def connect(self, username, password):
        self.client.login(username, password)
        with self.lock:
            self.generation += 1
            self.last_attempt = self.last_profiles_attempt = 0
            self.profile_error = None
            self.state["source"].update(requires_login=False, error=None)
        self.request_refresh(force=True)

    def close(self):
        with self.lock:
            self.closed = True
        if self.worker and self.worker.is_alive():
            self.worker.join(timeout=1)


class OfficeServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 16

    def __init__(self, address, monitor, web_dir, public_origin=""):
        host = address[0]
        try:
            safe_host = ipaddress.ip_address(host).is_loopback
        except ValueError:
            safe_host = host == "localhost"
        if not safe_host:
            raise ValueError("Monitor hanya boleh bind ke loopback.")
        if ":" in host:
            self.address_family = socket.AF_INET6
        self.monitor, self.web_dir = monitor, Path(web_dir).resolve()
        self.csrf_token = secrets.token_urlsafe(32)
        self.public_origin = public_origin.rstrip("/")
        if public_origin:
            p = urlsplit(public_origin)
            if p.scheme not in ("http", "https") or not p.hostname or p.username or p.password or p.path not in ("", "/") or p.query or p.fragment:
                raise ValueError("OFFICE_ORIGIN harus berupa origin tanpa path.")
        super().__init__(address, Handler)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def _origin(self):
        host = self.headers.get("Host", "")
        if self.server.public_origin:
            return self.server.public_origin if host == urlsplit(self.server.public_origin).netloc else None
        try:
            parsed = urlsplit("http://" + host)
            valid_host = parsed.hostname == "localhost" or ipaddress.ip_address(parsed.hostname).is_loopback
            if not valid_host or parsed.port != self.server.server_port or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
                return None
            return "http://" + host
        except (ValueError, TypeError):
            return None

    def _send(self, code, payload, content_type="application/json"):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if content_type == "application/json" else payload
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "same-origin")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self._origin():
            return self._send(403, {"error": "Host tidak diizinkan."})
        path = urlsplit(self.path).path
        if path in ("/api/health", "/health"):
            return self._send(200, {"ok": True, "read_only": True})
        if path == "/api/state":
            self.server.monitor.request_refresh()
            return self._send(200, self.server.monitor.snapshot())
        if path == "/api/connect-options":
            return self._send(200, {"csrf_token": self.server.csrf_token, "source_url": self.server.monitor.client.base})
        if path.startswith("/api/"):
            return self._send(404, {"error": "Endpoint tidak ditemukan."})
        path = unquote(path)
        if "\\" in path or "\0" in path or any(s in (".", "..") for s in path.split("/")):
            return self._send(404, {"error": "File tidak ditemukan."})
        relative = "index.html" if path == "/" else "connect.html" if path == "/connect" else path.lstrip("/")
        target = (self.server.web_dir / relative).resolve()
        if not target.is_relative_to(self.server.web_dir) or not target.is_file() or target.suffix.lower() not in {".html", ".js", ".css", ".png", ".svg", ".woff2", ".ico", ".json"}:
            return self._send(404, {"error": "File tidak ditemukan."})
        return self._send(200, target.read_bytes(), mimetypes.guess_type(target.name)[0] or "application/octet-stream")

    def do_POST(self):
        if urlsplit(self.path).path != "/api/connect":
            return self._send(405, {"error": "Monitor tidak menjalankan atau mengubah bot."})
        expected = self._origin()
        supplied_csrf = self.headers.get("X-CSRF-Token", "")
        if not expected or self.headers.get("Origin") != expected or len(supplied_csrf) > 256 or not secrets.compare_digest(supplied_csrf.encode("utf-8"), self.server.csrf_token.encode("ascii")):
            return self._send(403, {"error": "Request login harus berasal dari halaman monitor."})
        if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json" or self.headers.get("Transfer-Encoding"):
            return self._send(415, {"error": "Gunakan application/json."})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= MAX_BODY:
                return self._send(413, {"error": "Body terlalu besar atau kosong."})
            payload = json.loads(self.rfile.read(size))
            if not isinstance(payload, dict) or set(payload) != {"username", "password"}:
                raise ValueError()
            username, password = payload["username"], payload["password"]
            if not isinstance(username, str) or not isinstance(password, str) or not username.strip() or not password or len(username) > 256 or len(password) > 4096:
                raise ValueError()
        except (ValueError, UnicodeError, KeyError, TimeoutError):
            return self._send(400, {"error": "Username/password dashboard diperlukan."})
        try:
            self.server.monitor.connect(username.strip(), password)
        except SourceError as error:
            return self._send(401 if error.requires_login else 502, {"error": str(error)})
        except Exception:
            return self._send(502, {"error": "Login Hermes belum berhasil."})
        finally:
            payload.clear()
            password = None
        return self._send(200, {"ok": True})

    def _readonly(self):
        self._send(405, {"error": "Monitor hanya membaca data Hermes."})

    do_PUT = do_PATCH = do_DELETE = do_OPTIONS = _readonly


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=os.environ.get("OFFICE_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("OFFICE_PORT", "9134")))
    args = parser.parse_args()
    configured_url = os.environ.get("HERMES_URL")
    if not configured_url:
        parser.error("Set HERMES_URL ke URL HTTPS dashboard Hermes yang ingin dipantau.")
    try:
        configured_url = source_url(configured_url)
    except ValueError:
        parser.error("HERMES_URL harus berupa URL HTTPS valid tanpa kredensial, query, atau fragment.")
    os.umask(0o077)
    data_dir = Path(os.environ.get("DATA_DIR") or os.environ.get("OFFICE_DATA_DIR") or Path.home() / ".local/state/hermes-office-monitor")
    data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    if data_dir.is_symlink():
        raise SystemExit("DATA_DIR tidak boleh berupa symlink.")
    os.chmod(data_dir, 0o700)
    client = HermesClient(configured_url, data_dir)
    monitor = Monitor(client, data_dir)
    server = OfficeServer((args.host, args.port), monitor, Path(__file__).parent / "web", os.environ.get("OFFICE_ORIGIN", ""))
    print("Hermes monitor listening on loopback port", server.server_port, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        monitor.close()


if __name__ == "__main__":
    main()
