# Hermes HQ frontend

React + Vite, React Three Fiber/Three.js, drei, and Framer Motion. The office is a procedural 3D scene: no external models, fonts, or HDR downloads. Static architectural meshes are merged by material; animated characters and ambient details stay separate. The renderer caps device pixel ratio and reduces it when sustained frame rate is low. The target is smooth laptop rendering, not a guaranteed frame rate on every GPU.

## Build and development

Node 20.19+ or 22.12+ is supported.

```powershell
npm ci
npm run build
npm test
```

The build writes only `../web/3d/`, then copies its HTML entry to `../web/index.html`. Run the existing Python server on port 9140. The optional Vite dev server (`npm run dev`) runs at [http://127.0.0.1:9142/3d/](http://127.0.0.1:9142/3d/) and proxies local API/connect requests to that server.

## Modules

- `src/scene/`: geometry, room furnishings, rigged characters, path graph, orbit/focus camera and ambient animation.
- `src/state/office-state.js`: framework-independent event store, gateway normalization, scoped message activity, transport lifecycle and isolated demo.
- `src/state/office-store.js`: React `useSyncExternalStore` hook.
- `src/components/`: selected-agent panel, scoped chat viewer, tasks/logs and shared UI.

Live starts with actual Hermes profiles, not invented agents. Gateway states are `idle`, `working`, `offline`, or `unknown`; recent sessions and active gateways alone do not prove current work. Task progress, completed counts and response time remain unavailable until explicitly supplied. Message excerpts are `currentActivity`, separate from an actual `currentTask`.

Polling runs every five seconds while the page is visible. A changed session signature can trigger a six-row private message tail, at least ten seconds apart per bot. Its first page establishes a silent history baseline. Newly observed messages/tools produce bounded 15-second bubbles held only in memory. Chat reading proves bot/session ownership at the backend and clears responses on profile changes or login failure.

## Optional WebSocket bridge

The Python connector currently provides polling, **not a WebSocket endpoint**. To connect a future event bridge, place its read-only socket route on the same origin as Office and set `websocketUrl` in `public/config.js` before building. The built `web/3d/config.js` may also be edited locally. Default is `null`; no socket is opened.

```js
window.HERMES_OFFICE_CONFIG = {
  websocketUrl: 'ws://127.0.0.1:9140/events'
};
```

`/events` in this example must be supplied by your bridge; it is not implemented by the current Python server. An HTTPS Office origin requires WSS. Other origins, embedded credentials and fragments are rejected. Keep credentials out of source and URL query strings. Reuse the authenticated same-origin session when implementing the bridge.

Events are JSON objects with a canonical `type` and a known `agentId`. `agent_id` or `profile` can identify the same bot; conflicting identifiers are rejected.

| Type | Fields |
| --- | --- |
| `agent.status.changed` | `status`, optional `progress` |
| `agent.task.started` | `taskType`, `text`, optional `progress` |
| `agent.task.completed` | optional `text`, `progress`, `completedToday`, `responseTime` in milliseconds |
| `agent.message.received` | `text` |
| `agent.tool.called` | `toolName`, optional `text` |
| `agent.moved` | `position: [x, 0, z]`, optional `targetPosition: [x, 0, z]` |

Optional `timestamp` accepts epoch seconds, milliseconds, or ISO text. Missing timestamps remain unavailable. Progress is 0–100; coordinates stay inside the office floor. Unknown event types/bot IDs or invalid payloads have no state effect. Legacy `task.started`, `task.completed`, `message.received`, and `tool.called` are normalized to their `agent.*` equivalents.

```json
{"type":"agent.task.started","agentId":"pms-bot","taskType":"meeting","text":"Preparing team sync","progress":0}
```

A meeting event routes the character to the meeting chair. Arrival is reported by the scene only for explicit targets; decorative idle wandering never becomes a verified live status. Completion produces a brief celebration and a return route. WebSocket workflow states remain separate from gateway status metadata.

## Simulation and controls

**Simulasi → Coba alur meeting** drives a local pms-bot workflow through walking, meeting, completion and desk return. Changing back to live cancels its timers and restores monitored state. It does not make model calls, send messages or execute server tasks.

Camera rotation/panning/zoom/reset and top-down 2D remain available. The animation pause button only affects office motion. System reduced-motion preferences are respected. Pause/restart **agent** controls are disabled because the connector has no agent mutation capability; use the actual Hermes dashboard to manage bots.

The floating panel and transcript viewer render text safely, without HTML or attachment auto-loading. A scoped transcript is source history, not an immutable archive. Source-deleted sessions cannot be recovered by this UI.
