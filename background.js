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
    await startOllamaServer();

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
        chrome.runtime.sendNativeMessage('com.ollama.native', {
            command: 'stop_server'
        });
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
    }
});

// Handle messages from the popup
chrome.runtime.onConnect.addListener((p) => {
    port = p;
    port.onMessage.addListener(async (message) => {
        if (message.type === 'QUERY_OLLAMA') {
            const [provider, modelId] = message.model.split(':');
            
            if (provider === 'openai') {
                await handleOpenAIRequest(message.prompt, message.model, message.hasImage);
            } else {
                // Handle Ollama request
                await handleOllamaQuery(message.prompt, modelId);
            }
        }
    });
});

// Initialize side panel behavior
chrome.runtime.onInstalled.addListener(() => {
    // Set the side panel to open when the action button is clicked
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// Handle messages from the side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'QUERY_OLLAMA') {
        handleOllamaQuery(message.prompt, message.model)
            .then(response => {
                if (!response.success) {
                    chrome.runtime.sendMessage({
                        type: 'OLLAMA_RESPONSE',
                        success: false,
                        error: response.error
                    });
                }
            })
            .catch(error => {
                chrome.runtime.sendMessage({
                    type: 'OLLAMA_RESPONSE',
                    success: false,
                    error: error.message
                });
            });
        return true; // Will respond asynchronously
    }
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
            const healthCheck = await fetch(`${OLLAMA_API}/api/tags`);
            if (!healthCheck.ok) {
                throw new Error('Ollama is not running or not accessible');
            }
        } catch (error) {
            console.error('Ollama connection error:', error);
            throw new Error('Cannot connect to Ollama. Please ensure it is running.');
        }

        // Determine if this is a vision-capable model
        const isVisionModel = model.toLowerCase().includes('vision') || 
                            model.toLowerCase().includes('dream') || 
                            model.toLowerCase().includes('image');
        
        console.log('Model type check:', {
            model: model,
            isVisionModel: isVisionModel,
            hasImage: prompt.includes('<image>')
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

            // Format specifically for Moondream
            requestBody = {
                model: model,
                messages: [{
                    role: "user",
                    content: "describe this image",
                    images: [cleanBase64]
                }],
                stream: false,  // Disable streaming for more reliable responses
                options: {
                    temperature: 0.0,  // Keep temperature at 0 for more consistent responses
                    num_predict: 500   // Ensure we get a complete response
                }
            };

            // Use chat endpoint for vision models
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
                console.error('Ollama error response:', {
                    status: response.status,
                    statusText: response.statusText,
                    error: errorText
                });
                return {
                    success: false,
                    error: `Ollama error: ${response.status} ${response.statusText}\n${errorText}`
                };
            }

            // Handle non-streaming response
            const data = await response.json();
            if (data.message && data.message.content) {
                chrome.runtime.sendMessage({
                    type: 'OLLAMA_RESPONSE',
                    success: true,
                    response: data.message.content,
                    done: true
                });
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
            console.error('Ollama error response:', {
                status: response.status,
                statusText: response.statusText,
                error: errorText
            });
            return {
                success: false,
                error: `Ollama error: ${response.status} ${response.statusText}\n${errorText}`
            };
        }

        let fullResponse = '';
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const {value, done} = await reader.read();
            if (done) break;
            
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
                    console.error('Error parsing JSON:', e);
                }
            }
        }

        return { success: true };
    } catch (error) {
        console.error('Ollama query error:', error);
        return {
            success: false,
            error: error.message || 'Failed to communicate with Ollama'
        };
    } finally {
        clearTimeout(timeoutId);
    }
}

// Handle OpenAI API request
async function handleOpenAIRequest(prompt, model, hasImage = false) {
    try {
        const apiKey = await ApiKeyManager.getApiKey('openai');
        if (!apiKey) {
            throw new Error('OpenAI API key not found');
        }

        // Extract the actual model ID (remove the 'openai:' prefix if present)
        const modelId = model.replace('openai:', '');

        const messages = [];
        if (hasImage) {
            const base64Image = prompt.match(/<image>(.*?)<\/image>/)?.[1];
            const text = prompt.replace(/<image>.*?<\/image>\n?/, '').trim();
            
            messages.push({
                role: 'user',
                content: [
                    { type: 'text', text },
                    base64Image ? {
                        type: 'image_url',
                        image_url: { url: base64Image }
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
                        port.postMessage({
                            type: 'OLLAMA_RESPONSE',
                            success: true,
                            response: content,
                            done: false
                        });
                    }
                } catch (e) {
                    console.warn('Error parsing SSE message:', e);
                }
            }
        }

        port.postMessage({
            type: 'OLLAMA_RESPONSE',
            success: true,
            response: '',
            done: true
        });

    } catch (error) {
        port.postMessage({
            type: 'OLLAMA_RESPONSE',
            success: false,
            error: error.message
        });
    }
} 