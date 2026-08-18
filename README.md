# WebMCP - Example Chrome Extension

A Google Chrome extension for inspecting, executing, and testing WebMCP tools.

> **Disclaimer**: This is not an officially supported Google product. This project is not eligible for the [Google Open Source Software Vulnerability Rewards Program](https://bughunters.google.com/open-source-security).

---

## Features

- **Dynamic WebMCP Tool Discovery**: Automatically queries `document.modelContext.getTools()` and listens for `ontoolchange` across top-level pages and cross-origin `iframe` frames.
- **Backend Model Routing & Secure Key Storage**: Routes model requests to a local Node.js backend server so consumer-facing extension code never accesses or exposes API keys.
- **Gemini LLM Integration**: Example powered by `@google/genai` on the backend server.
- **Figma-Aligned UI Design**:
  - Light mode interface matching WebMCP design tokens.
  - Floating WebMCP Tool IPH popovers and action details modal.
  - Real-time markdown response rendering.
  - Quick action chips and status badges.
- **Protocol Inspector**: Dedicated tools tab for inspecting registered WebMCP tool declarations, parameter JSON schemas, and manual tool invocation.
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

### Test Coverage Includes:
- **Services & Hooks (`tests/servicesAndHooks.test.ts`)**: Extension bridge timeouts, tool schemas, CORS authorization, and backend bridge helpers.
- **Tool Name Encoding (`tests/toolNameEncoding.test.ts`)**: Encoded location mapping (`_0_toolName`), schema parameter normalization, and regex decoding (`/^_(\d+)_(.*)$/`).
- **Markdown Renderer (`tests/markdownText.test.ts`)**: Parsing for bold, italic, inline code, links, headers, and code block formatting.
- **Extension Utilities (`tests/utils.test.ts`)**: Extraction of cross-origin iframe origins (`getIframeOrigins`).

---

## Project Structure

```
webmcp-dev-extension/
├── .env                       # Root environment file (GEMINI_API_KEY=...)
├── server/                    # Node.js backend server
│   ├── server.js              # Backend model routing server & call logger (port 3000)
│   └── logs.html              # Real-time web dashboard for inspecting backend server calls (http://localhost:3000/logs)
├── extension/                 # Chrome extension manifest & background/content scripts
│   ├── manifest.json          # Chrome Extension Manifest V3 configuration
│   ├── background.js          # Service worker for tab navigation & tool badge updates
│   ├── content.js             # Content script bridging WebMCP document.modelContext
│   ├── sidebar.html           # Side panel HTML entry point
│   └── utils.js               # Web navigation & iframe origin helpers
├── src/                       # React App source code
│   ├── components/            # React UI components (ChatBubble, ActionLog, AttachedTab, etc.)
│   ├── hooks/                 # React hooks (useActiveTabTools, useAgentSession)
│   ├── screens/               # Screen views (ConsentScreen)
│   ├── services/              # Extension & backend API bridges (backendBridge.ts, extensionBridge.ts, toolEncoder.ts)
│   ├── types/                 # TypeScript interfaces (WebMCPTool, ActivityEntry, etc.)
│   ├── styles.css             # Consolidated design tokens and UI styles
│   ├── App.tsx                # Main application component & tool loop orchestrator
│   └── index.tsx              # React entry point
├── tests/                     # Automated unit test suite
└── package.json
```

---

## License

Apache License 2.0. See [LICENSE](LICENSE) for details.
