import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfficeStore, createActivityTracker, normalizeLiveState, websocketURL, ROOM_GOALS } from '../src/state/office-state.js';

const BASE_TIME = 1_800_000_000_000;
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
class Timers {
  time = BASE_TIME; next = 1; timers = new Map();
  now = () => this.time;
  set = (callback, delay) => { const id = this.next++; this.timers.set(id, { callback, due: this.time + delay }); return id; };
  clear = id => this.timers.delete(id);
  async advance(milliseconds) {
    const target = this.time + milliseconds;
    for (let safety = 0; safety < 1000; safety++) {
      const entry = [...this.timers].filter(([, value]) => value.due <= target).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!entry) { this.time = target; await flush(); return; }
      this.time = entry[1].due; this.timers.delete(entry[0]); await entry[1].callback(); await flush();
    }
    throw new Error('Timer did not settle');
  }
}
class Visibility {
  hidden = false; listeners = new Set();
  addEventListener(type, fn) { if (type === 'visibilitychange') this.listeners.add(fn); }
  removeEventListener(type, fn) { this.listeners.delete(fn); }
  change(hidden) { this.hidden = hidden; for (const fn of this.listeners) fn(); }
}
function payload({ status = 'idle', privateMode = false, messages = 1 } = {}) {
  return {
    agents: [{ id: 'pms-bot', profile: 'pms-bot', label: 'PMS', status, detail: 'Verified gateway', last_active: BASE_TIME / 1000,
      completedToday: 999, progress: 87, responseTime: 2, system_prompt: 'not-a-state-field' }],
    source: { connected: true, stale: false, mode: privateMode ? 'full' : 'status_only', sessions_available: privateMode,
      sessions_stale: !privateMode, private_detail_requires_login: !privateMode, last_sync: BASE_TIME / 1000, api_key: 'not-a-state-field' },
    sessions: privateMode ? [{ id: 'chat-1', profile: 'pms-bot', message_count: messages, tool_call_count: 0, last_active: BASE_TIME / 1000 }] : [], events: [],
  };
}
function page(rows, profile = 'pms-bot', session = 'chat-1') {
  return { available: true, stale: false, requires_login: false, profile, requested_session_id: session, session_id: session,
    session: { id: session, profile, message_count: rows.length }, messages: rows,
    pagination: { offset: 0, order: 'latest', returned: rows.length, limit: 6 } };
}
function harness(handler, extra = {}) {
  const timers = new Timers(), document = new Visibility(), calls = [];
  const store = createOfficeStore({ now: timers.now, setTimeout: timers.set, clearTimeout: timers.clear, document,
    location: 'http://127.0.0.1:9140/', fetch: async (path, options) => {
      calls.push({ path, options }); const data = await handler(path, options, timers);
      return { ok: true, json: async () => structuredClone(data) };
    }, ...extra });
  return { store, timers, document, calls };
}

test('normalization keeps actual statuses and null unavailable statistics, no raw config', () => {
  const result = normalizeLiveState(payload({ status: 'working' }));
  const agent = result.agents[0];
  assert.equal(agent.status, 'working'); assert.equal(agent.visualState, 'working');
  assert.equal(agent.progress, null); assert.equal(agent.completedToday, null); assert.equal(agent.responseTime, null);
  assert.equal(agent.category, 'operations'); assert.equal(agent.role, 'Project, meetings & reminders');
  assert.deepEqual(agent.position, [-4, 0, -1.8]);
  assert.equal(JSON.stringify(result).includes('not-a-state-field'), false);
  const unknown = normalizeLiveState(payload({ status: 'pretend-finished' })).agents[0];
  assert.equal(unknown.status, 'unknown'); assert.equal(unknown.visualState, 'unknown');
});

test('snapshot is stable between actual updates and nested state cannot be mutated', async () => {
  const { store } = harness(() => payload());
  assert.strictEqual(store.getSnapshot(), store.getSnapshot());
  store.start(); await flush();
  const snapshot = store.getSnapshot(); assert.strictEqual(snapshot, store.getSnapshot());
  assert.ok(Object.isFrozen(snapshot.agents[0]));
  assert.throws(() => { snapshot.agents[0].name = 'mutated'; }, TypeError);
  assert.equal(store.select('unknown'), false); assert.strictEqual(snapshot, store.getSnapshot());
  assert.equal(store.select('pms-bot'), true); assert.equal(store.getSnapshot().selectedAgentId, 'pms-bot'); store.stop();
});

test('live polling is read-only, five seconds, idempotent and public mode has no transcript reads', async () => {
  const { store, timers, calls } = harness(() => payload());
  store.start(); store.start(); await flush(); assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/state'); assert.equal(calls[0].options.credentials, 'same-origin');
  await timers.advance(4999); assert.equal(calls.length, 1);
  await timers.advance(1); assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.path === '/api/state' && !call.options.method));
  assert.equal(store.getSnapshot().capabilities.privateActivity, false); store.stop();
  await timers.advance(20_000); assert.equal(calls.length, 2);
});

test('hidden or explicitly paused store aborts and resumes only one poll', async () => {
  const { store, document, timers, calls } = harness(() => payload());
  document.hidden = true; store.start(); await flush(); assert.equal(calls.length, 0);
  document.change(false); await flush(); assert.equal(calls.length, 1);
  document.change(true); await timers.advance(20_000); assert.equal(calls.length, 1);
  document.change(false); await flush(); assert.equal(calls.length, 2);
  store.setWatching(false); await timers.advance(20_000); assert.equal(calls.length, 2);
  store.setWatching(true); await flush(); assert.equal(calls.length, 3); store.stop();
  assert.equal(document.listeners.size, 0);
});

test('stopped and late responses cannot alter live state or escape into demo', async () => {
  let resolve;
  const { store, calls } = harness(() => new Promise(done => { resolve = done; }));
  store.start(); await flush(); store.setMode('demo');
  assert.equal(calls[0].options.signal.aborted, true);
  resolve(payload({ status: 'working' })); await flush();
  assert.equal(store.getSnapshot().mode, 'demo'); assert.equal(store.getSnapshot().agents.length, 5);
  assert.ok(store.getSnapshot().agents.every(agent => agent.status === 'idle'));
  store.stop();
});

test('private activity uses six scoped tail rows, silent baseline, signatures and minimum ten seconds', async () => {
  let state = payload({ privateMode: true }), rows = [{ id: '1', role: 'user', content: 'Historical message', timestamp: BASE_TIME / 1000 }];
  const { store, timers, calls } = harness(path => path === '/api/state' ? state : page(rows));
  store.start(); await flush();
  const tails = () => calls.filter(call => call.path.startsWith('/api/audit/'));
  assert.equal(tails().length, 1); assert.deepEqual(store.getSnapshot().bubbles, {});
  const query = new URL(tails()[0].path, 'http://localhost').searchParams;
  assert.equal(query.get('profile'), 'pms-bot'); assert.equal(query.get('session_id'), 'chat-1'); assert.equal(query.get('limit'), '6');
  rows = rows.concat({ id: '2', role: 'user', content: 'Schedule team sync', timestamp: BASE_TIME / 1000 + 10 });
  state = payload({ privateMode: true, messages: 2 });
  await timers.advance(5000); assert.equal(tails().length, 1);
  await timers.advance(5000); assert.equal(tails().length, 2);
  assert.equal(store.getSnapshot().bubbles['pms-bot'].text, 'Schedule team sync');
  assert.equal(store.getSnapshot().agents[0].status, 'idle', 'Message does not invent working status');
  await timers.advance(10_000); assert.equal(tails().length, 2, 'Unchanged idle session does not reread');
  await timers.advance(5000); assert.deepEqual(store.getSnapshot().bubbles, {}); store.stop();
});

test('private stale or wrong-profile pages cannot generate arrivals or extra private reads', async () => {
  let state = payload({ privateMode: true });
  const { store, timers, calls } = harness(path => path === '/api/state' ? state : page([{ id: '1', role: 'user', content: 'Wrong-owner text' }], 'other'));
  store.start(); await flush(); assert.deepEqual(store.getSnapshot().bubbles, {});
  state = payload(); await timers.advance(20_000);
  assert.equal(calls.filter(call => call.path.startsWith('/api/audit/')).length, 1);
  assert.equal(JSON.stringify(store.getSnapshot()).includes('Wrong-owner text'), false); store.stop();
});

test('activity baseline handles duplicate IDs, numeric regression, old pages, ownership and bounded snippets', () => {
  const activity = createActivityTracker(), first = page([{ id: '10', role: 'assistant', content: 'old' }]);
  assert.deepEqual(activity.observe('pms-bot', first, BASE_TIME, 'chat-1'), []);
  const next = page([{ id: '9', role: 'user', content: 'older' }, { id: '10', role: 'assistant', content: 'old' },
    { id: '11', role: 'assistant', content: '<img onerror=alert(1)>' + 'x'.repeat(1000), tool_calls: [{ name: 'calendar' }] },
    { id: '12', role: 'tool', tool_name: 'calendar', content: '<untrusted_tool_result>raw diagnostic output</untrusted_tool_result>' },
    { id: '13', role: 'user', content: '<img onerror=alert(1)>' + 'x'.repeat(1000) }]);
  const result = activity.observe('pms-bot', next, BASE_TIME + 1000, 'chat-1');
  assert.equal(result.length, 3); assert.equal(result[0].type, 'agent.tool.called'); assert.equal(result[0].toolName, 'calendar');
  assert.equal(result[0].text, 'Tool sedang digunakan'); assert.equal(result[1].text, 'Hasil tool diterima');
  assert.ok(result[2].text.length <= 100); assert.ok(result[2].text.startsWith('<img'));
  assert.deepEqual(activity.observe('pms-bot', next, BASE_TIME + 2000, 'chat-1'), []);
  assert.deepEqual(activity.observe('pms-bot', { ...next, profile: 'other' }, BASE_TIME + 2000, 'chat-1'), []);
  assert.deepEqual(activity.observe('pms-bot', { ...next, pagination: { offset: 6, order: 'latest' } }, BASE_TIME + 2000, 'chat-1'), []);
  assert.deepEqual(activity.observe('pms-bot', next, BASE_TIME + 2000, 'different-session'), []);
});

test('WebSocket configuration accepts only same-origin safe ws/wss and defaults to none', () => {
  for (const [value, pageURL] of [['wss://external.test/feed', 'https://local.test'], ['ws://local.test/feed', 'https://local.test'],
    ['wss://user:password@local.test/feed', 'https://local.test'], ['https://local.test/feed', 'https://local.test'],
    ['ws://local.test:99/feed', 'http://local.test'], ['wss://local.test/feed#private', 'https://local.test']]) {
    assert.equal(websocketURL(value, pageURL), null);
  }
  assert.equal(websocketURL(null, 'http://local.test'), null);
  assert.equal(websocketURL('wss://local.test/feed', 'https://local.test/office'), 'wss://local.test/feed');
  assert.equal(websocketURL('ws://127.0.0.1:9140/feed', 'http://127.0.0.1:9140/'), 'ws://127.0.0.1:9140/feed');
});

test('strict event types, identities, bounds and source timestamps prevent forged state', async () => {
  const { store } = harness(() => payload()); store.start(); await flush();
  const before = store.getSnapshot();
  for (const event of [{ type: 'agent.delete', agentId: 'pms-bot' }, { type: 'task.started', agentId: 'other' },
    { type: 'task.started', agentId: 'pms-bot', profile: 'other' }, { type: 'task.started', agentId: 'pms-bot', progress: 101 },
    { type: 'agent.moved', agentId: 'pms-bot', position: [12, 0, 0] }, { type: 'agent.moved', agentId: 'pms-bot', position: [0, 2, 0] },
    { type: 'agent.status.changed', agentId: 'pms-bot', status: 'fake-complete' }]) assert.equal(store.dispatchEvent(event), false);
  assert.strictEqual(store.getSnapshot(), before);
  assert.equal(store.dispatchEvent({ type: 'message.received', agentId: 'pms-bot', text: 'x'.repeat(1000) }), true);
  const bubble = store.getSnapshot().bubbles['pms-bot']; assert.ok(bubble.text.length <= 160); assert.equal(bubble.timestamp, null);
  assert.equal(store.getSnapshot().agents[0].progress, null); store.stop();
});

test('verified task lifecycle routes meeting then desk without invented live counts or progress', async () => {
  const { store, timers } = harness(() => payload({ status: 'working' })); store.start(); await flush();
  store.dispatchEvent({ type: 'agent.task.started', agentId: 'pms-bot', task: { type: 'meeting', title: 'Actual team sync' } });
  let agent = store.getSnapshot().agents[0]; assert.equal(agent.room, 'meeting'); assert.equal(agent.visualState, 'walking');
  assert.deepEqual(agent.targetPosition, ROOM_GOALS.meeting); assert.equal(agent.progress, null);
  await timers.advance(5000); assert.equal(store.getSnapshot().agents[0].currentTask, 'Actual team sync');
  store.dispatchEvent({ type: 'agent.moved', agentId: 'pms-bot', position: ROOM_GOALS.meeting });
  store.dispatchEvent({ type: 'agent.task.completed', agentId: 'pms-bot' }); agent = store.getSnapshot().agents[0];
  assert.equal(agent.status, 'completed'); assert.equal(agent.visualState, 'completed');
  await timers.advance(3000); agent = store.getSnapshot().agents[0];
  assert.equal(agent.status, 'walking'); assert.equal(agent.room, 'desk'); assert.equal(agent.visualState, 'walking');
  assert.deepEqual(agent.targetPosition, agent.deskPosition); assert.equal(agent.completedToday, null); assert.equal(agent.responseTime, null); store.stop();
});

test('demo meeting walks, works, completes, returns; no upstream/model calls and mode change cancels timers', async () => {
  const { store, timers, calls } = harness(() => { throw new Error('Demo must not fetch'); });
  assert.equal(store.runDemo('meeting'), false); store.setMode('demo'); store.start();
  assert.equal(store.getSnapshot().agents.length, 5); assert.equal(store.runDemo('meeting'), true);
  await timers.advance(700); let agent = store.getSnapshot().agents.find(item => item.id === 'pms-bot');
  assert.equal(agent.room, 'meeting'); assert.equal(agent.visualState, 'walking'); assert.equal(agent.progress, 0);
  await timers.advance(9000); agent = store.getSnapshot().agents.find(item => item.id === 'pms-bot'); assert.equal(agent.visualState, 'walking', 'Work waits for physical scene arrival');
  store.dispatchEvent({ type: 'agent.moved', agentId: 'pms-bot', position: ROOM_GOALS.meeting });
  assert.equal(store.getSnapshot().agents.find(item => item.id === 'pms-bot').status, 'meeting');
  await timers.advance(7000); agent = store.getSnapshot().agents.find(item => item.id === 'pms-bot'); assert.equal(agent.status, 'completed'); assert.equal(agent.progress, 100);
  await timers.advance(3500); agent = store.getSnapshot().agents.find(item => item.id === 'pms-bot'); assert.equal(agent.visualState, 'walking');
  store.dispatchEvent({ type: 'agent.moved', agentId: 'pms-bot', position: agent.deskPosition });
  agent = store.getSnapshot().agents.find(item => item.id === 'pms-bot'); assert.deepEqual(agent.position, agent.deskPosition); assert.equal(agent.targetPosition, null);
  assert.equal(calls.length, 0); assert.ok(store.getSnapshot().events.every(event => event.synthetic));
  store.stop(); store.setMode('live'); const events = store.getSnapshot().events; await timers.advance(20_000); assert.deepEqual(store.getSnapshot().events, events); assert.equal(calls.length, 0);
});

test('leaving demo restores real state and cancels a scenario in progress', async () => {
  const { store, timers, calls } = harness(() => payload({ status: 'offline' })); store.start(); await flush();
  const real = store.getSnapshot().agents; store.setMode('demo'); store.runDemo('meeting'); await timers.advance(700);
  store.stop(); store.setMode('live'); assert.deepEqual(store.getSnapshot().agents, real);
  await timers.advance(20_000); assert.deepEqual(store.getSnapshot().agents, real); assert.equal(calls.length, 1);
});

test('optional socket messages stop after teardown and malformed messages never mutate state', async () => {
  let socket;
  const { store } = harness(() => payload(), { websocketUrl: 'ws://127.0.0.1:9140/feed', webSocketFactory: () => (socket = { close() { this.closed = true; } }) });
  store.start(); await flush(); socket.onopen(); assert.equal(store.getSnapshot().capabilities.websocket, true);
  socket.onmessage({ data: JSON.stringify({ type: 'agent.status.changed', agentId: 'pms-bot', status: 'working' }) });
  assert.equal(store.getSnapshot().agents[0].status, 'working'); const before = store.getSnapshot();
  socket.onmessage({ data: '{broken' }); socket.onmessage({ data: 'x'.repeat(8193) }); assert.strictEqual(store.getSnapshot(), before);
  store.stop(); socket.onmessage({ data: JSON.stringify({ type: 'agent.status.changed', agentId: 'pms-bot', status: 'offline' }) });
  assert.equal(store.getSnapshot().agents[0].status, 'working'); assert.equal(socket.closed, true);
});

test('canonical rich WS workflows survive polling while gateway status remains separately truthful', async () => {
  const { store, timers } = harness(() => payload({ status: 'idle' })); store.start(); await flush();
  for (const status of ['thinking', 'walking', 'meeting', 'resting', 'error']) {
    assert.equal(store.dispatchEvent({ type: 'agent.status.changed', agentId: 'pms-bot', status }), true);
    await timers.advance(5000);
    const agent = store.getSnapshot().agents[0]; assert.equal(agent.status, status); assert.equal(agent.visualState, status);
    assert.equal(agent.gatewayStatus, 'idle'); assert.equal(agent.progress, null);
  }
  store.dispatchEvent({ type: 'agent.status.changed', agentId: 'pms-bot', status: 'idle' });
  assert.equal(store.getSnapshot().agents[0].workflowActive, false); store.stop();
});

test('real task text remains distinct from new message/tool activity and private snippets expire', async () => {
  const { store, timers } = harness(() => payload({ status: 'working' })); store.start(); await flush();
  store.dispatchEvent({ type: 'agent.task.started', agentId: 'pms-bot', text: 'Verified actual task' });
  store.dispatchEvent({ type: 'agent.message.received', agentId: 'pms-bot', text: 'Customer asks a follow-up' });
  store.dispatchEvent({ type: 'agent.tool.called', agentId: 'pms-bot', toolName: 'calendar', text: 'Read real calendar' });
  let agent = store.getSnapshot().agents[0]; assert.equal(agent.currentTask, 'Verified actual task');
  assert.equal(agent.currentActivity, 'calendar: Read real calendar'); assert.deepEqual(agent.tools, ['calendar']);
  await timers.advance(15_000); agent = store.getSnapshot().agents[0]; assert.equal(agent.currentTask, 'Verified actual task'); assert.equal(agent.currentActivity, null); store.stop();
});

test('recent conversation metadata is limited to own profile and never includes message bodies or raw config', () => {
  const state = payload({ privateMode: true });
  state.sessions = [1, 2, 3, 4].map(id => ({ id: 'chat-' + id, profile: 'pms-bot', title: 'Own title ' + id, source: 'telegram',
    last_active: BASE_TIME / 1000 + id, message_count: id, content: 'never-copy-private-body', preview: 'never-copy-private-body' }));
  state.sessions.push({ id: 'other-chat', profile: 'other', title: 'Other profile title', last_active: BASE_TIME / 1000 + 100 });
  state.source.requires_login = true; state.source.state = 'needs_login';
  const normalized = normalizeLiveState(state), recent = normalized.agents[0].recentConversations;
  assert.deepEqual(recent.map(session => session.id), ['chat-4', 'chat-3', 'chat-2']);
  assert.equal(normalized.source.requires_login, true); assert.equal(normalized.source.state, 'needs_login');
  assert.equal(JSON.stringify(normalized).includes('never-copy-private-body'), false);
  assert.equal(JSON.stringify(normalized).includes('Other profile title'), false);
});

test('WebSocket disconnect invalidates task detail, cancels celebration, retries with backoff and pauses hidden', async () => {
  const sockets = [];
  const { store, timers, document } = harness(() => payload(), { websocketUrl: 'ws://127.0.0.1:9140/feed', webSocketFactory: () => {
    const socket = { close() { this.closed = true; } }; sockets.push(socket); return socket;
  } });
  store.start(); await flush(); sockets[0].onopen();
  store.dispatchEvent({ type: 'agent.task.started', agentId: 'pms-bot', text: 'Verified bridge task', progress: 45 });
  store.dispatchEvent({ type: 'agent.task.completed', agentId: 'pms-bot', progress: 100 });
  sockets[0].onclose();
  let agent = store.getSnapshot().agents[0]; assert.equal(agent.status, 'idle'); assert.equal(agent.currentTask, null); assert.equal(agent.progress, null);
  assert.equal(agent.workflowActive, false); assert.equal(store.getSnapshot().capabilities.websocket, false);
  await timers.advance(999); assert.equal(sockets.length, 1); await timers.advance(1); assert.equal(sockets.length, 2);
  sockets[1].onerror(); await timers.advance(1999); assert.equal(sockets.length, 2); await timers.advance(1); assert.equal(sockets.length, 3);
  assert.equal(store.getSnapshot().agents[0].status, 'idle', 'Disconnected celebration cannot overwrite truthful polling');
  document.change(true); await timers.advance(30_000); assert.equal(sockets.length, 3);
  document.change(false); await flush(); assert.equal(sockets.length, 4); sockets[3].onopen();
  store.dispatchEvent({ type: 'agent.status.changed', agentId: 'pms-bot', status: 'thinking' });
  document.change(true); assert.equal(store.getSnapshot().agents[0].status, 'thinking', 'Intentional pause retains last event as paused data');
  document.change(false); await flush(); assert.equal(store.getSnapshot().agents[0].status, 'idle', 'New bridge must revalidate old task context');
  store.stop(); const total = sockets.length; await timers.advance(30_000); assert.equal(sockets.length, total);
});

test('a newer authoritative workflow status cancels an older completion celebration', async () => {
  const { store, timers } = harness(() => payload()); store.start(); await flush();
  store.dispatchEvent({ type: 'agent.task.completed', agentId: 'pms-bot' });
  store.dispatchEvent({ type: 'agent.status.changed', agentId: 'pms-bot', status: 'thinking' });
  await timers.advance(5000); assert.equal(store.getSnapshot().agents[0].status, 'thinking');
  assert.equal(store.getSnapshot().agents[0].gatewayStatus, 'idle'); store.stop();
});
