# WebMCP - Example Chrome Extension

A Google Chrome extension for inspecting, executing, and testing WebMCP tools.

> **Disclaimer**: This is not an officially supported Google product. This project is not eligible for the [Google Open Source Software Vulnerability Rewards Program](https://bughunters.google.com/open-source-security).

---

## Features

- **Dynamic WebMCP Tool Discovery**: Automatically queries `document.modelContext.getTools()` and listens for `ontoolchange` across top-level pages and cross-origin `iframe` frames.
- **Backend Model Routing & Secure Key Storage**: Routes model requests to a local Node.js backend server so consumer-facing extension code never accesses or exposes API keys.
- **Hardened Origin & Auth Token Verification**: Secures backend `/api/*` endpoints with strict Origin validation (requiring `chrome-extension://...`) and a shared `WEBMCP_AUTH_TOKEN` (automatically generated on first run and injected at build time), completely blocking malicious web scripts and rogue local processes from hijacking the local model server.
- **Gemini LLM Integration**: Example powered by `@google/genai` on the backend server.
- **Streaming Replies**: Replies appear in the side panel as they are written, on both backends. `/api/chat` streams newline-delimited JSON when a request asks for `stream`.
- **On-Device Model (Prompt API)**: Optional backend that runs the model in the browser through the [Prompt API](https://developer.mozilla.org/docs/Web/API/Prompt_API), so prompts and page data never leave the device and no API key or server is needed. Sessions are created with [`EasyLanguageModel`](https://www.npmjs.com/package/easy-language-model), which shows the model download with a progress bar, asks for a click when the download needs a user gesture, and compacts the conversation with the Summarizer API when it overflows the context (the side panel says so, since the next message waits for it). Turning the on-device model on starts a download it still needs right away, sessions are made for the first of the browser's preferred languages the model supports, plus English, and a meter in the chat shows how much of the model's small context the conversation takes up. Tools are declared per session, so the session is rebuilt whenever the page registers different ones, carrying the conversation over, tool results included. That includes the middle of a turn: when a tool call navigates to a page with other tools, the turn goes on in a new session with those tools. Every tool call is handed back to the agent loop, so the same permission prompts, spotlighting, and limits apply. Enable it under **Settings → Model → On-device model** (requires `chrome://flags/#prompt-api-tool-use` for tool calling).
- **Base64 Spotlighting & Untrusted Content Defense**: Classifies tools via `untrustedContentHint` (defaulting to untrusted for arbitrary web content) and encodes untrusted tool execution results in Base64 to defend against indirect prompt injection. Backend Gemini system instructions enforce strict directives to decode tool output strictly for facts/context and never execute instructions found in page data.
- **Inbound Token & Payload Size Limits**: Enforces an 8,000-character ceiling (`MAX_TOOL_RESPONSE_CHARS`) on string and JSON tool responses from web pages, automatically truncating oversized payloads and appending a `WEBMCP_SECURITY_WARNING` notice to protect against context window exhaustion and prompt expansion attacks.
- **Sensitive Action Permissions**: Prompts user confirmation before executing mutating/non-readonly tools (based on `readOnlyHint`), configurable via the Sensitive Action Alerts toggle in Settings.
- **In-Flight Tool Re-discovery**: Mid-run tool listing updates ensure newly revealed form tools (e.g. search filters) are immediately made available to the model within multi-turn runs.
- **Real-Time Debug Server Call Inspector**: Browse `http://localhost:3000/logs` in any web browser to inspect live, streaming request/response payloads, latency, and status codes for all calls made to the backend server.

---

## Getting Started

### Prerequisites

- Node.js `v20.0.0+`
- Google Chrome with the `WebMCP for testing` flag enabled (`chrome://flags`).

### Environment Configuration (`.env`)

Create a `.env` file at the **root directory** of the project (`webmcp-dev-extension/.env`):

```env
# Gemini API Key (Required)
GEMINI_API_KEY=your_gemini_api_key_here

# Security: Auth Token (Auto-generated and persisted automatically if omitted)
WEBMCP_AUTH_TOKEN=your_secure_auth_token_here

# Security: Extension Restriction (Optional: set manually to restrict access to a specific extension ID)
ALLOWED_EXTENSION_ID=optional_specific_extension_id_to_restrict

# Optional Server Settings
PORT=3000
MODEL=gemini-3.6-flash
```

### Installation & Execution

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the backend model server:
   ```bash
   npm run server
   ```
   This starts the local model routing server on `http://localhost:3000`. You can open `http://localhost:3000/logs` in your web browser to view the real-time server call logs inspector.

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

## Testing

Run the automated test suite powered by Node's native test runner and `esbuild`:

```bash
npm test
```

---

## Project Structure

```
webmcp-dev-extension/
├── .env                       # Root environment file (GEMINI_API_KEY=..., WEBMCP_AUTH_TOKEN=...)
├── scripts/                   # Automated build & bundle scripts
│   └── build.js               # Injects WEBMCP_AUTH_TOKEN and bundles extension
├── server/                    # Node.js backend model server & call logger
│   ├── server.js              # Model routing server (port 3000)
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
│   ├── services/              # Extension & backend API bridges (backendBridge.ts, chatBridge.ts, promptApiBackend.ts, extensionBridge.ts, toolEncoder.ts)
│   ├── hooks/                 # Custom hooks (useActiveTabTools.ts, useAgentSession.ts)
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
