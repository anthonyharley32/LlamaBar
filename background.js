// Import ApiKeyManager
import { ApiKeyManager } from './utils/api-key-manager.js';
import { LocalModelService } from './services/local-model.js';
import { ExternalModelService } from './services/external-model.js';
import { MessageRouter } from './utils/message-router.js';

// State management
let isSidebarVisible = false;
let connections = new Map();
let injectedTabs = new Set();
let ollamaProcess = null;

// Connection management
function createConnection(tabId) {
    if (!connections.has(tabId)) {
        connections.set(tabId, {
            id: tabId,
            port: null,
            isActive: false
        });
    }
    return connections.get(tabId);
}

// Ollama lifecycle management
async function startOllamaServer() {
    try {
        const response = await fetch('http://localhost:11434/api/version');
        if (response.ok) {
            console.log('Ollama is already running');
            return true;
        }
    } catch (error) {
        console.log('Ollama is not running, attempting to start...');
    }

    try {
        // Use native messaging to start Ollama
        chrome.runtime.sendNativeMessage('com.ollama.native', {
            command: 'start_server',
            args: 'OLLAMA_ORIGINS="chrome-extension://*" ollama serve'
        }, response => {
            if (chrome.runtime.lastError) {
                console.error('Failed to start Ollama:', chrome.runtime.lastError);
                return false;
            }
            return response.success;
        });
        
        // Wait for server to start
        let attempts = 0;
        while (attempts < 10) {
            try {
                const response = await fetch('http://localhost:11434/api/version');
                if (response.ok) {
                    console.log('Ollama server started successfully');
                    return true;
                }
            } catch (error) {
                // Server not ready yet
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
        }
        
        console.error('Timeout waiting for Ollama server to start');
        return false;
    } catch (error) {
        console.error('Error starting Ollama server:', error);
        return false;
    }
}

// Handle extension icon click
chrome.action.onClicked.addListener(async (tab) => {
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
        console.warn('Cannot inject scripts into browser system pages');
        return;
    }

    // Start Ollama server if not running
    await LocalModelService.startServer();

    try {
        // Only inject if not already injected
        if (!injectedTabs.has(tab.id)) {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content.js']
            });
            injectedTabs.add(tab.id);
        }
        
        isSidebarVisible = !isSidebarVisible;
        chrome.tabs.sendMessage(tab.id, {
            type: 'TOGGLE_SIDEBAR',
            show: isSidebarVisible
        });
    } catch (error) {
        console.error('Error toggling sidebar:', error);
    }
});

// Clean up when all windows are closed
chrome.windows.onRemoved.addListener(async () => {
    const windows = await chrome.windows.getAll();
    if (windows.length === 0) {
        // Last window closed, clean up Ollama
        await LocalModelService.stopServer();
    }
});

// Clean up injectedTabs when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
    injectedTabs.delete(tabId);
    connections.delete(tabId);
});

// Handle messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Received message:', { type: message.type, sender });
    
    if (message.type === 'QUERY_OLLAMA') {
        // Handle the request asynchronously
        try {
            MessageRouter.routeModelRequest(message, null, sendResponse)
                .catch(error => {
                    console.error('Error routing model request:', error);
                    sendResponse({ success: false, error: error.message });
                });
        } catch (error) {
            console.error('Error initiating model request:', error);
            sendResponse({ success: false, error: error.message });
            return false;
        }
        
        // Return true to indicate we will send a response asynchronously
        return true;
    }
    
    return false;
});

// Handle long-lived connections
chrome.runtime.onConnect.addListener((port) => {
    console.log('New connection established:', port.name);
    
    port.onMessage.addListener(async (message) => {
        console.log('Received port message:', { type: message.type, port: port.name });
        
        if (message.type === 'QUERY_OLLAMA') {
            try {
                await MessageRouter.routeModelRequest(message, port);
            } catch (error) {
                console.error('Error handling port message:', error);
                port.postMessage({
                    type: 'MODEL_RESPONSE',
                    success: false,
                    error: error.message || 'Unknown error occurred'
                });
            }
        }
    });
    
    port.onDisconnect.addListener(() => {
        console.log('Port disconnected:', port.name);
        if (chrome.runtime.lastError) {
            console.warn('Port error:', chrome.runtime.lastError);
        }
    });
});

// Initialize side panel behavior
chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// Update the API endpoint to use standard port
const OLLAMA_API = 'http://localhost:11434';

// Function to communicate with Ollama
async function handleOllamaQuery(prompt, model = 'llama3.2:1b') {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
        // First check if Ollama is running
        const isRunning = await checkOllamaRunning();
        if (!isRunning) {
            throw new Error('Ollama is not running. Please start Ollama and try again.');
        }

        const isVisionModel = model.toLowerCase().includes('vision');
        const requestBody = {
            model: model,
            stream: true
        };

        if (isVisionModel && prompt.includes('<image>')) {
            // Handle vision model request
            const { processedPrompt, images } = await processVisionPrompt(prompt);
            requestBody.prompt = processedPrompt;
            requestBody.images = images;
        } else {
            requestBody.prompt = prompt;
        }

        console.log('Sending request to Ollama:', {
            model: model,
            endpoint: '/api/generate',
            requestType: isVisionModel ? 'vision' : 'text'
        });

        const response = await fetch(`${OLLAMA_API}/api/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Origin': 'chrome-extension://' + chrome.runtime.id
            },
            body: JSON.stringify(requestBody)
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Ollama request failed:', {
                status: response.status,
                statusText: response.statusText,
                error: errorText
            });
            throw new Error(`Ollama request failed: ${response.status} ${response.statusText}\n${errorText}`);
        }

        // Use LocalModelService to handle the streaming response
        const streamGenerator = LocalModelService.handleStreamingResponse(response);
        for await (const chunk of streamGenerator) {
            chrome.runtime.sendMessage(chunk);
        }

        return { success: true };
    } catch (error) {
        console.error('Ollama query error:', error);
        throw new Error(error.message || 'Failed to communicate with Ollama');
    } finally {
        clearTimeout(timeoutId);
    }
}

// Handle OpenAI API request
async function handleOpenAIRequest(prompt, model, hasImage = false, port = null) {
    try {
        const apiKey = await ApiKeyManager.getApiKey('openai');
        if (!apiKey) {
            throw new Error('OpenAI API key not found');
        }

        const modelId = model.replace('openai:', '');
        const messages = [];
        
        if (hasImage) {
            const base64Image = prompt.match(/<image>(.*?)<\/image>/)?.[1];
            const text = prompt.replace(/<image>.*?<\/image>\n?/, '').trim();
            
            messages.push({
                role: 'user',
                content: [
                    { type: 'text', text: text },
                    base64Image ? {
                        type: 'image_url',
                        image_url: { url: `data:image/jpeg;base64,${base64Image}` }
                    } : null
                ].filter(Boolean)
            });
        } else {
            messages.push({
                role: 'user',
                content: prompt
            });
        }

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: modelId,
                messages,
                stream: true
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
        }

        // Use ExternalModelService to handle the streaming response
        const streamGenerator = ExternalModelService.handleOpenAIStream(response);
        for await (const chunk of streamGenerator) {
            if (port) {
                port.postMessage(chunk);
            } else {
                chrome.runtime.sendMessage(chunk);
            }
        }

        return { success: true };
    } catch (error) {
        throw new Error(`OpenAI API error: ${error.message}`);
    }
}

// Handler functions for each provider
async function handleAnthropicRequest(prompt, modelId, hasImage = false, port = null) {
    try {
        const apiKey = await ApiKeyManager.getApiKey('anthropic');
        if (!apiKey) {
            throw new Error('Anthropic API key not found');
        }

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: modelId,
                messages: [{
                    role: 'user',
                    content: prompt
                }],
                stream: true
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || `Anthropic API error: ${response.status}`);
        }

        // Use ExternalModelService to handle the streaming response
        const streamGenerator = ExternalModelService.handleAnthropicStream(response);
        for await (const chunk of streamGenerator) {
            if (port) {
                port.postMessage(chunk);
            } else {
                chrome.runtime.sendMessage(chunk);
            }
        }

        return { success: true };
    } catch (error) {
        throw new Error(`Anthropic API error: ${error.message}`);
    }
}

async function handleGeminiRequest(prompt, modelId, hasImage = false, port = null) {
    try {
        const apiKey = await ApiKeyManager.getApiKey('gemini');
        if (!apiKey) {
            throw new Error('Gemini API key not found');
        }

        const messages = [];
        if (hasImage) {
            const base64Image = prompt.match(/<image>(.*?)<\/image>/)?.[1];
            const text = prompt.replace(/<image>.*?<\/image>\n?/, '').trim();
            
            messages.push({
                role: 'user',
                parts: [
                    { text: text },
                    base64Image ? {
                        inline_data: {
                            mime_type: 'image/jpeg',
                            data: base64Image
                        }
                    } : null
                ].filter(Boolean)
            });
        } else {
            messages.push({
                role: 'user',
                parts: [{ text: prompt }]
            });
        }

        const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/${modelId}:streamGenerateContent?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: messages,
                generationConfig: {
                    temperature: 0.7,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 2048
                }
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || `API error: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value);
            const chunks = buffer.split('\n');
            buffer = chunks.pop() || '';

            for (const chunk of chunks) {
                if (!chunk.trim()) continue;
                
                try {
                    const json = JSON.parse(chunk);
                    const content = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    if (content) {
                        const response = {
                            type: 'MODEL_RESPONSE',
                            success: true,
                            response: content,
                            done: false
                        };
                        if (port) {
                            port.postMessage(response);
                        } else {
                            chrome.runtime.sendMessage(response);
                        }
                    }
                } catch (e) {
                    console.warn('Error parsing chunk:', e);
                }
            }
        }

        const finalResponse = {
            type: 'MODEL_RESPONSE',
            success: true,
            response: '',
            done: true
        };
        
        if (port) {
            port.postMessage(finalResponse);
        } else {
            chrome.runtime.sendMessage(finalResponse);
        }

    } catch (error) {
        throw new Error(`Gemini API error: ${error.message}`);
    }
}

async function handlePerplexityRequest(prompt, modelId, hasImage = false, port = null) {
    try {
        const apiKey = await ApiKeyManager.getApiKey('perplexity');
        if (!apiKey) {
            throw new Error('Perplexity API key not found');
        }

        const response = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: modelId,
                messages: [{
                    role: 'user',
                    content: prompt
                }],
                stream: true
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || `API error: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value);
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.trim() === '') continue;
                if (line === 'data: [DONE]') continue;
                
                try {
                    const json = JSON.parse(line.replace('data: ', ''));
                    const content = json.choices[0]?.delta?.content || '';
                    if (content) {
                        const response = {
                            type: 'MODEL_RESPONSE',
                            success: true,
                            response: content,
                            done: false
                        };
                        if (port) {
                            port.postMessage(response);
                        } else {
                            chrome.runtime.sendMessage(response);
                        }
                    }
                } catch (e) {
                    console.warn('Error parsing SSE message:', e);
                }
            }
        }

        const finalResponse = {
            type: 'MODEL_RESPONSE',
            success: true,
            response: '',
            done: true
        };
        
        if (port) {
            port.postMessage(finalResponse);
        } else {
            chrome.runtime.sendMessage(finalResponse);
        }

    } catch (error) {
        throw new Error(`Perplexity API error: ${error.message}`);
    }
}

async function handleOpenRouterRequest(prompt, modelId, hasImage = false, port = null) {
    try {
        const apiKey = await ApiKeyManager.getApiKey('openrouter');
        if (!apiKey) {
            throw new Error('OpenRouter API key not found');
        }

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': chrome.runtime.getURL(''),
                'X-Title': 'LlamaBar'
            },
            body: JSON.stringify({
                model: modelId,
                messages: [{
                    role: 'user',
                    content: prompt
                }],
                stream: true
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || `API error: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value);
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.trim() === '') continue;
                if (line === 'data: [DONE]') continue;
                
                try {
                    const json = JSON.parse(line.replace('data: ', ''));
                    const content = json.choices[0]?.delta?.content || '';
                    if (content) {
                        const response = {
                            type: 'MODEL_RESPONSE',
                            success: true,
                            response: content,
                            done: false
                        };
                        if (port) {
                            port.postMessage(response);
                        } else {
                            chrome.runtime.sendMessage(response);
                        }
                    }
                } catch (e) {
                    console.warn('Error parsing SSE message:', e);
                }
            }
        }

        const finalResponse = {
            type: 'MODEL_RESPONSE',
            success: true,
            response: '',
            done: true
        };
        
        if (port) {
            port.postMessage(finalResponse);
        } else {
            chrome.runtime.sendMessage(finalResponse);
        }

    } catch (error) {
        throw new Error(`OpenRouter API error: ${error.message}`);
    }
}



