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
const explainButtonContainer = document.getElementById('explain-button-container');
const inputExplainButton = document.getElementById('input-explain-button');
const markdownToggle = document.getElementById('markdown-toggle');

let currentAssistantMessage = null;
let currentModel = 'llama3.2:1b';
let currentImage = null;
let setupWizardFrame = null;
let markdownEnabled = false;

// Initialize markdown toggle
markdownToggle.addEventListener('change', (e) => {
    markdownEnabled = e.target.checked;
});

// Check setup status
async function checkSetupStatus() {
    try {
        const response = await fetch('http://localhost:11434/api/version');
        if (!response.ok) {
            showSetupWizard();
            return false;
        }
        
        // Check if required model is available
        const modelResponse = await fetch('http://localhost:11434/api/tags');
        if (!modelResponse.ok) {
            showSetupWizard();
            return false;
        }
        
        const data = await modelResponse.json();
        if (!data.models.some(model => model.name === currentModel)) {
            showSetupWizard();
            return false;
        }
        
        return true;
    } catch (error) {
        console.error('Setup check failed:', error);
        showSetupWizard();
        return false;
    }
}

// Show setup wizard
function showSetupWizard() {
    if (setupWizardFrame) return;
    
    setupWizardFrame = document.createElement('iframe');
    setupWizardFrame.src = chrome.runtime.getURL('components/setup-wizard.html');
    setupWizardFrame.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        border: none;
        background: white;
        z-index: 1000;
    `;
    document.body.appendChild(setupWizardFrame);
}

// Listen for setup completion
window.addEventListener('message', (event) => {
    if (event.data.type === 'SETUP_COMPLETE') {
        if (setupWizardFrame) {
            setupWizardFrame.remove();
            setupWizardFrame = null;
            // Reinitialize after setup
            initializeModelSelector();
        }
    }
});

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
        // Show setup wizard if there's an error
        showSetupWizard();
    }
}

// Model selection change handler
modelSelector.addEventListener('change', (e) => {
    currentModel = e.target.value;
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

// Add message to chat
function addMessage(type, content) {
    // Hide welcome message when first message is added
    const welcomeMessage = document.querySelector('.welcome-message');
    if (welcomeMessage) {
        welcomeMessage.style.opacity = '0';
        welcomeMessage.style.transition = 'opacity 0.3s ease';
        setTimeout(() => welcomeMessage.remove(), 300);
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}-message`;
    
    if (type === 'assistant' && !content) {
        // For streaming messages, start with an empty paragraph
        const p = document.createElement('p');
        messageDiv.appendChild(p);
    } else {
        messageDiv.innerHTML = content;
    }
    
    chatMessages.appendChild(messageDiv);
    
    // Smooth scroll to bottom
    requestAnimationFrame(() => {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });
    
    return messageDiv;
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
    
    // Create a new assistant message div that will be updated with streaming content
    currentAssistantMessage = addMessage('assistant', '');
    
    // Check if current model supports vision
    const isVisionModel = currentModel.toLowerCase().includes('vision') || 
                         currentModel.toLowerCase().includes('dream') || 
                         currentModel.toLowerCase().includes('image');
    
    // Prepare the prompt based on whether there's an image and markdown mode
    let prompt = text;
    if (currentImage) {
        if (isVisionModel) {
            console.log('Preparing vision model request');
            const base64Data = currentImage.split(',')[1] || currentImage;
            prompt = `<image>data:image/jpeg;base64,${base64Data}</image>\n${text}`;
        } else {
            console.warn('Attempting to use image with non-vision model:', currentModel);
            prompt = `[Image]\n${text}`;
        }
    }
    
    // Add markdown instruction if enabled
    if (markdownEnabled) {
        prompt = `Please format your response in Markdown.\n\n${prompt}`;
    }
    
    console.log('Sending query:', {
        modelType: isVisionModel ? 'vision' : 'text',
        hasImage: !!currentImage,
        model: currentModel,
        markdownEnabled
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
            if (currentAssistantMessage) {
                // Get the previous response length
                const prevResponse = currentAssistantMessage.textContent;
                const newResponse = message.response;
                
                // Only append the new content
                if (newResponse.length > prevResponse.length) {
                    const newContent = newResponse.slice(prevResponse.length);
                    
                    if (markdownEnabled && message.done) {
                        // If it's the final message and markdown is enabled, parse the entire response
                        currentAssistantMessage.innerHTML = marked.parse(newResponse);
                    } else if (markdownEnabled) {
                        // For streaming, accumulate the text content
                        currentAssistantMessage.textContent = newResponse;
                    } else {
                        // For non-markdown responses, handle as before
                        const textNode = document.createTextNode(newContent);
                        currentAssistantMessage.appendChild(textNode);
                    }
                    
                    // Smooth scroll to bottom without causing reflow
                    requestAnimationFrame(() => {
                        const shouldScroll = chatMessages.scrollTop + chatMessages.clientHeight >= chatMessages.scrollHeight - 10;
                        if (shouldScroll) {
                            chatMessages.scrollTop = chatMessages.scrollHeight;
                        }
                    });
                }
            }
            
            if (message.done) {
                if (markdownEnabled && currentAssistantMessage) {
                    // Parse the complete message with markdown
                    currentAssistantMessage.innerHTML = marked.parse(currentAssistantMessage.textContent);
                }
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

// Handle input changes for explain button visibility
userInput.addEventListener('input', () => {
    const text = userInput.value.trim();
    explainButtonContainer.style.display = text ? 'block' : 'none';
    autoResizeTextarea();
});

// Handle explain button click
inputExplainButton.addEventListener('click', () => {
    const text = userInput.value.trim();
    if (text) {
        const systemPrompt = `You are an expert educator and communicator. Your task is to:
1. Break down the concept or text in simple terms
2. Provide relevant examples or analogies
3. Highlight key points or terminology
4. Explain any underlying principles or context
5. Address potential misconceptions
6. Conclude with practical takeaways

Remember to be clear, engaging, and thorough while maintaining accessibility for learners at any level.

Text to explain: "${text}"

Let's break this down:`;

        handleUserInput(text);
        // Send the system prompt separately
        chrome.runtime.sendMessage({
            type: 'QUERY_OLLAMA',
            prompt: systemPrompt,
            model: currentModel
        });
        
        userInput.value = '';
        explainButtonContainer.style.display = 'none';
        autoResizeTextarea();
    }
});

// Initial setup check
window.addEventListener('load', async () => {
    const isSetup = await checkSetupStatus();
    if (isSetup) {
        initializeModelSelector();
    }
});

// Settings menu functionality
const settingsButton = document.getElementById('settings-button');
const settingsMenu = document.getElementById('settings-menu');
const launchLocalButton = document.getElementById('launch-local');
const addApiKeyButton = document.getElementById('add-api-key');

// Toggle settings menu
settingsButton.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsMenu.classList.toggle('show');
});

// Close menu when clicking outside
document.addEventListener('click', (e) => {
    if (!settingsMenu.contains(e.target) && !settingsButton.contains(e.target)) {
        settingsMenu.classList.remove('show');
    }
});

// Launch local handler
launchLocalButton.addEventListener('click', () => {
    // Store the command for later use
    const command = 'OLLAMA_ORIGINS="chrome-extension://*" ollama serve';
    // You can implement the actual launch functionality here
    console.log('Launch local command:', command);
    settingsMenu.classList.remove('show');
});

// Add API key handler
addApiKeyButton.addEventListener('click', () => {
    // Implement API key functionality here
    console.log('Add API key clicked');
    settingsMenu.classList.remove('show');
}); 