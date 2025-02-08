// DOM Elements
const chatMessages = document.getElementById('chat-messages');
const userInput = document.getElementById('user-input');
const sendButton = document.getElementById('send-button');
const selectionPopup = document.getElementById('selection-popup');
const selectionText = document.getElementById('selection-text');
const explainButton = document.getElementById('explain-button');
const translateButton = document.getElementById('translate-button');
const modelSelector = document.getElementById('model-selector');
const imagePreview = document.getElementById('image-preview');

let currentAssistantMessage = null;
let currentModel = 'llama3.2:1b';
let currentImage = null;

// Initialize model selector
async function initializeModelSelector() {
    try {
        const response = await fetch('http://localhost:11434/api/tags');
        if (!response.ok) {
            throw new Error('Failed to fetch models');
        }
        const data = await response.json();
        
        // Clear loading option
        modelSelector.innerHTML = '';
        
        // Add available models
        data.models.forEach(model => {
            const option = document.createElement('option');
            option.value = model.name;
            option.textContent = model.name;
            if (model.name === currentModel) {
                option.selected = true;
            }
            modelSelector.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading models:', error);
        modelSelector.innerHTML = '<option value="error">Error loading models</option>';
    }
}

// Model selection change handler
modelSelector.addEventListener('change', (e) => {
    currentModel = e.target.value;
    // Add a system message about model change
    addMessage('assistant', `Switched to ${currentModel} model`);
});

// Handle image paste
async function handleImagePaste(e) {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    
    for (const item of items) {
        if (item.type.indexOf('image') === 0) {
            e.preventDefault();
            const blob = item.getAsFile();
            const reader = new FileReader();
            
            reader.onload = function(event) {
                const base64Image = event.target.result;
                displayImagePreview(base64Image);
                currentImage = base64Image;
            };
            
            reader.readAsDataURL(blob);
            break;
        }
    }
}

// Display image preview
function displayImagePreview(base64Image) {
    imagePreview.innerHTML = `
        <img src="${base64Image}" alt="Pasted image">
        <button class="remove-image" onclick="removeImage()">×</button>
    `;
    imagePreview.classList.add('active');
}

// Remove image
window.removeImage = function() {
    imagePreview.innerHTML = '';
    imagePreview.classList.remove('active');
    currentImage = null;
}

// Handle user input
function handleUserInput(text) {
    // Create message content
    let messageContent = text;
    if (currentImage) {
        // Add image to message if present
        messageContent = `<div>${text}</div><img src="${currentImage}" alt="User uploaded image">`;
    }
    
    // Add user message to chat
    addMessage('user', messageContent);
    
    // Reset currentAssistantMessage to ensure a new response element is created
    currentAssistantMessage = null;
    
    // Check if current model supports vision
    const isVisionModel = currentModel.toLowerCase().includes('vision') || 
                         currentModel.toLowerCase().includes('dream') || 
                         currentModel.toLowerCase().includes('image');
    
    // Prepare the prompt based on whether there's an image
    let prompt = text;
    if (currentImage) {
        if (isVisionModel) {
            console.log('Preparing vision model request');
            // Remove the data:image/[type];base64, prefix if present
            const base64Data = currentImage.split(',')[1] || currentImage;
            prompt = `<image>data:image/jpeg;base64,${base64Data}</image>\n${text}`;
        } else {
            console.warn('Attempting to use image with non-vision model:', currentModel);
            // For other models that might handle images differently
            prompt = `[Image]\n${text}`;
        }
    }
    
    console.log('Sending query:', {
        modelType: isVisionModel ? 'vision' : 'text',
        hasImage: !!currentImage,
        model: currentModel
    });
    
    // Send message to background script with current model
    chrome.runtime.sendMessage({
        type: 'QUERY_OLLAMA',
        prompt: prompt,
        model: currentModel,
        hasImage: !!currentImage
    });
    
    // Clear image after sending
    if (currentImage) {
        removeImage();
    }
}

// Add message to chat
function addMessage(type, content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}-message`;
    messageDiv.innerHTML = content;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Auto-resize textarea
function autoResizeTextarea() {
    // Reset height to auto to get the correct scrollHeight
    userInput.style.height = 'auto';
    
    // Set to scrollHeight but cap at 200px
    const newHeight = Math.min(userInput.scrollHeight, 200);
    userInput.style.height = newHeight + 'px';
    
    // If content is larger than max height, enable scrolling
    userInput.style.overflowY = userInput.scrollHeight > 200 ? 'auto' : 'hidden';
}

// Event Listeners
userInput.addEventListener('paste', handleImagePaste);
userInput.addEventListener('input', autoResizeTextarea);
// Add resize on focus to handle initial content
userInput.addEventListener('focus', autoResizeTextarea);

sendButton.addEventListener('click', () => {
    const text = userInput.value.trim();
    if (text || currentImage) {
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

// Initialize the model selector when the sidebar loads
initializeModelSelector(); 