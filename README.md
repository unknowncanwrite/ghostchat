# Ghost chat app

A responsive chat UI for Ghost. It defaults to the public demo stream and can use the authenticated Ghost API when a server-side API key is configured.

## Run

```bash
node server.mjs
```

Open `http://localhost:4173` (or set `PORT` to use another port). The same-origin `/api/chat` route streams responses to the browser.

## Demo mode

With no API key set, the app calls `https://ghost.thesapientcompany.com/v1/demo` using `ghostOnly: true`.

## Authenticated API mode

Create an API key in the Ghost console and store it **only on the server** (prefer a deployment secrets manager). Then set:

```bash
export GHOST_API_KEY='ak_…'
export GHOST_MODEL='ghost-x' # optional; default is ghost-x
node server.mjs
```

With `GHOST_API_KEY` configured, the top-bar switch lets you choose **HTTP demo** (`/v1/demo`) or **API** (`/v1/chat/completions`). API mode uses Bearer authentication and streams OpenAI-compatible Chat Completions; it defaults to API mode when a key is configured. The key is never sent to the browser, and the mode selection is saved in this browser. Optional: set `GHOST_API_BASE` to override the API origin.

The server uses Node's built-in `fetch`; no packages are required. Conversation history and the active thread are kept in this browser's local storage, so the latest active conversation reopens after a refresh. Follow-up turns in a thread are sent with earlier user and assistant messages.

**Deployment security:** this starter has no user authentication or distributed rate limiter. Do not enable production API-key mode on a public deployment until `/api/chat` is protected by your app's login/session layer and rate limits; otherwise other visitors could consume your API quota. Never commit a `.env` file or put the key in browser code.
