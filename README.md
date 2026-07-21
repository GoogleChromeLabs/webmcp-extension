# WebMCP - Example Chrome Extension

A Google Chrome extension for inspecting, executing, and testing WebMCP tools across multi-provider AI models (Gemini, OpenAI / ChatGPT, and Anthropic / Claude).

> **Disclaimer**: This is not an officially supported Google product. This project is not eligible for the [Google Open Source Software Vulnerability Rewards Program](https://bughunters.google.com/open-source-security).

---

## Features

- **Dynamic WebMCP Tool Discovery**: Automatically queries `document.modelContext.getTools()` and listens for `ontoolchange` across top-level pages and cross-origin `iframe` frames.
- **Multi-Provider LLM Integration**:
  - **Gemini**: `gemini-3.5-flash`, `gemini-3-flash-preview`, `gemini-3.1-flash-lite` via `@google/genai`
  - **OpenAI**: `gpt-5.1`, `gpt-5-mini`, `gpt-4.1` via `openai`
  - **Anthropic**: `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5` via `@anthropic-ai/sdk`
- **Figma-Aligned UI Design**:
  - Model Picker & Dropdown selector with provider grouping and checkmarks.
  - Floating WebMCP Tool IPH popovers and action details modal.
  - Real-time markdown response rendering.
  - Quick action chips and status badges.
- **Protocol Inspector**: Dedicated tools tab for inspecting registered WebMCP tool declarations, parameter JSON schemas, and manual tool invocation.
- **In-Flight Tool Re-discovery**: Mid-run tool listing updates ensure newly revealed form tools (e.g. search filters) are immediately made available to the model within multi-turn runs.

---

## Getting Started

### Prerequisites

- Node.js `v20.0.0+`
- Google Chrome with the `WebMCP for testing` flag enabled (`chrome://flags`).

### Installation & Build

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the extension:
   ```bash
   npm run build
   ```
   The bundled extension files will be output to the `dist/` directory.

3. Load into Google Chrome:
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
- **AI Providers (`tests/providers.test.js`)**: Provider definitions, model configs, and chat instance creation (`createChat`).
- **Tool Name Encoding (`tests/toolNameEncoding.test.js`)**: Encoded location mapping (`_0_toolName`), schema parameter normalization, and regex decoding (`/^_(\d+)_(.*)$/`).
- **Markdown Renderer (`tests/markdownText.test.js`)**: Parsing for bold, italic, inline code, links, headers, and code block formatting.
- **Extension Utilities (`tests/utils.test.js`)**: Extraction of cross-origin iframe origins (`getIframeOrigins`).

---

## Project Structure

```
webmcp-dev-extension/
├── extension/                 # Chrome extension manifest & background/content scripts
│   ├── manifest.json          # Chrome Extension Manifest V3 configuration
│   ├── background.js          # Service worker for tab navigation & tool badge updates
│   ├── content.js             # Content script bridging WebMCP document.modelContext
│   └── utils.js               # Web navigation & iframe origin helpers
├── src/                       # React App source code
│   ├── components/            # React UI components (ModelPicker, ChatBubble, etc.)
│   ├── screens/               # Screen views (NexusIPH, ToolsInspector, SettingsModal)
│   ├── foundation/            # CSS tokens, Google Symbols fonts, and design tokens
│   ├── providers.jsx          # React Provider Context & SDK wrappers (Gemini, OpenAI, Anthropic)
│   ├── App.jsx                # Main application component & tool loop orchestrator
│   └── index.jsx              # React entry point
├── tests/                     # Automated unit test suite
│   ├── providers.test.js
│   ├── toolNameEncoding.test.js
│   ├── markdownText.test.js
│   └── utils.test.js
└── package.json
```

---

## License

Apache License 2.0. See [LICENSE](LICENSE) for details.
