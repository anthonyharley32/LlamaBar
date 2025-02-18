# Product Requirements Document (PRD) for LlamaBar

## 1. Overview
**LlamaBar** is a Chrome extension that provides a local AI assistant interface powered primarily by Ollama. It also integrates with external LLM providers (OpenAI, Anthropic, Gemini, Perplexity, OpenRouter, Grok) to give users a seamless, private, and interactive chat experience—all within the browser. The extension supports real-time streaming responses, image inputs for vision models, and customizable model selection with API key management.

## 2. Product Goals
- **Privacy & Local Processing:** Enable AI assistance locally using Ollama to keep processing private.
- **Seamless Integration:** Allow users to interact with both local and external LLMs via a unified sidebar.
- **Real-Time Interaction:** Deliver streaming responses for a dynamic conversational experience.
- **Ease of Use:** Provide an intuitive setup wizard and user interface for non-expert users.
- **Extensibility:** Support additional LLM providers via API key management and modular architecture.

## 3. Target Audience
- **Developers & Tech Enthusiasts:** Users who want to run and interact with local AI models.
- **Privacy-Conscious Users:** Individuals who prefer local processing over cloud-based solutions.
- **Content Creators & Learners:** Users needing quick explanations or translations from selected text on web pages.
- **Researchers & Academics:** Professionals studying academic papers, research documents, and technical literature who need assistance with analysis and comprehension.

## 4. Core Functionality

### 4.1 Local AI Assistant Integration
- **Ollama Server Integration:** Will check if the Ollama server is running and start it via native messaging if necessary.
- **Setup Wizard:** Will guide users through installing Ollama, starting the server with proper CORS settings, and installing required models.
- **Image Input for Vision Models:** Will support pasted images in queries when interacting with vision-capable models.

### 4.2 External Provider Integration
- **Multiple Providers:** Will support external models via OpenAI, Anthropic, Gemini, Perplexity, OpenRouter, and Grok.
- **API Key Management:** Will encrypt, save, retrieve, and delete API keys using a simple XOR-based obfuscation method.
- **Streaming API Responses:** Will handle real-time streaming responses from external LLM APIs.

### 4.3 User Interface (UI)
- **Sidebar Chat Interface:** Will provide a dedicated sidebar for conversation that includes a chat window and input area.
- **Model Selector:** Will include a custom dropdown with provider logos, enabling users to switch between models.
- **Responsive Input Area:** Will feature an auto-resizing textarea with support for image paste events.
- **Text Selection Popup:** Will display a popup that offers "Explain" and "Translate" options when users select text on web pages.
- **Settings Dropdown:** Will allow managing API keys and editing available models.

### 4.4 Streaming Response Handling
- **Incremental Updates:** Will implement background and content scripts to efficiently route streaming responses to the UI.
- **Error Handling:** Will display robust status indicators and error messages in the UI if issues arise.

### 4.5 Security & Privacy
- **Local Data Encryption:** Will encrypt API keys before storing them in Chrome storage.
- **Secure Communication:** Will use HTTPS for external API calls and proper CORS configurations for local interactions.

## 5. Technical Requirements
- **Chrome Extension Manifest V3:** Leverages Manifest V3 features such as service workers and side panels.
- **Modular JavaScript Architecture:** Uses ES modules to organize functionality (e.g., setup wizard, API services, message routing).
- **Native Messaging:** Integrates with native messaging for starting/stopping the local Ollama server.
- **Web APIs:** Utilizes Fetch API, Web Streams API, TextDecoder, and other modern browser features.
- **Responsive Design:** HTML/CSS design ensures the sidebar is usable across various screen sizes.
- **Logging & Error Handling:** Extensive console logging and error handling for debugging and user feedback.

## 6. Optional Functionality (if time permits)

### 6.1 Enhanced UI/UX Improvements
- **Customizable Themes:** Allow users to switch between light, dark, and custom themes.
- **Resizable Sidebar:** Enable users to dynamically adjust the sidebar width.
- **Voice Input:** Integrate speech-to-text for hands-free query submission.
- **Chat History Persistence:** Save conversation history across sessions.

### 6.2 Expanded Provider Support
- **Additional LLM Providers:** Integrate with new LLM APIs (e.g., Cohere, AI21 Labs).
- **Advanced API Key Validation:** More granular and robust API key verification mechanisms.

### 6.3 Advanced Interaction Features
- **Enhanced Text Selection:** Expand text selection features with additional actions beyond "Explain" and "Translate".

### 6.4 Security Enhancements
- **User Authentication:** Optional account system to sync settings and chat history across devices.

### 6.5 Developer & Analytics Tools
- **Detailed Logging Dashboard:** In-app dashboard for API usage analytics and performance metrics.
- **Custom Prompt Library:** Allow users to save and reuse custom prompts and macros.

## 7. Risks & Mitigations
- **Dependency on Ollama:** Provide clear error messages and fallback instructions if the local server is not running.
- **API Rate Limits/Errors:** Implement robust error handling for external API calls.
- **Security Vulnerabilities:** Regularly update encryption methods and perform security audits.

## 8. Conclusion
LlamaBar aims to deliver a seamless and private AI assistant experience directly in Chrome. With a strong foundation built on local and external LLM integrations and a clear roadmap for future enhancements, LlamaBar is positioned to meet the needs of its target users while remaining extensible and secure.
