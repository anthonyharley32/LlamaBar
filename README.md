# LlamaBar

A Chrome extension that provides a local AI assistant powered by Ollama, running completely locally on your machine. It adds a convenient sidebar interface for interacting with local LLMs through Ollama.

## Features

- 🤖 Local AI assistant powered by Ollama
- 🔒 Completely private - all processing happens on your machine
- 📝 Interactive sidebar interface
- 💬 Real-time streaming responses
- 🔍 Text selection support for quick queries
- 🎯 Explain and translate functionality

## Prerequisites

1. Install [Ollama](https://ollama.ai)
2. Pull the desired model:
```bash
ollama pull llama3.2:1b
```

## Technical Details

- Chrome Extension Manifest Version: v3
- Supported External Providers:
  - OpenAI API (o1, o1-mini, o3-mini, o3-mini-high, gpt-4o, gpt-4o-mini)
  - Anthropic API (Claude 3.5 and Claude 3 series)
  - Google Gemini API (Gemini 1.5 and 1.0 series)
  - Perplexity API (Sonar series)
  - Grok API (Grok 2 series)
  - OpenRouter API (custom model selection)
- Dependencies:
  - Marked.js for Markdown rendering
  - Chrome Extension APIs:
    - activeTab
    - scripting
    - sidePanel
    - storage
  - WebCrypto API for secure key storage
  - Native Messaging for Ollama integration

## Installation

1. Clone this repository or download the source code
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory

## Setup

1. Start Ollama with the correct CORS settings:
```bash
OLLAMA_ORIGINS="chrome-extension://*" ollama serve
```

To make this setting permanent, you can:
- On macOS/Linux: Add to your shell profile (~/.zshrc, ~/.bashrc, etc.):
  ```bash
  export OLLAMA_ORIGINS="chrome-extension://*"
  ```
- Or run Ollama as a service with these settings

2. The extension icon should appear in your Chrome toolbar
3. Click the icon to open the AI assistant sidebar

## Usage

1. Click the extension icon to toggle the sidebar
2. Type your question in the input box and press Enter or click the send button
3. Select text on any webpage and use the popup buttons to:
   - Explain: Get an explanation of the selected text
   - Translate: Translate the selected text to English

## Troubleshooting

- If you see a "403 Forbidden" error, make sure:
  1. Ollama is running (`ollama serve`)
  2. The OLLAMA_ORIGINS environment variable is set correctly
  3. You're using the correct model name (llama3.2:1b)
  
- If the extension isn't responding:
  1. Check if Ollama is running (`ollama list`)
  2. Try restarting Ollama
  3. Reload the extension in chrome://extensions

## Development

The extension is built using:
- Vanilla JavaScript
- Chrome Extension Manifest V3
- Ollama API

## License

[MIT License](LICENSE)