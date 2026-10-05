/** Read-only live state and an explicitly separate local demo. No model executor. */
export const DESKS = Object.freeze([[-4, 0, -1.8], [0, 0, -1.8], [4, 0, -1.8], [-2, 0, 2.5], [2, 0, 2.5]]);
export const ROOM_GOALS = Object.freeze({
  meeting: [7, 0, -4], focus: [-8, 0, -4], research: [8, 0, 0], library: [-4, 0, -5.5],
  server: [9, 0, -5.5], lounge: [-8, 0, 0], pantry: [-8, 0, 4], reception: [0, 0, 6], garden: [8, 0, 5],
});
const PROFILES = ['crm-kim', 'default', 'kim-corporate', 'plus-ultra', 'pms-bot'];
const ROLES = {
  'pms-bot': ['Project, meetings & reminders', 'operations', '#a99aff'],
  'crm-kim': ['Customer & leads', 'customer_support', '#f1a87b'],
  'kim-corporate': ['Corporate knowledge', 'corporate', '#91bad8'],
  'plus-ultra': ['Research, content & data', 'research', '#96c6a1'],
  default: ['General assistant', 'general', '#d9bb77'],
};
const GATEWAY_STATUS = new Set(['idle', 'working', 'offline', 'unknown']);
const STATUS = new Set([...GATEWAY_STATUS, 'thinking', 'walking', 'meeting', 'resting', 'completed', 'error']);
const TYPES = new Set(['agent.status.changed', 'agent.task.started', 'agent.task.completed', 'agent.message.received', 'agent.tool.called', 'agent.moved']);
const ALIASES = { 'task.started': 'agent.task.started', 'task.completed': 'agent.task.completed', 'message.received': 'agent.message.received', 'tool.called': 'agent.tool.called' };
const MAX_EVENTS = 80, BUBBLE_MS = 15_000, POLL_MS = 5_000, TAIL_MS = 10_000;
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const plain = (value, maximum = 160) => typeof value === 'string' ? Array.from(value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, maximum).join('') : '';
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const percent = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
const stamp = value => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value < 1e11 ? value * 1000 : value;
  if (typeof value === 'string' && value && Number.isFinite(Date.parse(value))) return Date.parse(value);
  return null;
};
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);
const coords = value => {
  if (!Array.isArray(value) || ![2, 3].includes(value.length) || !value.every(item => typeof item === 'number' && Number.isFinite(item))) return null;
  const [x, y, z] = value.length === 2 ? [value[0], 0, value[1]] : value;
  return x >= -11 && x <= 11 && z >= -7.5 && z <= 7.5 && y === 0 ? [x, 0, z] : null;
};
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => { let result = 2166136261; for (const ch of value) result = Math.imul(result ^ ch.codePointAt(0), 16777619); return (result >>> 0).toString(36); };
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); } return value; };

function agentFor(row, index, previous) {
  const id = plain(row.id || row.profile, 100), profile = plain(row.profile || id, 100);
  const [role, category, color] = ROLES[profile] || ['General assistant', 'general', '#b9b6ae'];
  const gatewayStatus = GATEWAY_STATUS.has(row.status) ? row.status : 'unknown';
  const workflowActive = previous?.workflowActive === true;
  const status = workflowActive ? previous.status : gatewayStatus;
  const desk = [...(DESKS[index] || [Math.max(-10, Math.min(10, (index % 6) * 3 - 8)), 0, 5.5])];
  const working = status === 'working', continuingTask = workflowActive || working && previous?.status === 'working';
  return {
    id, profile, name: plain(row.label || row.name || profile, 100), role, category, status, gatewayStatus, workflowActive,
    visualState: continuingTask ? previous.visualState : working ? 'working' : status === 'offline' ? 'offline' : status === 'unknown' ? 'unknown' : 'idle',
    currentTask: continuingTask ? previous.currentTask : null, currentActivity: null, currentActivityAt: null, position: previous ? [...previous.position] : [...desk],
    targetPosition: continuingTask ? previous.targetPosition?.slice() || [...desk] : working ? [...desk] : null,
    deskPosition: desk, room: continuingTask ? previous.room : 'desk',
    progress: continuingTask ? previous.progress : null, lastActivity: stamp(row.last_active), tools: previous?.tools?.slice(0, 8) || [],
    completedToday: previous?.completedToday ?? null, responseTime: previous?.responseTime ?? null, color, detail: plain(row.detail, 220), gateway: object(row.gateway), recentConversations: [],
  };
}

export function normalizeLiveState(payload, previous = []) {
  const raw = object(payload), source = object(raw.source);
  if (!Array.isArray(raw.agents) || !raw.source || typeof raw.source !== 'object') throw new Error('Invalid Office state');
  const old = new Map(previous.map(agent => [agent.id, agent]));
  const rows = raw.agents.filter(row => row && typeof row === 'object' && validId(row.id || row.profile)).slice(0, 100)
    .sort((a, b) => String(a.id || a.profile).localeCompare(String(b.id || b.profile), 'en'));
  const seen = new Set();
  const agents = rows.filter(row => { const id = row.id || row.profile; if (seen.has(id)) return false; seen.add(id); return true; })
    .map((row, index) => agentFor(row, index, old.get(row.id || row.profile)));
  const ids = new Map(agents.map(agent => [agent.profile, agent.id]));
  const sessions = (Array.isArray(raw.sessions) ? raw.sessions : []).filter(row => row && validId(row.id) && ids.has(row.profile)).slice(0, 100)
    .map(row => ({ id: row.id, profile: row.profile, agentId: ids.get(row.profile), title: plain(row.title, 160), message_count: count(row.message_count),
      tool_call_count: count(row.tool_call_count), last_active: stamp(row.last_active), source: plain(row.source, 40) }));
  agents.forEach(agent => { agent.recentConversations = sessions.filter(session => session.profile === agent.profile)
    .sort((a, b) => (b.last_active ?? 0) - (a.last_active ?? 0)).slice(0, 3)
    .map(({ id, title, source, last_active, message_count }) => ({ id, title, source, last_active, message_count })); });
  const events = (Array.isArray(raw.events) ? raw.events : []).slice(-MAX_EVENTS).map(row => {
    const profile = plain(row?.profile || row?.agent_id, 100), agentId = ids.get(profile) || (agents.find(agent => agent.id === profile)?.id);
    if (!agentId) return null;
    return { id: plain(row.id, 220) || hash(JSON.stringify([agentId, row.at, row.session_id, row.messages_added, row.tools_added])),
      agentId, agent_id: agentId, profile, type: 'activity', label: plain(row.label, 100) || 'Aktivitas Hermes',
      text: plain(row.detail, 160), timestamp: stamp(row.timestamp ?? row.at), synthetic: false };
  }).filter(Boolean);
  return { agents, sessions, events, source: {
    url: plain(source.url, 500), label: plain(source.label, 100) || 'Hermes', connected: source.connected === true,
    state: ['connected', 'connecting', 'needs_login', 'stale', 'error', 'disconnected'].includes(source.state) ? source.state :
      source.requires_login === true ? 'needs_login' : source.stale === true ? 'stale' : source.connected === true ? 'connected' : 'disconnected',
    requires_login: source.requires_login === true,
    stale: source.stale === true, syncing: source.syncing === true, error: plain(source.error, 220) || null,
    detail: plain(source.message, 220), mode: source.mode === 'full' ? 'full' : 'status_only',
    sessions_available: source.sessions_available === true, sessions_stale: source.sessions_stale !== false,
    private_detail_requires_login: source.private_detail_requires_login === true,
    lastSync: stamp(source.last_success_at ?? source.last_sync), readOnly: true,
  } };
}

export function websocketURL(value, base) {
  if (!value || typeof value !== 'string' || value.length > 1000) return null;
  try {
    const page = new URL(base), socket = new URL(value, page);
    if (!['ws:', 'wss:'].includes(socket.protocol) || socket.username || socket.password || socket.hash) return null;
    const expected = page.protocol === 'https:' ? 'wss:' : page.protocol === 'http:' ? 'ws:' : null;
    return expected && socket.protocol === expected && socket.host === page.host ? socket.href : null;
  } catch { return null; }
}

/** Initial historical tail is a silent baseline; bounded identities only are retained. */
export function createActivityTracker() {
  const sessions = new Map();
  return {
    clear() { sessions.clear(); },
    observe(profile, payload, now, requestedId, allowRecentInitial = false) {
      if (!payload || payload.available !== true || payload.stale === true || payload.requires_login === true || payload.profile !== profile ||
          payload.requested_session_id && payload.requested_session_id !== requestedId || !validId(payload.session_id) ||
          payload.pagination?.offset !== 0 || payload.pagination?.order !== 'latest' || !Array.isArray(payload.messages)) return [];
      const key = JSON.stringify([profile, payload.session_id]);
      const previous = sessions.get(key), state = previous || { seen: new Set(), high: null };
      const baseline = state.high, events = [];
      for (const row of payload.messages.slice(0, 6)) {
        if (!row || !['user', 'assistant', 'tool'].includes(row.role) || row.display_kind === 'hidden') continue;
        const id = typeof row.id === 'number' && Number.isSafeInteger(row.id) ? String(row.id) : plain(row.id, 200);
        const identity = id ? 'id:' + id : 'text:' + hash(JSON.stringify([row.role, row.timestamp, plain(row.content, 16_000), row.tool_call_id]));
        const numeric = /^[0-9]{1,15}$/.test(id) ? Number(id) : null;
        const time = stamp(row.timestamp), age = time === null ? null : now - time;
        const freshInitial = allowRecentInitial && age !== null && age >= -2000 && age <= 30_000;
        if (!state.seen.has(identity) && (numeric === null || baseline === null || numeric > baseline) && (previous || freshInitial)) {
          const call = Array.isArray(row.tool_calls) ? row.tool_calls.find(item => typeof item?.name === 'string') : null;
          const tool = row.role === 'tool' || Boolean(call), toolName = plain(row.tool_name || call?.name, 60);
          events.push({ id: JSON.stringify([profile, payload.session_id, identity]), profile, type: tool ? 'agent.tool.called' : 'agent.message.received',
            kind: tool ? 'tool' : row.role === 'user' ? 'incoming' : 'reply', label: tool ? toolName || 'Tool' : row.role === 'user' ? 'Pesan masuk' : 'Balasan',
            text: row.role === 'tool' ? 'Hasil tool diterima' : call ? 'Tool sedang digunakan' : plain(row.content, 100),
            timestamp: time, toolName, sessionId: payload.session_id, synthetic: false });
        }
        state.seen.delete(identity); state.seen.add(identity);
        if (numeric !== null) state.high = Math.max(state.high ?? numeric, numeric);
      }
      while (state.seen.size > 512) state.seen.delete(state.seen.values().next().value);
      sessions.delete(key); sessions.set(key, state);
      while (sessions.size > 200) sessions.delete(sessions.keys().next().value);
      return events.slice(-6);
    },
  };
}

const freshDemo = () => ({
  agents: PROFILES.map((profile, index) => ({ ...agentFor({ id: profile, profile, label: profile, status: 'idle', detail: 'Simulasi lokal; tidak menjalankan bot.' }, index),
    name: profile, currentTask: 'Menunggu skenario demo', completedToday: null })),
  events: [], bubbles: {}, source: { label: 'Demo lokal', connected: false, stale: false, readOnly: true, detail: 'Animasi simulasi; tidak terhubung ke model atau gateway.' },
});

export function createOfficeStore(options = {}) {
  const fetcher = options.fetch ?? globalThis.fetch?.bind(globalThis);
  const now = options.now || Date.now, setTimer = options.setTimeout || globalThis.setTimeout, clearTimer = options.clearTimeout || globalThis.clearTimeout;
  const visibility = options.document ?? globalThis.document, pageURL = options.location ?? globalThis.location?.href ?? 'http://localhost';
  const socketFactory = options.webSocketFactory || (url => new globalThis.WebSocket(url));
  const configuredSocket = websocketURL(options.websocketUrl, typeof pageURL === 'string' ? pageURL : pageURL.href);
  const listeners = new Set(), activity = createActivityTracker(), tracks = new Map(), controllers = new Set(), demoTimers = new Set(), celebrations = new Map();
  let live = { agents: [], events: [], bubbles: {}, source: { label: 'Hermes', connected: false, stale: true, readOnly: true, detail: 'Menunggu status Hermes.' }, sessions: [] };
  let demo = freshDemo(), mode = 'live', started = false, watching = true, selectedAgentId = null, generation = 0, pollTimer = null, tickTimer = null, socket = null, socketConnected = false;
  let snapshot, pollingToken = null, demoScenario = null, reconnectTimer = null, socketAttempt = 0, bridgeNeedsValidation = false;
  const hidden = () => visibility?.hidden === true;
  const active = () => started && watching && !hidden();
  function publish() {
    const data = mode === 'demo' ? demo : live;
    snapshot = freeze({ agents: data.agents, events: data.events.slice(-MAX_EVENTS), source: { ...data.source, watching: watching && !hidden() },
      bubbles: { ...data.bubbles }, mode, connected: mode === 'live' && data.source.connected === true, selectedAgentId,
      capabilities: { polling: true, websocket: mode === 'live' && socketConnected, liveStatus: mode === 'live' && live.source.connected === true,
        privateActivity: mode === 'live' && live.source.sessions_available === true && live.source.sessions_stale === false && !live.source.private_detail_requires_login,
        progress: data.agents.some(agent => agent.progress !== null), completedToday: data.agents.some(agent => agent.completedToday !== null),
        responseTime: data.agents.some(agent => agent.responseTime !== null), demo: true, audit: mode === 'live' && live.source.sessions_available === true } });
    listeners.forEach(listener => listener());
  }
  function cancelLive() {
    generation++; if (pollTimer !== null) clearTimer(pollTimer); pollTimer = null;
    if (reconnectTimer !== null) clearTimer(reconnectTimer); reconnectTimer = null;
    for (const controller of controllers) controller.abort(); controllers.clear();
    tracks.forEach(track => { track.pending = false; });
    if (socket) { bridgeNeedsValidation ||= socketConnected; const old = socket; socket = null; old.close(); } socketConnected = false;
  }
  function cancelDemo() { for (const timer of demoTimers) clearTimer(timer); demoTimers.clear(); demoScenario = null; for (const [key, value] of celebrations) if (value.mode === 'demo') celebrations.delete(key); }
  function bubble(data, event) {
    const agent = data.agents.find(item => item.id === event.agentId || item.profile === event.profile);
    if (!agent) return;
    const entry = { ...event, snippet: event.text, agentId: agent.id, agent_id: agent.id, createdAt: now(), expiresAt: now() + BUBBLE_MS };
    data.bubbles = { ...data.bubbles, [agent.id]: entry };
    data.events = data.events.filter(item => item.id !== entry.id).concat(entry).slice(-MAX_EVENTS);
    data.agents = data.agents.map(item => item.id === agent.id ? { ...item,
      currentActivity: [entry.label, entry.text].filter(Boolean).join(': '), currentActivityAt: entry.timestamp, lastActivity: entry.timestamp ?? item.lastActivity,
      tools: entry.toolName ? [...new Set(item.tools.concat(entry.toolName))].slice(-8) : item.tools,
    } : item);
  }
  function beginReturn(data, id) {
    data.agents = data.agents.map(agent => agent.id === id ? { ...agent, status: 'walking', visualState: 'walking',
      currentTask: null, progress: null, room: 'desk', targetPosition: [...agent.deskPosition], workflowActive: true } : agent);
  }
  function demoMeetingArrived() {
    if (mode !== 'demo' || demoScenario?.phase !== 'outbound') return;
    demoScenario.phase = 'meeting';
    dispatchEvent({ type: 'agent.status.changed', agentId: 'pms-bot', status: 'meeting', progress: 20, timestamp: now() / 1000 });
    later(700, () => dispatchEvent({ type: 'agent.tool.called', agentId: 'pms-bot', toolName: 'calendar', text: 'Menyiapkan agenda rapat', timestamp: now() / 1000 }));
    later(3000, () => dispatchEvent({ type: 'agent.status.changed', agentId: 'pms-bot', status: 'meeting', progress: 65, timestamp: now() / 1000 }));
    later(7000, () => { if (demoScenario) demoScenario.phase = 'celebrating'; dispatchEvent({ type: 'agent.task.completed', agentId: 'pms-bot', text: 'Team sync siap', progress: 100, completedToday: 1, timestamp: now() / 1000 }); });
  }
  function sweep() {
    const data = mode === 'demo' ? demo : live, time = now(), bubbles = { ...data.bubbles };
    for (const [key, celebration] of celebrations) if (celebration.mode === mode && time >= celebration.until) {
      celebrations.delete(key); beginReturn(data, celebration.id);
      if (mode === 'demo' && demoScenario?.phase === 'celebrating') {
        demoScenario.phase = 'returning';
      }
      publish();
    }
    const expired = new Map();
    for (const [id, value] of Object.entries(bubbles)) if (time >= value.expiresAt) { expired.set(id, value); delete bubbles[id]; }
    if (expired.size) { data.bubbles = bubbles; data.agents = data.agents.map(agent => {
      const old = expired.get(agent.id);
      return old && agent.currentActivity === [old.label, old.text].filter(Boolean).join(': ') ? { ...agent, currentActivity: null, currentActivityAt: null } : agent;
    }); publish(); }
    if (active()) tickTimer = setTimer(sweep, 1000); else tickTimer = null;
  }
  function startTick() { if (active() && tickTimer === null) tickTimer = setTimer(sweep, 1000); }
  async function request(path, token) {
    if (!fetcher) throw new Error('No fetch transport');
    const controller = new AbortController(); controllers.add(controller);
    const timeout = setTimer(() => controller.abort(), 15_000);
    try {
      const response = await fetcher(path, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Office source unavailable');
      const value = await response.json();
      if (controller.signal.aborted || token !== generation || !active() || mode !== 'live') return null;
      return value;
    } finally { clearTimer(timeout); controllers.delete(controller); }
  }
  async function tail(agent, session, signature, track, token) {
    track.pending = true; track.requestToken = token; track.lastAttempt = now();
    try {
      const query = new URLSearchParams({ profile: agent.profile, session_id: session.id, limit: '6', offset: '0', order: 'latest' });
      const payload = await request('/api/audit/messages?' + query, token);
      if (!payload || tracks.get(agent.profile) !== track || !live.agents.some(item => item.id === agent.id) ||
          live.source.stale || !live.source.sessions_available || live.source.sessions_stale || live.source.private_detail_requires_login) return;
      if (payload.available !== true || payload.profile !== agent.profile || payload.stale === true || payload.requires_login === true) { track.retryAt = now() + 15_000; return; }
      const events = activity.observe(agent.profile, payload, now(), session.id, track.initialized && track.sessionId !== session.id);
      track.initialized = true; track.sessionId = session.id; track.signature = signature; track.retryAt = 0;
      if (payload.cached === true && count(payload.session?.message_count) !== null && session.message_count !== null && payload.session.message_count < session.message_count) track.retryAt = now() + 11_000;
      events.forEach(event => bubble(live, { ...event, agentId: agent.id }));
      if (events.length) publish();
    } catch { if (token === generation) track.retryAt = now() + 15_000; }
    finally { if (track.requestToken === token) track.pending = false; }
  }
  function syncTails(token) {
    if (!live.source.connected || live.source.stale || !live.source.sessions_available || live.source.sessions_stale || live.source.private_detail_requires_login) return;
    const known = new Set(live.agents.map(agent => agent.profile));
    for (const profile of tracks.keys()) if (!known.has(profile)) tracks.delete(profile);
    for (const agent of live.agents.slice(0, 100)) {
      const own = live.sessions.filter(session => session.profile === agent.profile).sort((a, b) => (b.last_active ?? 0) - (a.last_active ?? 0));
      const session = own[0]; if (!session) continue;
      let track = tracks.get(agent.profile);
      if (!track) { track = { pending: false, lastAttempt: -Infinity, initialized: false, sessionId: '', signature: '', retryAt: 0 }; tracks.set(agent.profile, track); }
      const signature = JSON.stringify([session.id, session.message_count, session.tool_call_count, session.last_active]);
      if (track.pending || now() - track.lastAttempt < TAIL_MS || track.retryAt > now() || track.signature === signature && agent.status !== 'working' && !track.retryAt) continue;
      void tail(agent, session, signature, track, token);
    }
  }
  async function poll() {
    if (!active() || mode !== 'live' || pollingToken === generation) return;
    const token = generation;
    pollingToken = token;
    try {
      const payload = await request('/api/state', token); if (!payload) return;
      const next = normalizeLiveState(payload, live.agents);
      const ids = new Set(next.agents.map(agent => agent.id));
      const retainedEvents = live.events.filter(event => event.type !== 'activity' && ids.has(event.agentId));
      const retainedBubbles = Object.fromEntries(Object.entries(live.bubbles).filter(([id, entry]) => ids.has(id) && now() < entry.expiresAt));
      next.agents = next.agents.map(agent => retainedBubbles[agent.id] ? { ...agent,
        currentActivity: [retainedBubbles[agent.id].label, retainedBubbles[agent.id].text].filter(Boolean).join(': '), currentActivityAt: retainedBubbles[agent.id].timestamp } : agent);
      live = { ...next, events: next.events.concat(retainedEvents).slice(-MAX_EVENTS), bubbles: retainedBubbles };
      if (selectedAgentId && !ids.has(selectedAgentId)) selectedAgentId = next.agents[0]?.id || null;
      publish(); syncTails(token);
    } catch {
      if (token === generation && active() && mode === 'live') {
        live = { ...live, source: { ...live.source, connected: false, state: 'disconnected', stale: true, error: 'Status Hermes belum dapat diperbarui.' },
          agents: live.agents.map(agent => ({ ...agent, status: agent.workflowActive && socketConnected ? agent.status : 'unknown',
            visualState: agent.workflowActive && socketConnected ? agent.visualState : 'unknown', progress: agent.workflowActive && socketConnected ? agent.progress : null,
            detail: 'Menunggu status Hermes terbaru.' })) };
        publish();
      }
    } finally { if (pollingToken === token) pollingToken = null; if (token === generation && active() && mode === 'live') pollTimer = setTimer(poll, POLL_MS); }
  }
  function invalidateWorkflow() {
    for (const [key, value] of celebrations) if (value.mode === 'live') celebrations.delete(key);
    live.agents = live.agents.map(agent => agent.workflowActive ? { ...agent, workflowActive: false,
      status: agent.gatewayStatus || 'unknown', visualState: agent.gatewayStatus || 'unknown', progress: null, currentTask: null,
      room: 'desk', targetPosition: agent.gatewayStatus === 'working' ? [...agent.deskPosition] : null } : agent);
  }
  function scheduleReconnect(token) {
    if (!configuredSocket || !active() || mode !== 'live' || token !== generation || reconnectTimer !== null) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(socketAttempt++, 5));
    reconnectTimer = setTimer(() => { reconnectTimer = null; if (token === generation) openSocket(); }, delay);
  }
  function openSocket() {
    if (!configuredSocket || !active() || mode !== 'live' || socket) return;
    const token = generation;
    try {
      const connection = socketFactory(configuredSocket); socket = connection;
      connection.onopen = () => { if (socket === connection && token === generation) { socketConnected = true; socketAttempt = 0; publish(); } };
      connection.onmessage = message => { if (socket !== connection || token !== generation || !active() || mode !== 'live' || typeof message.data !== 'string' || message.data.length > 8192) return;
        try { dispatchEvent(JSON.parse(message.data)); } catch { /* Malformed events have no state effect. */ } };
      connection.onclose = connection.onerror = () => { if (socket === connection) {
        socket = null; socketConnected = false; invalidateWorkflow(); publish();
        try { connection.close(); } catch { /* A failed socket is already unusable. */ }
        scheduleReconnect(token);
      } };
    } catch { socket = null; socketConnected = false; invalidateWorkflow(); publish(); scheduleReconnect(token); }
  }
  function resume() { startTick(); if (active() && mode === 'live') { if (bridgeNeedsValidation) { bridgeNeedsValidation = false; invalidateWorkflow(); publish(); } void poll(); openSocket(); } }
  function visibilityChanged() {
    if (hidden()) { cancelLive(); if (tickTimer !== null) clearTimer(tickTimer); tickTimer = null; cancelDemo(); }
    else resume(); publish();
  }
  function dispatchEvent(value) {
    const raw = object(value), data = { ...object(raw.data), ...raw }, suppliedType = plain(data.type, 40), type = ALIASES[suppliedType] || suppliedType;
    if (!TYPES.has(type)) return false;
    const identifiers = [data.agentId, data.agent_id, data.profile].filter(item => item !== undefined);
    if (!identifiers.length || identifiers.some(id => !validId(id))) return false;
    const current = mode === 'demo' ? demo : live;
    const agent = current.agents.find(item => identifiers.every(id => id === item.id || id === item.profile)); if (!agent) return false;
    if (data.progress !== undefined && percent(data.progress) === null) return false;
    if (data.position !== undefined && !coords(data.position) || data.targetPosition !== undefined && !coords(data.targetPosition)) return false;
    const task = object(data.task), taskType = plain(data.taskType || task.type, 40), text = plain(data.text || data.content || object(data.message).content || task.title || data.title, 160);
    const event = { id: plain(data.id, 220) || type + ':' + agent.id + ':' + now() + ':' + hash(text), agentId: agent.id, agent_id: agent.id, profile: agent.profile,
      type, label: '', text, timestamp: stamp(data.timestamp ?? object(data.message).timestamp), synthetic: mode === 'demo',
      kind: type === 'agent.tool.called' ? 'tool' : type === 'agent.message.received' ? 'incoming' : 'activity', toolName: plain(data.toolName || data.tool_name || object(data.tool).name, 60) };
    let update = {};
    if (type === 'agent.status.changed') {
      if (!STATUS.has(data.status)) return false;
      const room = data.status === 'meeting' ? 'meeting' : data.status === 'resting' ? 'lounge' : agent.room;
      update = { status: data.status, visualState: data.status, workflowActive: !['idle', 'offline', 'unknown'].includes(data.status),
        progress: data.progress === undefined ? null : data.progress, room,
        targetPosition: data.targetPosition ? coords(data.targetPosition) : Object.hasOwn(ROOM_GOALS, room) ? [...ROOM_GOALS[room]] : agent.targetPosition };
      if (['idle', 'offline', 'unknown'].includes(data.status)) Object.assign(update, { room: 'desk', targetPosition: null, currentTask: null });
      event.label = 'Status ' + data.status;
      if (data.status === 'completed') celebrations.set(mode + ':' + agent.id, { mode, id: agent.id, until: now() + 2500 });
      else celebrations.delete(mode + ':' + agent.id);
    } else if (type === 'agent.task.started') {
      const room = Object.hasOwn(ROOM_GOALS, taskType) ? taskType : 'desk', targetPosition = room === 'desk' ? [...agent.deskPosition] : [...ROOM_GOALS[room]];
      update = { status: 'working', currentTask: text || 'Task dari sumber', progress: data.progress ?? null, room, targetPosition,
        visualState: room === 'desk' ? 'working' : 'walking', workflowActive: true }; event.label = 'Task dimulai';
      celebrations.delete(mode + ':' + agent.id);
    } else if (type === 'agent.task.completed') {
      update = { status: 'completed', currentTask: text || null, progress: data.progress ?? null,
        targetPosition: agent.targetPosition?.slice() || [...agent.position], visualState: 'completed', workflowActive: true,
        completedToday: count(data.completedToday), responseTime: typeof data.responseTime === 'number' && Number.isFinite(data.responseTime) && data.responseTime >= 0 ? data.responseTime : null };
      event.label = 'Task selesai';
      celebrations.set(mode + ':' + agent.id, { mode, id: agent.id, until: now() + 2500 });
    } else if (type === 'agent.moved') {
      if (!coords(data.position)) return false;
      update = { position: coords(data.position), ...(data.targetPosition ? { targetPosition: coords(data.targetPosition) } : {}) };
      if (update.position.every((v, index) => Math.abs(v - (update.targetPosition || agent.targetPosition || agent.deskPosition)[index]) < 0.1)) {
        update.visualState = agent.room === 'meeting' ? 'meeting' : agent.status === 'working' ? 'working' : agent.status === 'unknown' ? 'unknown' : 'idle';
        if (agent.room === 'desk' && ['idle', 'walking'].includes(agent.status) && !data.targetPosition) {
          Object.assign(update, { status: 'idle', workflowActive: false, visualState: 'idle', targetPosition: null });
        }
      }
      event.label = 'Berpindah';
    } else { event.label = type === 'agent.tool.called' ? event.toolName || 'Tool' : 'Pesan masuk'; }
    current.agents = current.agents.map(item => item.id === agent.id ? { ...item, ...update, lastActivity: event.timestamp ?? item.lastActivity } : item);
    if (type !== 'agent.moved') {
      if (['agent.message.received', 'agent.tool.called'].includes(type)) bubble(current, event);
      else current.events = current.events.concat(event).slice(-MAX_EVENTS);
    }
    publish();
    if (mode === 'demo' && type === 'agent.moved' && agent.id === 'pms-bot') {
      if (update.position.every((v, index) => Math.abs(v - ROOM_GOALS.meeting[index]) < 0.1)) demoMeetingArrived();
      else if (demoScenario?.phase === 'returning' && update.position.every((v, index) => Math.abs(v - agent.deskPosition[index]) < 0.1)) demoScenario.phase = 'done';
    }
    return true;
  }
  function later(delay, callback) {
    const timer = setTimer(() => { demoTimers.delete(timer); if (mode === 'demo') callback(); }, delay); demoTimers.add(timer);
  }
  function runDemo(scenario = 'meeting') {
    if (mode !== 'demo' || scenario !== 'meeting' || hidden()) return false;
    cancelDemo(); demo = freshDemo(); demoScenario = { phase: 'outbound' }; publish();
    const id = 'pms-bot';
    dispatchEvent({ type: 'agent.message.received', agentId: id, text: 'Schedule team sync', timestamp: now() / 1000 });
    later(700, () => dispatchEvent({ type: 'agent.task.started', agentId: id, taskType: 'meeting', text: 'Menyiapkan team sync', progress: 0, timestamp: now() / 1000 }));
    return true;
  }
  const store = {
    getSnapshot: () => snapshot, getServerSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    start() { if (started) return; started = true; visibility?.addEventListener?.('visibilitychange', visibilityChanged); resume(); },
    stop() { if (!started) { cancelDemo(); return; } started = false; cancelLive(); cancelDemo(); if (tickTimer !== null) clearTimer(tickTimer); tickTimer = null; visibility?.removeEventListener?.('visibilitychange', visibilityChanged); },
    select(id) { if (id !== null && !(mode === 'demo' ? demo : live).agents.some(agent => agent.id === id)) return false; selectedAgentId = id; publish(); return true; },
    setMode(next) { if (!['live', 'demo'].includes(next) || next === mode) return false; cancelLive(); cancelDemo(); mode = next; if (next === 'demo') demo = freshDemo(); const data = next === 'demo' ? demo : live; if (!data.agents.some(agent => agent.id === selectedAgentId)) selectedAgentId = data.agents[0]?.id || null; publish(); resume(); return true; },
    setWatching(value) { if (typeof value !== 'boolean' || value === watching) return; watching = value; if (!value) { cancelLive(); cancelDemo(); if (tickTimer !== null) clearTimer(tickTimer); tickTimer = null; } else resume(); publish(); },
    runDemo, dispatchEvent,
  };
  publish(); return Object.freeze(store);
}
