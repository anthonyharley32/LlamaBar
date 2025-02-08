// DOM Elements
const chatMessages = document.getElementById('chat-messages');
const userInput = document.getElementById('user-input');
const sendButton = document.getElementById('send-button');
const selectionPopup = document.getElementById('selection-popup');
const selectionText = document.getElementById('selection-text');
const explainButton = document.getElementById('explain-button');
const translateButton = document.getElementById('translate-button');

// Handle user input
function handleUserInput(text) {
    // Add user message to chat
    addMessage('user', text);
    
    // Send message through window message passing
    window.parent.postMessage({
        type: 'QUERY_OLLAMA',
        prompt: text
    }, '*');
}

// Add message to chat
function addMessage(type, text) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}-message`;
    messageDiv.textContent = text;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Listen for messages from the content script
window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'OLLAMA_RESPONSE') {
        if (message.success) {
            addMessage('assistant', message.response);
        } else {
            addMessage('assistant', `Error: ${message.error}`);
        }
    }
});

// Handle send button click
sendButton.addEventListener('click', () => {
    const text = userInput.value.trim();
    if (text) {
        handleUserInput(text);
        userInput.value = '';
    }
});

// Handle enter key
userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendButton.click();
    }
});

// Auto-resize textarea
userInput.addEventListener('input', () => {
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 150) + 'px';
});

// Handle text selection popup
window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'SHOW_SELECTION_POPUP') {
        selectionText.textContent = message.text;
        selectionPopup.style.display = 'block';
    }
});

// Handle explain button
explainButton.addEventListener('click', () => {
    const text = selectionText.textContent;
    handleUserInput(`Please explain this: "${text}"`);
    selectionPopup.style.display = 'none';
});

// Handle translate button
translateButton.addEventListener('click', () => {
    const text = selectionText.textContent;
    handleUserInput(`Please translate this to English: "${text}"`);
    selectionPopup.style.display = 'none';
});

// Close selection popup when clicking outside
document.addEventListener('click', (e) => {
    if (!selectionPopup.contains(e.target)) {
        selectionPopup.style.display = 'none';
    }
}); 