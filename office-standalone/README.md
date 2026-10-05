# Hermes Control Room

Local pixel dashboard for monitoring existing Hermes bots in one shared office. The backend reads gateway status; it does not execute agent tasks or call model providers.

Set `HERMES_URL` to the existing dashboard URL, then run `python app.py --port 9140`. `OFFICE_DATA_DIR` chooses the private runtime directory. See the root README for PowerShell examples.

Bot identities come from the source's actual profiles. Gateway status determines working/idle; recent sessions are not treated as proof of work. Ambiguous or unavailable runtime status remains unknown, and cached data is marked stale on failure.

The application uses Python's standard library and polls only while a viewer is active. The main status mode does not require a model key. Detailed sessions remain available in the original Hermes dashboard; the optional `/connect.html` form uses an existing Hermes dashboard account to read additional session metadata. Its password is discarded after an official login, and resulting cookies stay in the private runtime directory. The account's authenticated session carries its normal permissions, while this app uses a fixed set of read endpoints.

The default bind is loopback. Local development and design review happen before any later VPS deployment. Publishing the repository does not deploy it.

Sprites are reused from NosytLabs/agent-office. Attribution and license files are included in `web/assets`.
