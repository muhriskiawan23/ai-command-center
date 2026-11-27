# BOR AI Voice development

The read-aloud button uses a device-provided local voice. The separate voice preview is hidden unless a trusted page setup supplies an SDP exchange adapter before app startup. The application worker retains its current media permissions. The browser check enables media permissions only in its own intercepted local responses.

The preview connects a WebRTC microphone and response audio stream, shows a temporary transcript, and copies the user transcript into the editable composer. Muting stops local playback. Ending or leaving a chat releases the media tracks. Camera and screen capture produce one still image on request and hand it to the existing attachment flow. Sending the composed message remains a separate user action.

`delegation.mjs` is a prototype for a trusted server-side adapter. It correlates transcript fragments with a delegation ID and returns a bounded answer with HTTPS source URLs. Its tests inject the search and transport functions. It needs an authenticated sideband connection, search quota enforcement and connection to the chosen BOR search provider before use with GPT-Live. The GPT-Live API does not inspect image or video streams. Continuous video analysis and automatic speech interruption still require end-to-end validation and integration.

`pilot.mjs` and the SQLite modules preserve the previous offline budget and recovery checkpoint. The browser preview does not invoke those modules or OpenAI. A paid integration needs credentials with existing access, durable tracking and final usage reconciliation, and an enforceable worst-case spend within US$0.50. A timed-out local request does not establish that provider billing ended.

Run the new mock checks with `node --test staging/bor-voice/tests/{delegation,live-client}.test.mjs`. For the local Chromium integration check, use `node staging/bor-voice/browser-check.mjs` with Playwright and Chromium installed. It uses a local BOR AI harness, a second WebRTC peer and synthetic media. Set `BOR_VOICE_CHROMIUM` to an alternate Chromium executable if needed.

The 27 November development check passed four new mock tests and the Chromium UI flow at desktop and emulated Pixel 7 viewport sizes. The headless environment initially stalled during ICE gathering, then passed with `BOR_VOICE_LOOPBACK=1` and a fresh Chromium process for each viewport. The native WebRTC check confirms inbound and outbound audio RTP packets on the local peer. `BOR_VOICE_MOCK_PEER=1` is available for a UI-only check. The display picker and incoming speech used fixtures, so results do not establish native screen sharing, physical Android/iOS support or OpenAI live audio.

## OpenAI transport

`openai-live.mjs` implements the authenticated WebRTC session creation request and trusted sideband for a Cloudflare Worker. It shares the WebRTC offer configuration with the offline pilot. Use the existing server-side key when that key has Live access. The transport issues one create request and returns the session identity to the caller for durable journaling before the SDP answer is exposed. Use the sideband to send `session.close` and record usage only after a matching provider terminal event. A disconnected sideband returns an unconfirmed result. The SIP hangup endpoint is not used for WebRTC.

The transport has no public route or deployment binding. The Worker still needs an authenticated session route, a durable budget guard and automatic closure, followed by a live staging test. Run the transport contract checks with `node --test staging/bor-voice/tests/openai-live.test.mjs`; the fixtures make no OpenAI requests.

## Isolated Worker pilot

The staging Worker uses a dedicated SQLite Durable Object and an operator bearer token. It has no production hostname, shared chat database, or backend tool calls. POST a WebRTC offer as `application/sdp` to `/api/voice/session` after provisioning an isolated staging origin. The browser receives the SDP answer only after the Worker has reserved the budget, recorded the provider session ID and attached the trusted sideband.

The checked-in configuration disables paid requests. Verify that the existing OpenAI key has GPT-Live access and that the provider independently limits every voice session to at most 585 seconds, including when the app cannot send a close request, before setting `BOR_VOICE_VERIFIED_PROVIDER_MAX_SECONDS` and enabling paid voice. The maximum leaves 15 seconds of headroom for initialization at US$0.05 per active minute. Never set the binding based on an app timer or on a project limit that only rejects subsequent requests. One attempt is reserved durably for this pilot. Timeouts, disconnects and unknown outcomes cannot open another paid session.

The app requests closure after 60 seconds by default. For a sustained conversation check, set `BOR_VOICE_PILOT_SECONDS` to 300 after the shorter run has been validated and a new attempt budget has been separately reserved. Five active minutes cost approximately US$0.25 at the published rate. This pilot keeps the same WebRTC connection and provider context while the user speaks and interrupts. A physical Android test is needed to verify extended dialogue, interruptions and resumption after network loss. The pilot does not yet restore context after a provider session ends.
