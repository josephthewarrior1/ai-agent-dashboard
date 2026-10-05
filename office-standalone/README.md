# Hermes HQ local server

Python's standard-library server connects an existing Hermes dashboard to the React/Three.js office. It uses fixed read endpoints to observe bots and does not execute agent tasks or call model providers.

Set `HERMES_URL` to an existing HTTPS dashboard and run `python app.py --port 9140`. `OFFICE_DATA_DIR` chooses the private runtime directory. See the [root README](../README.md) for PowerShell commands and the [frontend guide](frontend/README.md) for build/event details.

The default bind is loopback. Publishing GitHub source does not deploy Office. The earlier VPS installation has been removed.

Bot identities and statuses come from actual Hermes profiles and gateway metadata. An active gateway or a recent session is not treated as proof of current work. Missing task progress and metrics remain unknown. Decorative movement is separate from monitored status. Explicit simulation mode stays local and makes no upstream task calls.

The optional `/connect.html` form uses an existing Hermes dashboard account to read private sessions. Its password is discarded after an official login. Session cookies stay in the ignored runtime directory; this app uses a fixed set of read endpoints even though the authenticated account retains its normal permissions.

Chat requests require an explicit bot and prove session ownership before returning messages. Transcript content stays out of `/api/state`, disk snapshots, and Git. Cached history is scoped to the authenticated source. Tool metadata and absent timestamps are shown explicitly. This viewer cannot preserve sessions deleted at the source.

The React frontend is in `frontend/`. Its build is served from `web/3d`, with `web/index.html` as the main entry. The 3D scene uses local geometry and respects reduced motion. Historical pixel assets remain in `web/assets` with their original license notices.
