// Import ApiKeyManager
import { ApiKeyManager } from './utils/api-key-manager.js';
import { LocalModelService } from './services/local-model.js';
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

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SIDEBAR_STATE_CHANGED') {
        isSidebarVisible = message.isVisible;
    } else if (message.type === 'QUERY_OLLAMA') {
        MessageRouter.routeModelRequest(message);
        return true; // Will respond asynchronously
    }
});

// Handle messages from the popup/side panel
let port;
chrome.runtime.onConnect.addListener((p) => {
    port = p;
    port.onMessage.addListener(async (message) => {
        if (message.type === 'QUERY_OLLAMA') {
            await MessageRouter.routeModelRequest(message, port);
        }
    });

    port.onDisconnect.addListener(() => {
        port = null;
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
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
        // First check if Ollama is running
        try {
            console.log('Checking Ollama server status...');
            const healthCheck = await fetch(`${OLLAMA_API}/api/tags`);
            if (!healthCheck.ok) {
                console.error('Ollama health check failed:', await healthCheck.text());
                throw new Error('Ollama is not running or not accessible');
            }
            const healthData = await healthCheck.json();
            console.log('Available Ollama models:', healthData.models?.map(m => m.name));
        } catch (error) {
            console.error('Ollama connection error:', error);
            throw new Error('Cannot connect to Ollama. Please ensure it is running.');
        }

        // Determine if this is a vision-capable model
        const isVisionModel = model.toLowerCase().includes('vision') || 
                            model.toLowerCase().includes('dream') || 
                            model.toLowerCase().includes('image');
        
        console.log('Model request details:', {
            model: model,
            isVisionModel: isVisionModel,
            hasImage: prompt.includes('<image>'),
            promptLength: prompt.length
        });

        let requestBody = {
            model: model,
            stream: true,
            options: {
                temperature: 0.7,
                top_k: 50,
                top_p: 0.95,
                repeat_penalty: 1.1
            }
        };

        // Handle vision model format
        if (isVisionModel && prompt.includes('<image>')) {
            console.log('Processing vision model request');
            const imageMatch = prompt.match(/<image>(.*?)<\/image>/s);
            const base64Image = imageMatch ? imageMatch[1] : null;
            const textPrompt = prompt.replace(/<image>.*?<\/image>/s, '').trim();

            if (!base64Image) {
                console.error('No image data found in prompt');
                throw new Error('Image data is missing or invalid');
            }

            // Clean the base64 data - remove data URL prefix if present
            const cleanBase64 = base64Image.replace(/^data:image\/[a-z]+;base64,/, '');

            console.log('Vision request structure:', {
                model: model,
                hasImage: !!cleanBase64,
                promptLength: textPrompt.length
            });

            // Format specifically for vision models
            requestBody = {
                model: model,
                messages: [{
                    role: "user",
                    content: textPrompt || "Describe this image",
                    images: [cleanBase64]
                }],
                stream: false,  // Disable streaming for more reliable responses
                options: {
                    temperature: 0.0,  // Keep temperature at 0 for more consistent responses
                    num_predict: 500   // Ensure we get a complete response
                }
            };

            // Use chat endpoint for vision models
            console.log('Sending vision request to Ollama chat endpoint...');
            const response = await fetch('http://localhost:11434/api/chat', {
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
                console.error('Ollama vision request failed:', {
                    status: response.status,
                    statusText: response.statusText,
                    error: errorText
                });
                throw new Error(`Ollama vision request failed: ${response.status} ${response.statusText}\n${errorText}`);
            }

            // Handle non-streaming response
            const data = await response.json();
            console.log('Received vision model response:', {
                success: !!data.message,
                contentLength: data.message?.content?.length
            });

            if (data.message && data.message.content) {
                chrome.runtime.sendMessage({
                    type: 'OLLAMA_RESPONSE',
                    success: true,
                    response: data.message.content,
                    done: true
                });
            } else {
                console.error('Invalid vision model response format:', data);
                throw new Error('Invalid response format from vision model');
            }

            return { success: true };
        } else {
            // Regular text prompt for other models
            console.log('Processing text-only request');
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

        let fullResponse = '';
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        console.log('Starting to read response stream...');
        while (true) {
            const {value, done} = await reader.read();
            if (done) {
                console.log('Response stream complete');
                break;
            }
            
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');
            
            for (const line of lines) {
                if (line.trim() === '') continue;
                
                try {
                    const data = JSON.parse(line);
                    if (data.response) {
                        fullResponse += data.response;
                        // Stream each chunk to the UI
                        chrome.runtime.sendMessage({
                            type: 'OLLAMA_RESPONSE',
                            success: true,
                            response: fullResponse,
                            done: data.done
                        });
                    }
                } catch (e) {
                    console.error('Error parsing JSON chunk:', e, 'Raw chunk:', line);
                }
            }
        }

        if (!fullResponse) {
            console.warn('No response content received from model');
            throw new Error('No response content received from model');
        }

        console.log('Request completed successfully:', {
            responseLength: fullResponse.length,
            model: model
        });

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
        console.log('Initializing OpenAI request:', {
            model,
            hasImage,
            promptLength: prompt.length
        });

        const apiKey = await ApiKeyManager.getApiKey('openai');
        if (!apiKey) {
            console.error('OpenAI API key not found');
            throw new Error('OpenAI API key not found');
        }

        // Extract the actual model ID (remove the 'openai:' prefix if present)
        const modelId = model.replace('openai:', '');

        const messages = [];
        if (hasImage) {
            console.log('Processing image-based request for OpenAI');
            const base64Image = prompt.match(/<image>(.*?)<\/image>/)?.[1];
            const text = prompt.replace(/<image>.*?<\/image>\n?/, '').trim();
            
            if (!base64Image) {
                console.error('No image data found in prompt for OpenAI vision request');
                throw new Error('Image data is missing or invalid');
            }

            messages.push({
                role: 'user',
                content: [
                    { type: 'text', text },
                    {
                        type: 'image_url',
                        image_url: { url: base64Image }
                    }
                ]
            });
        } else {
            messages.push({
                role: 'user',
                content: prompt
            });
        }

        console.log('Sending request to OpenAI:', {
            model: modelId,
            messageCount: messages.length,
            hasImage
        });

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
            console.error('OpenAI API error:', {
                status: response.status,
                error: error.error
            });
            throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
        }

        console.log('Starting to read OpenAI response stream...');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullResponse = '';

        try {
            while (true) {
                const { value, done } = await reader.read();
                
                if (done) {
                    console.log('OpenAI response stream complete');
                    break;
                }

                // Decode the chunk and add it to our buffer
                buffer += decoder.decode(value, { stream: true });
                
                // Split on newlines, keeping any remainder in the buffer
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    // Skip empty lines and "[DONE]" messages
                    if (!line.trim() || line === 'data: [DONE]') continue;

                    // Remove the "data: " prefix and parse the JSON
                    const jsonStr = line.replace(/^data: /, '').trim();
                    if (!jsonStr) continue;

                    try {
                        const json = JSON.parse(jsonStr);
                        const content = json.choices?.[0]?.delta?.content || '';
                        
                        if (content) {
                            // Send just the new content chunk
                            const response = {
                                type: 'OLLAMA_RESPONSE',
                                success: true,
                                response: content,
                                done: false
                            };
                            
                            if (port) {
                                port.postMessage(response);
                            } else {
                                chrome.runtime.sendMessage(response);
                            }
                            
                            fullResponse += content;
                        }
                    } catch (e) {
                        console.error('Error parsing OpenAI SSE message:', e, 'Raw line:', line);
                    }
                }
            }

            // Handle any remaining buffer content
            if (buffer.trim()) {
                try {
                    const jsonStr = buffer.replace(/^data: /, '').trim();
                    if (jsonStr && jsonStr !== '[DONE]') {
                        const json = JSON.parse(jsonStr);
                        const content = json.choices?.[0]?.delta?.content || '';
                        if (content) {
                            fullResponse += content;
                            const response = {
                                type: 'OLLAMA_RESPONSE',
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
                    }
                } catch (e) {
                    console.error('Error parsing final buffer:', e);
                }
            }
        } finally {
            // Always send the final done message
            const finalResponse = {
                type: 'OLLAMA_RESPONSE',
                success: true,
                response: '',
                done: true
            };
            
            if (port) {
                port.postMessage(finalResponse);
            } else {
                chrome.runtime.sendMessage(finalResponse);
            }
        }

        if (!fullResponse) {
            console.warn('No response content received from OpenAI');
            throw new Error('No response content received from OpenAI');
        }

        console.log('OpenAI request completed successfully:', {
            responseLength: fullResponse.length,
            model: modelId
        });

    } catch (error) {
        console.error('OpenAI request error:', error);
        const errorResponse = {
            type: 'OLLAMA_RESPONSE',
            success: false,
            error: error.message
        };
        
        if (port) {
            port.postMessage(errorResponse);
        } else {
            chrome.runtime.sendMessage(errorResponse);
        }
    }
}

// Handler functions for each provider
async function handleAnthropicRequest(prompt, modelId, hasImage = false, port = null) {
    try {
        const apiKey = await ApiKeyManager.getApiKey('anthropic');
        if (!apiKey) {
            throw new Error('Anthropic API key not found');
        }

        const messages = [];
        if (hasImage) {
            const base64Image = prompt.match(/<image>(.*?)<\/image>/)?.[1];
            const text = prompt.replace(/<image>.*?<\/image>\n?/, '').trim();
            
            messages.push({
                role: 'user',
                content: [
                    { type: 'text', text: text },
                    base64Image ? {
                        type: 'image',
                        source: { type: 'base64', data: base64Image }
                    } : null
                ].filter(Boolean)
            });
        } else {
            messages.push({
                role: 'user',
                content: prompt
            });
        }

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                model: modelId,
                messages,
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
                    const content = json.delta?.text || '';
                    if (content) {
                        const response = {
                            type: 'OLLAMA_RESPONSE',
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
            type: 'OLLAMA_RESPONSE',
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
                            type: 'OLLAMA_RESPONSE',
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
            type: 'OLLAMA_RESPONSE',
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
                            type: 'OLLAMA_RESPONSE',
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
            type: 'OLLAMA_RESPONSE',
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
                            type: 'OLLAMA_RESPONSE',
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
            type: 'OLLAMA_RESPONSE',
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


