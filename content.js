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
            console.log('🔌 Connected to background script with port:', port);
            
            port.onMessage.addListener((message) => {
                console.log('📥 Content script received message:', {
                    type: message.type,
                    success: message.success,
                    responseLength: message.response?.length,
                    isDone: message.done
                });
                
                if (chrome.runtime.lastError) {
                    console.error('❌ Runtime error in onMessage:', chrome.runtime.lastError);
                    return;
                }
                
                if (sidebarFrame?.contentWindow) {
                    console.log('📤 Forwarding message to sidebar frame:', {
                        messageType: message.type,
                        contentLength: message.response?.length,
                        isDone: message.done
                    });
                    
                    try {
                        sidebarFrame.contentWindow.postMessage(message, '*');
                        console.log('✅ Message forwarded to sidebar');
                    } catch (error) {
                        console.error('❌ Error forwarding message:', error);
                    }
                } else {
                    console.warn('⚠️ No sidebar frame available for message:', {
                        frameExists: !!sidebarFrame,
                        hasContentWindow: !!sidebarFrame?.contentWindow
                    });
                }
            });

            port.onDisconnect.addListener(() => {
                const error = chrome.runtime.lastError;
                console.log('🔌 Connection lost:', error ? error.message : 'unknown reason');
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
            console.error('❌ Failed to establish connection:', error);
            return false;
        }
    }

    // Create and manage sidebar
    function createSidebar() {
        console.log('🎯 Creating sidebar...');
        // Remove existing sidebar if it exists
        if (document.getElementById('ollama-sidebar-frame')) {
            console.log('🗑️ Removing existing sidebar frame');
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
            console.log('✅ Sidebar frame created and appended:', sidebarFrame);
            
            // Clean up on unload
            window.addEventListener('unload', () => {
                if (sidebarFrame) {
                    sidebarFrame.remove();
                    sidebarFrame = null;
                }
            });
        } catch (error) {
            console.error('❌ Failed to create sidebar:', error);
            sidebarFrame = null;
        }
    }

    function toggleSidebar(show) {
        console.log('🔄 Toggling sidebar:', { show });
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
        } else {
            console.warn('⚠️ No sidebar frame available to toggle');
        }
    }

    // Handle messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log('📨 Content script received runtime message:', {
            type: message.type,
            success: message.success,
            responseLength: message.response?.length,
            isDone: message.done
        });
        
        if (message.type === 'TOGGLE_SIDEBAR') {
            toggleSidebar(message.show);
            sendResponse({ success: true });
        } else if (message.type === 'MODEL_RESPONSE') {
            if (sidebarFrame?.contentWindow) {
                console.log('📤 Forwarding model response to sidebar:', {
                    contentLength: message.response?.length,
                    isDone: message.done
                });
                
                try {
                    sidebarFrame.contentWindow.postMessage(message, '*');
                    console.log('✅ Message forwarded to sidebar');
                    sendResponse({ success: true });
                } catch (error) {
                    console.error('❌ Error forwarding message:', error);
                    sendResponse({ success: false, error: error.message });
                }
            } else {
                console.error('❌ No sidebar frame available for message');
                sendResponse({ success: false, error: 'No sidebar frame available' });
            }
        }
        
        return true;
    });

    // Listen for messages from the sidebar iframe
    window.addEventListener('message', (event) => {
        console.log('📥 Content script received window message:', event.data);
        
        // Verify message origin
        if (event.source !== sidebarFrame?.contentWindow) {
            console.log('⚠️ Ignoring message from unknown source');
            return;
        }

        // Handle close sidebar message
        if (event.data.type === 'CLOSE_SIDEBAR') {
            console.log('🚪 Handling close sidebar request');
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
            console.log('🔌 No port connection, attempting to initialize...');
            const connected = initializeConnection();
            if (!connected) {
                console.error('❌ Failed to establish connection');
                event.source.postMessage({
                    type: 'MODEL_RESPONSE',
                    success: false,
                    error: 'Failed to connect to extension. Please refresh the page.'
                }, '*');
                return;
            }
        }

        // Forward message to background script
        try {
            console.log('📤 Forwarding message to background script:', event.data);
            port.postMessage(event.data);
        } catch (error) {
            console.error('❌ Failed to forward message:', error);
            event.source.postMessage({
                type: 'MODEL_RESPONSE',
                success: false,
                error: 'Failed to send message to extension.'
            }, '*');
        }
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