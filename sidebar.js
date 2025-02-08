// DOM Elements
const chatMessages = document.getElementById('chat-messages');
const userInput = document.getElementById('user-input');
const sendButton = document.getElementById('send-button');
const selectionPopup = document.getElementById('selection-popup');
const selectionText = document.getElementById('selection-text');
const explainButton = document.getElementById('explain-button');
const translateButton = document.getElementById('translate-button');
const closeButton = document.getElementById('close-button');

let currentAssistantMessage = null;

// Handle user input
function handleUserInput(text) {
    // Add user message to chat
    addMessage('user', text);
    
    // Reset currentAssistantMessage to ensure a new response element is created
    currentAssistantMessage = null;
    
    // Send message to background script
    chrome.runtime.sendMessage({
        type: 'QUERY_OLLAMA',
        prompt: text
    });
}

// Add message to chat
function addMessage(type, text) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}-message`;
    
    if (type === 'assistant') {
        // For assistant messages, we might want to format them
        messageDiv.innerHTML = text;
    } else {
        messageDiv.textContent = text;
    }
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Auto-resize textarea
function autoResizeTextarea() {
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 150) + 'px';
}

// Event Listeners
sendButton.addEventListener('click', () => {
    const text = userInput.value.trim();
    if (text) {
        handleUserInput(text);
        userInput.value = '';
        autoResizeTextarea();
    }
});

userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendButton.click();
    }
});

userInput.addEventListener('input', autoResizeTextarea);

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'OLLAMA_RESPONSE') {
        if (message.success) {
            if (!currentAssistantMessage) {
                currentAssistantMessage = document.createElement('div');
                currentAssistantMessage.className = 'message assistant-message';
                chatMessages.appendChild(currentAssistantMessage);
            }
            currentAssistantMessage.textContent = message.response;
            chatMessages.scrollTop = chatMessages.scrollHeight;
            
            if (message.done) {
                currentAssistantMessage = null;
            }
        } else {
            addMessage('assistant', `Error: ${message.error}`);
        }
    }
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

// Add close button functionality
closeButton.addEventListener('click', () => {
    window.close();
}); 