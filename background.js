// State management
let isSidebarVisible = false;
let connections = new Map();
let injectedTabs = new Set();

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

// Handle extension icon click
chrome.action.onClicked.addListener(async (tab) => {
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
        console.warn('Cannot inject scripts into browser system pages');
        return;
    }

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
        console.error('Failed to inject content script:', error);
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

// Handle long-lived connections
chrome.runtime.onConnect.addListener((port) => {
    const tabId = port.sender.tab.id;
    const connection = createConnection(tabId);
    connection.port = port;
    connection.isActive = true;

    console.log('Connection established with tab:', tabId);

    port.onMessage.addListener(async (message) => {
        if (message.type === 'QUERY_OLLAMA') {
            try {
                const response = await handleOllamaQuery(message.prompt, tabId);
                if (!response.success) {
                    port.postMessage({ 
                        type: 'OLLAMA_RESPONSE',
                        success: false,
                        error: response.error 
                    });
                }
            } catch (error) {
                port.postMessage({ 
                    type: 'OLLAMA_RESPONSE',
                    success: false,
                    error: error.message 
                });
            }
        }
    });

    port.onDisconnect.addListener(() => {
        console.log('Connection closed with tab:', tabId);
        connection.isActive = false;
        connection.port = null;
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
        handleOllamaQuery(message.prompt)
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

// Function to communicate with Ollama
async function handleOllamaQuery(prompt) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
        // First check if Ollama is running
        try {
            const healthCheck = await fetch('http://localhost:11434/api/tags');
            if (!healthCheck.ok) {
                throw new Error('Ollama is not running or not accessible');
            }
        } catch (error) {
            throw new Error('Cannot connect to Ollama. Please ensure it is running on port 11434');
        }

        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama3.2:1b',
                prompt: prompt,
                stream: true,
                options: {
                    temperature: 0.7,
                    top_k: 50,
                    top_p: 0.95,
                    repeat_penalty: 1.1
                }
            })
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Ollama error response:', errorText);
            return {
                success: false,
                error: `Ollama error: ${response.status} ${response.statusText}`
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