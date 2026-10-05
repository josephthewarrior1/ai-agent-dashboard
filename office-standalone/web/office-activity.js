(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.HermesOfficeActivity = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  const TTL_MS = 15_000, RECENT_MS = 30_000;
  const MAX_SESSIONS = 200, MAX_SEEN = 512, MAX_EVENTS = 16, MAX_ROWS = 100;
  const plain = (value, limit) => typeof value === "string" ? Array.from(value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim()).slice(0, limit).join("") : "";
  const identifier = (value, limit) => typeof value === "string" && value.length > 0 && value.length <= limit ? value : null;
  const timestamp = value => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
  const hash = value => { let result = 2166136261; for (const character of value) result = Math.imul(result ^ character.codePointAt(0), 16777619); return (result >>> 0).toString(36); };
  function messageIdentity(row) {
    const id = typeof row.id === "number" && Number.isSafeInteger(row.id) ? String(row.id) : identifier(row.id, 200);
    const numeric = id && /^[0-9]{1,15}$/.test(id) ? Number(id) : null;
    if (id) return {key:"id:" + id, id, numeric};
    // Only hashes are retained for rows whose source lacks an ID; never a transcript.
    const material = JSON.stringify([row.role, timestamp(row.timestamp), plain(row.content, 16_000), plain(row.tool_name, 120), row.tool_call_id || ""]);
    return {key:"text:" + hash(material), id:null, numeric:null};
  }
  function eventFor(row, profile, sessionId, identity, now) {
    const call = Array.isArray(row.tool_calls) ? row.tool_calls.find(value => value && typeof value.name === "string" && value.name.trim()) : null;
    const toolName = plain(row.tool_name, 40) || (call ? plain(call.name, 40) : "");
    const tool = row.role === "tool" || Boolean(call);
    return {id:JSON.stringify([profile, sessionId, identity.key]), profile, session_id:sessionId, message_id:identity.id,
      role:row.role, kind:tool ? "tool" : row.role === "user" ? "incoming" : "reply",
      label:tool ? toolName || "Mengerjakan" : row.role === "user" ? "Pesan masuk" : "Balasan",
      snippet:plain(row.content, 100), tool_name:toolName || null, timestamp:timestamp(row.timestamp),
      created_at:now, expires_at:now + TTL_MS};
  }
  function create() {
    const sessions = new Map(), bubbles = new Map();
    function observe(profile, payload, timeMs, context = {}) {
      if (!identifier(profile, 100) || !payload || payload.available !== true || payload.stale === true || payload.requires_login === true || payload.profile !== profile || !Number.isFinite(timeMs)) return [];
      const sessionId = identifier(payload.session_id, 200), selectedId = payload.requested_session_id || sessionId;
      if (!sessionId || context.sessionId && selectedId !== context.sessionId || !Array.isArray(payload.messages)) return [];
      // Older history pages and oldest-first pages are never arrival feeds.
      const pagination = payload.pagination;
      if (!pagination || pagination.offset !== 0 || pagination.order !== "latest") return [];
      const key = JSON.stringify([profile, sessionId]), previous = sessions.get(key);
      const state = previous || {profile, seen:new Set(), numericHigh:null};
      const baselineHigh = state.numericHigh, events = [];
      const wallTime = Number.isFinite(context.wallTimeMs) ? context.wallTimeMs : timeMs >= 1_000_000_000_000 ? timeMs : null;
      for (const row of payload.messages.slice(0, MAX_ROWS)) {
        if (!row || !["user", "assistant", "tool"].includes(row.role) || row.display_kind === "hidden") continue;
        const identity = messageIdentity(row), unseen = !state.seen.has(identity.key);
        const newer = identity.numeric === null || baselineHigh === null || identity.numeric > baselineHigh;
        const stamp = timestamp(row.timestamp), age = stamp !== null && wallTime !== null ? wallTime - stamp * 1000 : null;
        const recentInitial = context.allowRecentInitial === true && age !== null && age >= -2000 && age <= RECENT_MS;
        if (unseen && newer && (previous || recentInitial)) events.push(eventFor(row, profile, sessionId, identity, timeMs));
        state.seen.delete(identity.key); state.seen.add(identity.key);
        if (identity.numeric !== null) state.numericHigh = Math.max(state.numericHigh === null ? identity.numeric : state.numericHigh, identity.numeric);
      }
      while (state.seen.size > MAX_SEEN) state.seen.delete(state.seen.values().next().value);
      sessions.delete(key); sessions.set(key, state);
      while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
      const result = events.slice(-MAX_EVENTS);
      if (result.length) {
        bubbles.delete(profile); bubbles.set(profile, result[result.length - 1]);
        while (bubbles.size > 100) bubbles.delete(bubbles.keys().next().value);
      }
      return result.map(value => ({...value}));
    }
    function getBubble(profile, timeMs, context = {}) {
      if (!identifier(profile, 100) || !Number.isFinite(timeMs)) return null;
      const value = bubbles.get(profile);
      if (value && timeMs >= value.created_at && timeMs < value.expires_at) return {...value};
      if (value) bubbles.delete(profile);
      return context.status === "working" ? {profile, kind:"working", label:"Mengerjakan…", snippet:"", timestamp:null, created_at:null, expires_at:null} : null;
    }
    function clear(profile) {
      if (profile === undefined) {sessions.clear(); bubbles.clear(); return;}
      bubbles.delete(profile);
      for (const [key, state] of sessions) if (state.profile === profile) sessions.delete(key);
    }
    return Object.freeze({observe, getBubble, clear});
  }
  return Object.freeze({create, TTL_MS, RECENT_MS});
});
