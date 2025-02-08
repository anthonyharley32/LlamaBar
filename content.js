// Only initialize if not already initialized
if (!window.ollamaAssistantInitialized) {
    window.ollamaAssistantInitialized = true;

    // Global variables
    let sidebarFrame = null;
    let port = null;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 3;
    let reconnectTimeout = null;

    // Initialize connection to background script
    function initializeConnection() {
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.error('Max reconnection attempts reached');
            return false;
        }

        try {
            if (port) {
                try {
                    port.disconnect();
                } catch (e) {
                    console.log('Error disconnecting old port:', e);
                }
            }

            port = chrome.runtime.connect({ name: 'content-port' });
            
            port.onMessage.addListener((message) => {
                if (chrome.runtime.lastError) {
                    console.log('Runtime error in onMessage:', chrome.runtime.lastError);
                    return;
                }
                if (sidebarFrame?.contentWindow) {
                    sidebarFrame.contentWindow.postMessage(message, '*');
                }
            });

            port.onDisconnect.addListener(() => {
                const error = chrome.runtime.lastError;
                console.log('Connection lost:', error ? error.message : 'unknown reason');
                port = null;
                
                // Clear any existing reconnect timeout
                if (reconnectTimeout) {
                    clearTimeout(reconnectTimeout);
                }
                
                reconnectAttempts++;
                reconnectTimeout = setTimeout(initializeConnection, Math.min(1000 * reconnectAttempts, 5000));
            });

            // Reset reconnect attempts on successful connection
            reconnectAttempts = 0;
            return true;
        } catch (error) {
            console.error('Failed to establish connection:', error);
            return false;
        }
    }

    // Create and manage sidebar
    function createSidebar() {
        // Remove existing sidebar if it exists
        if (document.getElementById('ollama-sidebar-frame')) {
            document.getElementById('ollama-sidebar-frame').remove();
        }
        
        try {
            sidebarFrame = document.createElement('iframe');
            sidebarFrame.src = chrome.runtime.getURL('sidebar.html');
            sidebarFrame.id = 'ollama-sidebar-frame';
            sidebarFrame.style.cssText = `
                position: fixed;
                top: 0;
                right: -400px;
                width: 400px;
                height: 100%;
                border: none;
                background: white;
                box-shadow: -2px 0 5px rgba(0,0,0,0.2);
                transition: right 0.3s ease;
                z-index: 2147483647;
            `;
            document.body.appendChild(sidebarFrame);
            
            // Clean up on unload
            window.addEventListener('unload', () => {
                if (sidebarFrame) {
                    sidebarFrame.remove();
                    sidebarFrame = null;
                }
            });
        } catch (error) {
            console.error('Failed to create sidebar:', error);
            sidebarFrame = null;
        }
    }

    function toggleSidebar(show) {
        if (!sidebarFrame || !document.getElementById('ollama-sidebar-frame')) {
            createSidebar();
        }
        if (sidebarFrame) {
            sidebarFrame.style.right = show ? '0' : '-400px';
            // Notify background script of sidebar state change
            chrome.runtime.sendMessage({
                type: 'SIDEBAR_STATE_CHANGED',
                isVisible: show
            });
        }
    }

    // Listen for messages from the sidebar iframe
    window.addEventListener('message', (event) => {
        // Verify message origin
        if (event.source !== sidebarFrame?.contentWindow) {
            return;
        }

        // Handle close sidebar message
        if (event.data.type === 'CLOSE_SIDEBAR') {
            if (sidebarFrame) {
                sidebarFrame.style.right = '-400px';
                // Wait for transition to complete before removing
                setTimeout(() => {
                    if (sidebarFrame && sidebarFrame.parentNode) {
                        sidebarFrame.parentNode.removeChild(sidebarFrame);
                        sidebarFrame = null;
                    }
                }, 300); // Match the transition duration from CSS
            }
            // Notify background script
            chrome.runtime.sendMessage({
                type: 'SIDEBAR_STATE_CHANGED',
                isVisible: false
            });
            return;
        }

        // Ensure we have a connection
        if (!port) {
            const connected = initializeConnection();
            if (!connected) {
                event.source.postMessage({
                    type: 'OLLAMA_RESPONSE',
                    success: false,
                    error: 'Failed to connect to extension. Please refresh the page.'
                }, '*');
                return;
            }
        }

        // Forward message to background script
        try {
            port.postMessage(event.data);
        } catch (error) {
            console.error('Failed to forward message:', error);
            event.source.postMessage({
                type: 'OLLAMA_RESPONSE',
                success: false,
                error: 'Failed to send message to extension.'
            }, '*');
        }
    });

    // Handle messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'TOGGLE_SIDEBAR') {
            toggleSidebar(message.show);
            // Send response immediately
            sendResponse({ success: true });
        }
        // Don't return true since we're not using async response
        return false;
    });

    // Handle text selection with debouncing
    let selectionTimeout = null;
    document.addEventListener('mouseup', () => {
        if (selectionTimeout) {
            clearTimeout(selectionTimeout);
        }
        
        selectionTimeout = setTimeout(() => {
            const selectedText = window.getSelection().toString().trim();
            if (selectedText && port) {
                try {
                    port.postMessage({
                        type: 'TEXT_SELECTED',
                        text: selectedText
                    });
                } catch (error) {
                    console.error('Failed to send selected text:', error);
                }
            }
        }, 200); // Debounce selection events
    });

    // Initialize connection only if not in a background/cached page
    if (document.visibilityState !== 'hidden') {
        initializeConnection();
    }

    // Handle visibility changes
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            initializeConnection();
        }
    });

    // Notify background script that content script is ready
    if (port) {
        try {
            port.postMessage({ type: 'CONTENT_SCRIPT_READY' });
        } catch (error) {
            console.error('Failed to send ready message:', error);
        }
    }
} 