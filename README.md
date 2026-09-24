# WebMCP - Example Chrome Extension

An example AI agent built as a Chrome extension. It chats with you in the side
panel and gets things done on the current page by calling the page's WebMCP
tools. Use it to try WebMCP on your own site, or as a starting point for your
own agent.

> **Disclaimer**: This is not an officially supported Google product. This project is not eligible for the [Google Open Source Software Vulnerability Rewards Program](https://bughunters.google.com/open-source-security).

---

## What it does

- **Finds tools on the page.** Reads `document.modelContext.getTools()` and listens for `ontoolchange`, in the top page and in cross-origin iframes. Tools that appear during a conversation (for example after a navigation) are picked up before the next model turn.
- **Chats with a model that can call those tools.** The side panel sends your prompt to a model. When the model calls a tool, the side panel asks for permission if needed, runs the tool on the page and sends the result back.
- **Two model backends:**
  - **Local server** (default): a small Node.js server that talks to Google, OpenAI, Anthropic or Ollama through the [AI SDK](https://ai-sdk.dev). API keys stay on the server.
  - **On-device model**: runs in the browser through the [Prompt API](https://developer.mozilla.org/docs/Web/API/Prompt_API). No server and no API key, and page data stays on your device.
- **Streams replies** as they are written, on both backends.
- **One conversation per tab.** Each tab has its own chat and permission prompts. Switching tabs switches chats, and closing a tab ends its chat.
- **Log dashboard** for looking at every request the server handles. See [Log dashboard](#log-dashboard).

---

## Trust boundary

WebMCP tools come from web pages, and a web page is not trusted. But tools carry
**annotations**, hints the page gives about each tool, and this version of the
extension **trusts those hints** to decide how careful to be. That is on purpose:
it lets website developers see how an agent treats their tools differently
depending on the annotations they set.

| Annotation | What the extension does |
|---|---|
| `readOnlyHint: true` | The tool runs without asking. |
| `readOnlyHint` missing or `false` | The tool is treated as one that changes something. The user is asked first, with **Allow**, **Don't allow**, or **Allow on _site_ for this chat**. The prompt can be turned off in **Settings → Permissions → Sensitive action alerts**. |
| `consequentialHint: true` | The action may not be reversible (a payment, order, message or deletion). The user is **always** asked, even if alerts are off, even if the tool also says it is read-only, and there is no "allow for this chat" option. |
| `untrustedContentHint` missing or `true` | The tool's result is treated as untrusted page data. Before the model sees it, it is Base64-encoded (local server) or wrapped in a random marker (on-device model), and the model is told to use it only as facts, never as instructions. This is called *spotlighting*. |
| `untrustedContentHint: false` | The result is sent to the model as it is. |

Some rules apply to every tool, whatever its annotations:

- Tool results are cut at 8,000 characters (`MAX_TOOL_RESPONSE_CHARS`), with a warning added, so a page cannot flood the model's context.
- "Allow for this chat" is kept only until the chat is reset or the panel closes. It only applies to tools in the top frame, never to tools inside an iframe.

> [!IMPORTANT]
> These are *hints* from the page, not guarantees. A page can mark a harmful tool
> as read-only, or mark its own output as trusted. Spotlighting also lowers the
> risk of prompt injection but does not remove it, and how well it works depends
> on the model (Base64 was tested with Gemini; it is unproven with GPT and Claude).

**Building your own agent?** Trusting page hints is fine for a test tool like
this one, but a real agent needs a stronger trust boundary: for example, its own
checks on what a tool may do, or limits that do not depend on what the page
says. We would like to hear how you approach this. Please share your ideas and
feedback in [GitHub issues](https://github.com/GoogleChromeLabs/webmcp-extension/issues).

---

## Getting started

### Requirements

- Node.js 22 or newer
- Google Chrome 150 or newer, with the **WebMCP for testing** flag turned on in `chrome://flags`

### 1. Configure `.env`

Create a `.env` file in the project root:

```env
# At least one API key: the one for the provider you use.
GEMINI_API_KEY=your_gemini_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Which model the server uses, written as provider:model.
MODEL=google:gemini-3.6-flash

# Optional settings. Remove the leading "#" to use one.
# Comments must be on their own line, not after a value.

# Port of the model server.
# PORT=3000

# Auth token. Created and saved for you if left out.
# WEBMCP_AUTH_TOKEN=your_secure_auth_token_here

# Only accept requests from this extension ID.
# ALLOWED_EXTENSION_ID=your_extension_id

# Set to 1 to keep request/response bodies out of the log dashboard.
# WEBMCP_LOG_REDACT_BODIES=1
```

### 2. Install, start the server, and build

```bash
npm install
npm run server   # starts the model server on http://localhost:3000
npm run build    # in a second terminal; writes the extension to dist/
```

### 3. Load the extension

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick the `dist/` folder.

### Using the on-device model

Turn it on in **Settings → Model → On-device model**. Tool calling also needs
`chrome://flags/#prompt-api-tool-use`. The model downloads the first time, with
a progress bar in the side panel. Its context is small, so a meter in the chat
shows how full it is, and long chats are summarized to make room.

---

## Choosing a model

`MODEL` is written as `provider:model`:

```env
MODEL=google:gemini-3.6-flash
MODEL=openai:gpt-4o
MODEL=anthropic:claude-sonnet-4-5
MODEL=ollama:llama3.2
```

- A name without a prefix is read as a Google model, so `MODEL=gemini-3.6-flash` still works.
- A provider only works if its API key is set. If it is missing, the server says so when it starts. Ollama runs on your machine and needs no key.
- Restart the server after changing `MODEL`.
- The side panel only picks *on-device* or *server*. It never picks the server's model, so keys, cost and model choice stay on the server.

To send a provider to another address (a local runtime, a proxy, or a company gateway):

```env
OPENAI_BASE_URL=http://localhost:4000/v1
ANTHROPIC_BASE_URL=https://gateway.example.com/anthropic
GOOGLE_GENERATIVE_AI_BASE_URL=https://gateway.example.com/google
OLLAMA_HOST=http://127.0.0.1:11434/v1
```

The `openai` provider uses the chat completions API, which every
OpenAI-compatible server supports. So vLLM, LiteLLM or your own gateway works
through `openai` with `OPENAI_BASE_URL`.

---

## How the server is protected

- Every `/api/*` request must come from a `chrome-extension://` origin and carry the shared `WEBMCP_AUTH_TOKEN`. The token is compared in constant time, and a server with no token rejects every request.
- The token is built into `sidebar.js`. It keeps web pages and other local programs away from the server, but anyone with the built extension can read it, so treat it as an access key, not a secret.
- The server keeps chat history in memory (up to 100 chats). The side panel sends only the new prompt or tool results each turn.
- The server never runs tools itself. Each model turn stops at the tool call, and the side panel asks for permission and runs the tool on the page.

---

## Log dashboard

The server keeps the last 500 requests and shows them live. They include full
prompts, replies and page content, so the dashboard needs the auth token. The
server prints a ready-to-open link when it starts:

```
📊 Log dashboard: http://127.0.0.1:3000/logs?token=<WEBMCP_AUTH_TOKEN>
```

Opening it swaps the token for a 12-hour cookie and removes the token from the
address bar. Without the cookie or the token, the page, `?json=true` and the
`?stream=true` feed all return `401`.

Set `WEBMCP_LOG_REDACT_BODIES=1` to record only method, path, status and timing.

---

## Testing

```bash
npm test            # unit tests and extension smoke tests
npm run test:smoke  # only the smoke tests
npm run typecheck
```

The smoke tests load the built extension into headless Chrome and drive the side
panel against a local test page. They need Chrome 150 or newer. If none is found
they are skipped locally, but they fail in CI. To use a specific browser:

```bash
CHROME_BIN=$(npx @puppeteer/browsers install chrome@stable --format "{{path}}") npm run test:smoke
```

---

## Project structure

```
webmcp-extension/
├── .env               # API key, MODEL, WEBMCP_AUTH_TOKEN
├── scripts/           # Build scripts (bundle the side panel, inject the auth token)
├── server/            # Node.js model server
│   ├── server.js      # Chat API and log dashboard (port 3000)
│   ├── providers.js   # Reads MODEL and the provider keys
│   ├── tools.js       # Turns page tools into model tool declarations
│   ├── security.js    # Origin, CORS and token checks
│   └── logs.html      # Log dashboard page
├── extension/         # Manifest V3 files
│   ├── manifest.json
│   ├── sidebar.html   # Side panel page
│   ├── background.js  # Service worker: tab tracking, tool count badge
│   ├── content.js     # Talks to document.modelContext on the page
│   └── utils.js       # Navigation and iframe origin helpers
├── src/               # React side panel
│   ├── components/    # UI parts (chat bubbles, permission card, switches, ...)
│   ├── screens/       # Consent and settings screens
│   ├── services/      # Server, on-device model and extension bridges; permissions
│   ├── hooks/         # Active tab, its tools, and the agent loop
│   ├── App.tsx
│   └── index.tsx
└── tests/             # Unit tests, and smoke tests in tests/smoke/
```

---

## License

Apache License 2.0. See [LICENSE](LICENSE) for details.
