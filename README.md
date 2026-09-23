# WebMCP - Example Chrome Extension

A Google Chrome extension for inspecting, executing, and testing WebMCP tools.

> **Disclaimer**: This is not an officially supported Google product. This project is not eligible for the [Google Open Source Software Vulnerability Rewards Program](https://bughunters.google.com/open-source-security).

---

## Features

- **Dynamic WebMCP Tool Discovery**: Automatically queries `document.modelContext.getTools()` and listens for `ontoolchange` across top-level pages and cross-origin `iframe` frames.
- **Backend Model Routing & Secure Key Storage**: Routes model requests to a local Node.js backend server so consumer-facing extension code never accesses or exposes API keys.
- **Origin & Auth Token Verification**: Backend `/api/*` endpoints require a `chrome-extension://` origin and a shared `WEBMCP_AUTH_TOKEN` (generated on first run, injected at build time). Comparison is constant-time, and a server with no token configured rejects everything rather than failing open. The token is inlined into the built `sidebar.js`, so treat it as an access key for the local port — it keeps web pages and other local processes out, but it is not a secret from anyone holding the build.
- **Multiple Model Providers**: The backend server answers with Google, OpenAI, Anthropic or Ollama, through the [AI SDK](https://ai-sdk.dev). Which one is set in `.env` as `MODEL=provider:model`, and only there — the side panel chooses whether a turn runs on-device or on the server, never which model the server uses, so keys and cost stay on the server side. The server holds conversation history in memory keyed by `chatId` (up to `MAX_CHAT_SESSIONS`), while the side panel sends only the current turn's prompt or tool responses. The tool loop deliberately does not run in the SDK either: tools belong to the page, so every turn stops at the model's tool call, which goes back to the side panel to be permitted and executed there.
- **Streaming Replies**: Replies appear in the side panel as they are written, on both backends. `/api/chat` streams newline-delimited JSON (`application/x-ndjson`) over `streamText`, delivering progressive text updates and final tool calls as they arrive.
- **On-Device Model (Prompt API)**: Optional backend that runs the model in the browser through the [Prompt API](https://developer.mozilla.org/docs/Web/API/Prompt_API), so prompts and page data never leave the device and no API key or server is needed. Sessions are created with [`EasyLanguageModel`](https://www.npmjs.com/package/easy-language-model), which shows the model download with a progress bar, asks for a click when the download needs a user gesture, and compacts the conversation with the Summarizer API when it overflows the context (the side panel says so, since the next message waits for it). Turning the on-device model on starts a download it still needs right away, sessions are made for the first of the browser's preferred languages the model supports, plus English, and a meter in the chat shows how much of the model's small context the conversation takes up. Tools are declared per session, so the session is rebuilt whenever the page registers different ones, carrying the conversation over, tool results included. That includes the middle of a turn: when a tool call navigates to a page with other tools, the turn goes on in a new session with those tools. Every tool call is handed back to the agent loop, so the same permission prompts, spotlighting, and limits apply. Enable it under **Settings → Model → On-device model** (requires `chrome://flags/#prompt-api-tool-use` for tool calling).
- **Base64 Spotlighting & Untrusted Content Defense**: Classifies tools via `untrustedContentHint` (defaulting to untrusted for arbitrary web content) and encodes untrusted tool execution results in Base64. This is an experimental *spotlighting* mitigation that makes the model less likely to treat page data as instructions; it reduces risk but is not a complete defense against indirect prompt injection. Backend system instructions additionally direct the model to decode tool output strictly for facts/context and never execute instructions found in page data. Note that how well a model handles this is a property of that model: Base64 was validated against Gemini and is unproven on GPT and Claude, and the on-device model cannot read it at all, so that backend fences untrusted output with a random per-conversation marker instead.
- **Inbound Token & Payload Size Limits**: Enforces an 8,000-character ceiling (`MAX_TOOL_RESPONSE_CHARS`) on string and JSON tool responses from web pages, automatically truncating oversized payloads and appending a `WEBMCP_SECURITY_WARNING` notice to protect against context window exhaustion and prompt expansion attacks.
- **Sensitive Action Permissions**: Prompts user confirmation before executing mutating/non-readonly tools (based on `readOnlyHint`), configurable via the Sensitive Action Alerts toggle in Settings.
- **Per-Tab Conversations**: The side panel belongs to a window rather than to a page, so it follows the tab in front: each tab keeps its own chat, its own composer, its own progress and its own permission prompt, and switching tabs switches between them. A prompt raised by one page therefore never appears over another, and a turn already running carries on in the background against the tab that started it — including the tools it declares and the tab its tool calls reach. Closing a tab stops its turn and ends its conversation. The on-device model is the one exception to running turns side by side: the browser holds a single session, so a second tab is asked to wait rather than have both conversations clash.
- **In-Flight Tool Re-discovery**: Mid-run tool listing updates ensure newly revealed form tools (e.g. search filters) are immediately made available to the model within multi-turn runs.
- **Authenticated Debug Server Call Inspector**: A live dashboard for inspecting streaming request/response payloads, latency, and status codes. Access requires the server auth token — open the `/logs?token=...` URL printed in the server console on startup. See [Log dashboard](#log-dashboard).

---

## Getting Started

### Prerequisites

- Node.js `v20.0.0+`
- Google Chrome with the `WebMCP for testing` flag enabled (`chrome://flags`).

### Environment Configuration (`.env`)

Create a `.env` file at the **root directory** of the project (`webmcp-dev-extension/.env`):

```env
# Model API key. At least one is required; set the one for the provider you
# want to use.
GEMINI_API_KEY=your_gemini_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Security: Auth Token (Auto-generated and persisted automatically if omitted)
WEBMCP_AUTH_TOKEN=your_secure_auth_token_here

# Security: Extension Restriction (Optional: set manually to restrict access to a specific extension ID)
ALLOWED_EXTENSION_ID=optional_specific_extension_id_to_restrict

# Optional Server Settings
PORT=3000
MODEL=google:gemini-3.6-flash

# Optional: keep request/response bodies out of the log dashboard entirely.
# Useful when screen-sharing or recording demos.
WEBMCP_LOG_REDACT_BODIES=0
```

### Choosing a provider and model

`MODEL` is written as `provider:model`. The providers are `google`, `openai`,
`anthropic` and `ollama`:

```env
MODEL=google:gemini-3.6-flash
MODEL=openai:gpt-4o
MODEL=anthropic:claude-sonnet-4-5
MODEL=ollama:llama3.2
```

A bare model name with no prefix is read as Google's, so an existing
`MODEL=gemini-3.6-flash` keeps working. Restart the server after changing it.

Only providers whose key is set are available. If `MODEL` asks for one without
a key, the server says so on startup instead of failing later with a 401 in the
middle of a conversation. `ollama` is the exception: it runs on your own
machine and needs no key, so it is available whenever `MODEL` asks for it.

The side panel has no say in this. It chooses only whether a turn runs
on-device in the browser or goes to this server, so API keys, cost and model
choice all stay on the server side, and a provider can be swapped without
touching the extension.

### Pointing a provider somewhere else

Each provider can be sent to a different address, which is what you want for a
local runtime, a proxy or a company gateway:

```env
OPENAI_BASE_URL=http://localhost:4000/v1
ANTHROPIC_BASE_URL=https://gateway.example.com/anthropic
GOOGLE_GENERATIVE_AI_BASE_URL=https://gateway.example.com/google
OLLAMA_HOST=http://127.0.0.1:11434/v1
```

The `openai` provider deliberately uses chat completions rather than OpenAI's
own Responses API, because chat completions is the one thing every
OpenAI-compatible server implements. So anything speaking that dialect — vLLM,
LiteLLM, a gateway of your own — works through `openai` with an
`OPENAI_BASE_URL`.

### Installation & Execution

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the backend model server:
   ```bash
   npm run server
   ```
   This starts the local model routing server on `http://localhost:3000`. The console prints an authenticated URL for the log dashboard — see [Log dashboard](#log-dashboard) below.

3. Build the Chrome extension (in a separate terminal):
   ```bash
   npm run build
   ```
   The bundled extension files will be output to the `dist/` directory.

4. Load into Google Chrome:
   - Open Chrome and navigate to `chrome://extensions`.
   - Enable **Developer mode** in the top right.
   - Click **Load unpacked** and select the `dist/` folder.

---

## Log dashboard

The backend keeps the last 500 calls and serves a live view of them. Entries include
full prompts, model replies and scraped page content, so the endpoint requires the
auth token. The server prints a ready-to-open URL on startup:

```
📊 Log dashboard: http://127.0.0.1:3000/logs?token=<WEBMCP_AUTH_TOKEN>
```

Opening it exchanges the token for a 12-hour session cookie and redirects to a clean
`/logs`, so the token does not stay in browser history. The HTML page, `?json=true`
and the `?stream=true` SSE feed all return `401` without that cookie or the token.

Set `WEBMCP_LOG_REDACT_BODIES=1` to keep request and response bodies out of the log
buffer while still recording method, path, status and latency.

---

## Testing

Run the automated test suite powered by Node's native test runner and `esbuild`:

```bash
npm test
```

---

## Project Structure

```
webmcp-extension/
├── .env                       # Root environment file (a provider key, MODEL=..., WEBMCP_AUTH_TOKEN=...)
├── scripts/                   # Automated build & bundle scripts
│   └── build.js               # Injects WEBMCP_AUTH_TOKEN and bundles extension
├── server/                    # Node.js backend model server & call logger
│   ├── server.js              # Model routing server (port 3000)
│   ├── providers.js           # Reads MODEL and the provider keys from .env
│   ├── tools.js               # The page's JSON Schema tools, declared for the model
│   ├── security.js            # Origin validation, CORS configuration & token authentication
│   └── logs.html              # Real-time web dashboard for inspecting backend server calls (http://localhost:3000/logs)
├── extension/                 # Chrome extension (Manifest V3) assets
│   ├── manifest.json          # Chrome Extension Manifest V3 configuration
│   ├── sidebar.html           # Side panel host HTML page
│   ├── background.js          # Service worker for tab navigation & tool badge updates
│   ├── content.js             # Content script bridging WebMCP document.modelContext
│   ├── utils.js               # Web navigation & iframe origin helpers
│   └── icons/                 # Extension toolbar and store icons
├── src/                       # React extension side panel application
│   ├── components/            # UI components (ChatBubble, ActionLog, AllowToolPermissionCard, Switch, etc.)
│   ├── screens/               # Screen views (ConsentScreen, SettingsScreen)
│   ├── services/              # Extension & backend bridges (backendBridge.ts, chatBridge.ts, promptApiBackend.ts, extensionBridge.ts, tabSessionStore.ts, toolEncoder.ts, toolPermissions.ts)
│   ├── hooks/                 # Custom hooks (useActiveTabId.ts, useActiveTabTools.ts, useAgentSession.ts)
│   ├── types/                 # TypeScript interfaces and declarations
│   ├── foundation/            # Typography and icon assets
│   ├── styles.css             # Component styling and design tokens
│   ├── App.tsx                # Main application component & tool loop orchestrator
│   └── index.tsx              # React entry point
├── tests/                     # Automated unit test suite
├── package.json               # Scripts and dependencies
└── tsconfig.json              # TypeScript compiler configuration
```

---

## License

Apache License 2.0. See [LICENSE](LICENSE) for details.
