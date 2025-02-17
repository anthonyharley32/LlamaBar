console.log('🔍 Script tag loaded');

// Move imports to top
import { ApiKeyManager } from './utils/api-key-manager.js';
import { ApiService } from './utils/api-service.js';

console.log('✅ Imports successful');
console.log('🚀 Sidebar script starting...');

// Wrap initialization in error handler
try {
    // DOM Elements
    const chatMessages = document.getElementById('chat-messages');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const selectionPopup = document.getElementById('selection-popup');
    const selectionText = document.getElementById('selection-text');
    const explainButton = document.getElementById('explain-button');
    const translateButton = document.getElementById('translate-button');
    const modelSelector = document.getElementById('model-selector');
    const ollamaLogo = document.getElementById('ollama-logo');
    const imagePreview = document.getElementById('image-preview');
    const explainButtonContainer = document.getElementById('explain-button-container');
    const inputExplainButton = document.getElementById('input-explain-button');
    const markdownToggle = document.getElementById('markdown-toggle');

    console.log('📦 DOM elements initialized:', {
        hasChatMessages: !!chatMessages,
        hasUserInput: !!userInput,
        hasSendButton: !!sendButton,
        hasModelSelector: !!modelSelector
    });

    let currentAssistantMessage = null;
    let currentModel = 'local:llama3.2:3b';  // Initialize with local: prefix
    let currentImage = null;
    let setupWizardFrame = null;
    let markdownEnabled = false;

    // Initialize markdown toggle
    markdownToggle.addEventListener('change', (e) => {
        markdownEnabled = e.target.checked;
        console.log('🔄 Markdown toggle changed:', markdownEnabled);
    });

    // Add a test message to verify the chat container is working
    console.log('🧪 Testing message display...');
    const testMessage = addMessage('assistant', 'Initializing chat...');
    console.log('✅ Test message added:', testMessage);
    // Remove the test message after 1 second
    setTimeout(() => {
        testMessage.remove();
        console.log('🧹 Test message removed');
    }, 1000);

    // Function to check if a model is local (Ollama-based)
    function isLocalModel(modelName) {
        if (modelName.startsWith('local:')) return true;
        
        // Add more local model prefixes as needed
        const localPrefixes = ['llama', 'mistral', 'codellama', 'phi', 'neural-chat', 'starling', 'yi', 'stable-code', 'qwen', 'moondream'];
        const modelNameWithoutPrefix = modelName.replace('local:', '');
        return localPrefixes.some(prefix => modelNameWithoutPrefix.toLowerCase().startsWith(prefix.toLowerCase()));
    }

    // Check setup status
    async function checkSetupStatus() {
        try {
            console.log('Checking Ollama server status...');
            const response = await fetch('http://localhost:11434/api/version');
            if (!response.ok) {
                console.error('Ollama server not responding:', response.status);
                showSetupWizard();
                return false;
            }
            
            console.log('Checking available models...');
            const modelResponse = await fetch('http://localhost:11434/api/tags');
            if (!modelResponse.ok) {
                console.error('Failed to fetch models:', modelResponse.status);
                showSetupWizard();
                return false;
            }
            
            const data = await modelResponse.json();
            console.log('Available models:', data.models);
            
            // Check for model without local: prefix
            const modelWithoutPrefix = currentModel.replace('local:', '');
            if (!data.models.some(model => model.name === modelWithoutPrefix)) {
                console.warn('Current model not found:', modelWithoutPrefix);
                showSetupWizard();
                return false;
            }
            
            console.log('Setup check completed successfully');
            return true;
        } catch (error) {
            console.error('Setup check failed:', error);
            showSetupWizard();
            return false;
        }
    }

    // Show setup wizard
    function showSetupWizard() {
        console.log('Showing setup wizard');
        if (setupWizardFrame) {
            console.log('Setup wizard already showing');
            return;
        }
        
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
        console.log('Setup wizard frame added to document');
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

    // Add toast styles to show feedback
    const style = document.createElement('style');
    style.textContent = `
        .toast {
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            padding: 12px 24px;
            border-radius: 6px;
            color: white;
            font-size: 14px;
            z-index: 1000;
            animation: fadeInOut 3s ease;
        }
        
        .toast.success {
            background: #4caf50;
        }
        
        .toast.error {
            background: #f44336;
        }
        
        @keyframes fadeInOut {
            0% { opacity: 0; transform: translate(-50%, 20px); }
            10% { opacity: 1; transform: translate(-50%, 0); }
            90% { opacity: 1; transform: translate(-50%, 0); }
            100% { opacity: 0; transform: translate(-50%, -20px); }
        }

        .api-provider.has-key .provider-info::after {
            content: "✓";
            color: #4caf50;
            margin-left: auto;
            font-weight: bold;
        }

        .remove-key {
            background: #f44336;
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            margin-left: 8px;
            display: none;
        }

        .api-provider.has-key .remove-key {
            display: inline-block;
        }

        .remove-key:hover {
            background: #d32f2f;
        }
    `;
    document.head.appendChild(style);

    // Show toast messages
    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        
        // Remove toast after animation
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    // Initialize when page loads
    document.addEventListener('DOMContentLoaded', async () => {
        try {
            // Add click handlers for save buttons
            document.querySelectorAll('.save-key').forEach(button => {
                button.addEventListener('click', async (e) => {
                    const provider = e.target.closest('.api-provider').querySelector('.key-input').dataset.provider;
                    await handleApiKeySave(provider);
                });
            });

            // Add click handlers for remove buttons
            document.querySelectorAll('.remove-key').forEach(button => {
                button.addEventListener('click', async (e) => {
                    const provider = e.target.closest('.api-provider').querySelector('.key-input').dataset.provider;
                    await handleApiKeyRemove(provider);
                });
            });

            // Add enter key handler for input fields
            document.querySelectorAll('.key-input').forEach(input => {
                input.addEventListener('keypress', async (e) => {
                    if (e.key === 'Enter') {
                        const provider = input.dataset.provider;
                        await handleApiKeySave(provider);
                    }
                });
            });

            // Initialize provider statuses
            const providers = ['openai', 'anthropic', 'openrouter', 'perplexity', 'gemini'];
            for (const provider of providers) {
                await updateProviderStatus(provider);
            }
            
            // Initialize model selector and setup wizard
            const isSetup = await checkSetupStatus();
            if (isSetup) {
                await initializeModelSelector();
            }
            
            addEditModelsButton();
        } catch (error) {
            console.error('Initialization error:', error);
            showToast('Failed to initialize. Please check if Ollama is running.', 'error');
        }
    });

    // Update the handleApiKeySave function to properly show/hide UI elements
    async function handleApiKeySave(provider) {
        const input = document.querySelector(`input[data-provider="${provider}"]`);
        if (!input || !input.value.trim()) {
            showToast('Please enter an API key', 'error');
            return;
        }

        const apiKeyInput = input.closest('.api-key-input');
        const saveButton = apiKeyInput.querySelector('.save-key');
        const originalText = saveButton.textContent;

        try {
            const apiKey = input.value.trim();
            
            // Show loading state
            saveButton.textContent = 'Validating...';
            saveButton.disabled = true;

            // First validate the key
            const isValid = await validateApiKey(provider, apiKey);
            if (!isValid) {
                throw new Error('Invalid API key format');
            }
            
            // Save the key if validation passed
            await ApiKeyManager.saveApiKey(provider, apiKey);
            
            // Get available models
            const models = await getProviderModels(provider);
            if (!models || models.length === 0) {
                throw new Error('No models available for this API key');
            }
            
            // Update checkmark
            await updateProviderStatus(provider);
            showToast(`${provider} API key saved successfully!`);
            
            // Save all models as enabled by default
            await ApiKeyManager.saveEnabledModels(provider, models.map(m => m.id));
            
            // Update the model selector
            await initializeModelSelector();
            
            // Close the dropdown
            apiKeyInput.classList.remove('show');
            
        } catch (error) {
            console.error(`Error saving API key for ${provider}:`, error);
            showToast(`Error: ${error.message}`, 'error');
            saveButton.textContent = originalText;
            saveButton.disabled = false;
            // Remove the API key and checkmark if validation failed
            await ApiKeyManager.deleteApiKey(provider);
            await updateProviderStatus(provider);
        }
    }

    // Validate API key and fetch available models
    async function validateApiKey(provider, apiKey) {
        switch (provider) {
            case 'openai':
                const response = await fetch('https://api.openai.com/v1/models', {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    credentials: 'omit'
                });
                
                if (!response.ok) {
                    if (response.status === 401) {
                        throw new Error('Invalid API key');
                    }
                    throw new Error(`API error: ${response.status}`);
                }
                
                const data = await response.json();
                const availableModels = data.data.filter(model => {
                    const id = model.id.toLowerCase();
                    return (
                        id.startsWith('o') ||
                        id.includes('gpt-4o') ||
                        id.includes('gpt-4') ||
                        id.includes('gpt-3.5') ||
                        id.match(/gpt-[5-9]/)
                    ) && !id.includes('instruct');
                });
                
                if (availableModels.length === 0) {
                    throw new Error('No supported models available for this API key');
                }
                
                return true;
                
            // Add other providers here
            default:
                throw new Error('Provider not supported');
        }
    }

    async function updateProviderStatus(provider) {
        const hasKey = await ApiKeyManager.hasApiKey(provider);
        const providerElement = document.querySelector(`.api-provider[data-provider="${provider}"]`);
        if (providerElement) {
            providerElement.classList.toggle('has-key', hasKey);
        }
    }

    // Update model selector to include API models
    async function initializeModelSelector() {
        try {
            console.log('Initializing model selector...');
            // Clear existing options
            modelSelector.innerHTML = '';
            
            // Get local models from Ollama
            try {
                const response = await fetch('http://localhost:11434/api/tags');
                if (response.ok) {
                    const data = await response.json();
                    console.log('Local models found:', data.models);
                    
                    // Add local models
                    const localModelsOptgroup = document.createElement('optgroup');
                    localModelsOptgroup.label = 'Local Models';
                    data.models.forEach(model => {
                        const option = document.createElement('option');
                        option.value = `local:${model.name}`;  // Keep full model name after local: prefix
                        option.textContent = model.name;
                        if (option.value === currentModel) {
                            option.selected = true;
                        }
                        localModelsOptgroup.appendChild(option);
                    });
                    modelSelector.appendChild(localModelsOptgroup);
                }
            } catch (error) {
                console.warn('Could not fetch local models:', error);
            }
            
            // Add API models based on saved keys
            const providers = await ApiKeyManager.getAllProviders();
            console.log('Found providers with keys:', providers);
            
            if (providers.length > 0) {
                const apiModelsOptgroup = document.createElement('optgroup');
                apiModelsOptgroup.label = 'API Models';
                
                // Add models for each provider
                for (const provider of providers) {
                    console.log(`Fetching models for ${provider}...`);
                    const enabledModels = await ApiKeyManager.getEnabledModels(provider);
                    console.log(`Enabled models for ${provider}:`, enabledModels);
                    
                    if (enabledModels.length > 0) {
                        const availableModels = await getProviderModels(provider);
                        console.log(`Available models for ${provider}:`, availableModels);
                        
                        if (!availableModels || availableModels.length === 0) {
                            console.error(`No available models found for ${provider}`);
                            continue;
                        }
                        
                        const filteredModels = availableModels.filter(model => enabledModels.includes(model.id));
                        console.log(`Filtered models for ${provider}:`, filteredModels);
                        
                        filteredModels.forEach(model => {
                            const option = document.createElement('option');
                            option.value = `${provider}:${model.id}`;
                            option.textContent = `${model.name} (${provider})`;
                            if (option.value === currentModel) {
                                option.selected = true;
                            }
                            apiModelsOptgroup.appendChild(option);
                        });
                    }
                }
                
                if (apiModelsOptgroup.children.length > 0) {
                    modelSelector.appendChild(apiModelsOptgroup);
                }
            }
            
            // If no models are available, show error
            if (modelSelector.children.length === 0) {
                console.error('No models available in selector');
                const option = document.createElement('option');
                option.value = 'none';
                option.textContent = 'No models available';
                modelSelector.appendChild(option);
                showToast('No models available. Please check your configuration.', 'error');
            }
            
            // Update Ollama logo visibility based on provider
            const [provider] = currentModel.split(':');
            ollamaLogo.style.display = provider === 'local' ? 'block' : 'none';
            
        } catch (error) {
            console.error('Error initializing model selector:', error);
            modelSelector.innerHTML = '<option value="error">Error loading models</option>';
            ollamaLogo.style.display = 'none';
            showToast('Failed to load models. Please check your configuration.', 'error');
        }
    }

    // Get available models for each provider
    async function getProviderModels(provider) {
        if (provider === 'openai') {
            try {
                const apiKey = await ApiKeyManager.getApiKey('openai');
                if (!apiKey) {
                    console.error('OpenAI API key not found');
                    return [];
                }

                console.log('Fetching OpenAI models...');
                const response = await fetch('https://api.openai.com/v1/models', {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    credentials: 'omit'
                });

                if (!response.ok) {
                    console.error('Failed to fetch OpenAI models:', response.status);
                    return [];
                }

                const data = await response.json();
                
                // Filter for all supported model families
                const supportedModels = data.data.filter(model => {
                    const id = model.id.toLowerCase();
                    // Include all current and future model families
                    return (
                        // o-series models (reasoning models)
                        id.startsWith('o') ||
                        // GPT-4o (Omni) models
                        id.includes('gpt-4o') ||
                        // GPT-4 models (including Turbo and Vision)
                        id.includes('gpt-4') ||
                        // GPT-3.5 models
                        id.includes('gpt-3.5') ||
                        // Future GPT models (5+)
                        id.match(/gpt-[5-9]/)
                    ) && (
                        // Exclude instruction-only models
                        !id.includes('instruct')
                    );
                }).map(model => ({
                    id: model.id,
                    // Keep version numbers and capabilities in the display name
                    name: model.id
                        .replace(/^gpt-/i, 'GPT-')  // Capitalize GPT
                        .replace(/^o([0-9])/, 'O$1')  // Capitalize O-series
                        .replace(/-/g, ' ')  // Replace hyphens with spaces
                        .trim()
                }));
                
                console.log('Available OpenAI models:', supportedModels);
                return supportedModels;
            } catch (error) {
                console.error('Error fetching OpenAI models:', error);
                return [];
            }
        }

        // Fallback static lists for other providers
        const models = {
            anthropic: [
                { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
                { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet' },
                { id: 'claude-2.1', name: 'Claude 2.1' }
            ],
            openrouter: [
                { id: 'openai/gpt-4-turbo-preview', name: 'GPT-4 Turbo (OpenRouter)' },
                { id: 'anthropic/claude-3-opus', name: 'Claude 3 Opus (OpenRouter)' },
                { id: 'google/gemini-pro', name: 'Gemini Pro (OpenRouter)' }
            ],
            perplexity: [
                { id: 'pplx-70b-online', name: 'Perplexity 70B' },
                { id: 'pplx-7b-online', name: 'Perplexity 7B' }
            ],
            gemini: [
                { id: 'gemini-pro', name: 'Gemini Pro' },
                { id: 'gemini-pro-vision', name: 'Gemini Pro Vision' }
            ]
        };
        
        return models[provider] || [];
    }

    // Update model selection handler
    modelSelector.addEventListener('change', async (e) => {
        currentModel = e.target.value;
        console.log('Model changed to:', currentModel);
        
        // Update Ollama logo visibility
        ollamaLogo.style.display = currentModel.startsWith('local:') ? 'block' : 'none';
        
        // Verify API key if needed
        if (!currentModel.startsWith('local:')) {
            const [provider] = currentModel.split(':');
            const hasKey = await ApiKeyManager.hasApiKey(provider);
            if (!hasKey) {
                showToast(`Please add your ${provider} API key first`, 'error');
                // Reset to previous selection
                initializeModelSelector();
                return;
            }
        }
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
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}-message`;
        
        if (type === 'assistant') {
            // Clear any existing currentAssistantMessage
            if (currentAssistantMessage) {
                currentAssistantMessage.style.marginBottom = '16px';
            }
            currentAssistantMessage = messageDiv;
        } else {
            // For user messages, ensure proper spacing
            if (currentAssistantMessage) {
                currentAssistantMessage.style.marginBottom = '16px';
            }
        }
        
        // Handle markdown formatting if enabled
        if (type === 'assistant' && markdownEnabled && typeof marked !== 'undefined') {
            try {
                messageDiv.innerHTML = marked.parse(content);
            } catch (error) {
                console.error('Markdown parsing failed:', error);
                messageDiv.textContent = content;
            }
        } else {
            messageDiv.textContent = content;
        }
        
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        
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
        const modelName = currentModel.replace('local:', '');
        const isVisionModel = modelName.toLowerCase().includes('vision') || 
                             modelName.toLowerCase().includes('dream') || 
                             modelName.toLowerCase().includes('image');
        
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
            model: currentModel,
            modelType: isVisionModel ? 'vision' : 'text',
            hasImage: !!currentImage,
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

    // Single function to handle message updates
    function handleModelResponse(message) {
        console.log('🎯 Handling model response:', {
            success: message.success,
            contentLength: message.response?.length,
            isDone: message.done,
            hasError: !!message.error
        });

        if (!message.success) {
            console.error('❌ Model response error:', message.error);
            showError(message.error || 'An error occurred while generating the response');
            return;
        }

        if (!message.response && !message.error) {
            console.warn('⚠️ Empty response received');
            return;
        }

        try {
            const chatContainer = document.getElementById('chat-messages');
            
            // Create new message if none exists
            if (!currentAssistantMessage) {
                // First, ensure proper spacing by adding margin to the last message
                const messages = chatContainer.querySelectorAll('.message');
                if (messages.length > 0) {
                    const lastMessage = messages[messages.length - 1];
                    lastMessage.style.marginBottom = '16px';
                }

                console.log('📝 Creating new assistant message');
                currentAssistantMessage = addMessage('assistant');
                currentAssistantMessage.dataset.content = '';
                
                // Ensure the new message is properly positioned
                currentAssistantMessage.style.position = 'relative';
                currentAssistantMessage.style.marginTop = '16px';
                currentAssistantMessage.style.marginBottom = '16px';
                
                if (!currentAssistantMessage) {
                    throw new Error('Failed to create assistant message element');
                }
            }

            // Get or create paragraph element
            let p = currentAssistantMessage.querySelector('p');
            if (!p) {
                console.log('📝 Creating new paragraph element');
                p = document.createElement('p');
                p.style.cssText = `
                    margin: 0;
                    padding: 0;
                    white-space: pre-wrap;
                    word-wrap: break-word;
                    display: block !important;
                    position: relative;
                    z-index: 1;
                `;
                currentAssistantMessage.appendChild(p);
            }

            // Store the previous scroll position and height
            const previousScrollTop = chatContainer.scrollTop;
            const previousScrollHeight = chatContainer.scrollHeight;

            // Accumulate content
            const newContent = message.response;
            currentAssistantMessage.dataset.content = newContent;

            // Update content
            if (markdownEnabled && marked) {
                try {
                    const parsedContent = marked.parse(newContent);
                    p.innerHTML = parsedContent;
                } catch (error) {
                    console.error('❌ Markdown parsing failed:', error);
                    p.textContent = newContent;
                }
            } else {
                p.textContent = newContent;
            }

            // Ensure proper visibility and layout
            currentAssistantMessage.style.display = 'block';
            p.style.display = 'block';

            // Calculate new scroll position
            const newScrollHeight = chatContainer.scrollHeight;
            const heightDifference = newScrollHeight - previousScrollHeight;
            
            // Smooth scroll handling
            requestAnimationFrame(() => {
                // If user has scrolled up, maintain their position
                if (previousScrollTop + chatContainer.clientHeight < previousScrollHeight) {
                    chatContainer.scrollTop = previousScrollTop;
                } else {
                    // If at bottom, scroll to new content
                    chatContainer.scrollTop = newScrollHeight;
                }
            });

            // Reset current message when done
            if (message.done) {
                console.log('✅ Message complete, resetting current message');
                currentAssistantMessage = null;
            }
        } catch (error) {
            console.error('❌ Error handling model response:', error);
            showError('An error occurred while displaying the response');
        }
    }

    // Handle messages from chrome runtime
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log('🎯 Received chrome.runtime message:', {
            type: message?.type,
            success: message?.success,
            contentLength: message?.response?.length,
            isDone: message?.done
        });

        // Validate message
        if (!message || typeof message !== 'object') {
            console.warn('⚠️ Invalid message format:', message);
            return true;
        }

        // Handle model response
        if (message.type === 'MODEL_RESPONSE') {
            console.log('🔄 Processing MODEL_RESPONSE:', {
                contentLength: message.response?.length,
                isDone: message.done
            });
            handleModelResponse(message);
        }

        return true;
    });

    // Handle window messages (from content script)
    window.addEventListener('message', (event) => {
        const message = event.data;
        
        console.log('📥 Received window message:', {
            type: message?.type,
            success: message?.success,
            contentLength: message?.response?.length,
            isDone: message?.done
        });

        // Handle model response
        if (message?.type === 'MODEL_RESPONSE') {
            console.log('🔄 Processing window MODEL_RESPONSE:', {
                contentLength: message.response?.length,
                isDone: message.done
            });
            handleModelResponse(message);
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

    // Settings menu functionality
    const settingsButton = document.getElementById('settings-button');
    const settingsMenu = document.getElementById('settings-menu');
    const launchLocalButton = document.getElementById('launch-local');
    const addApiKeyButton = document.getElementById('add-api-key');
    const apiKeyDropdown = document.getElementById('api-key-dropdown');

    // Toggle settings menu
    settingsButton.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = settingsMenu.classList.contains('show');
        // Close any open dropdowns first
        document.querySelectorAll('.settings-menu, .api-key-dropdown').forEach(el => {
            el.classList.remove('show');
        });
        if (!isVisible) {
            settingsMenu.classList.add('show');
        }
    });

    // Close menus when clicking outside
    document.addEventListener('click', (e) => {
        if (!settingsButton.contains(e.target) && 
            !settingsMenu.contains(e.target) && 
            !addApiKeyButton.contains(e.target) && 
            !apiKeyDropdown.contains(e.target)) {
            settingsMenu.classList.remove('show');
            apiKeyDropdown.classList.remove('show');
        }
    });

    // Toggle API key dropdown
    addApiKeyButton.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = apiKeyDropdown.classList.contains('show');
        if (!isVisible) {
            apiKeyDropdown.classList.add('show');
        } else {
            apiKeyDropdown.classList.remove('show');
        }
    });

    // Launch local handler
    launchLocalButton.addEventListener('click', () => {
        const command = 'OLLAMA_ORIGINS="chrome-extension://*" ollama serve';
        console.log('Launch local command:', command);
        settingsMenu.classList.remove('show');
    });

    // Handle provider click to show/hide input
    document.querySelectorAll('.provider-info').forEach(providerInfo => {
        providerInfo.addEventListener('click', () => {
            const apiProvider = providerInfo.closest('.api-provider');
            const apiKeyInput = apiProvider.querySelector('.api-key-input');
            
            // Hide all other inputs
            document.querySelectorAll('.api-key-input').forEach(input => {
                if (input !== apiKeyInput) {
                    input.classList.remove('show');
                }
            });
            
            // Toggle current input
            apiKeyInput.classList.toggle('show');
            if (apiKeyInput.classList.contains('show')) {
                apiKeyInput.querySelector('.key-input').focus();
            }
        });
    });

    // Add Edit Models button to settings menu
    function addEditModelsButton() {
        const settingsMenu = document.getElementById('settings-menu');
        const addApiKeyButton = document.getElementById('add-api-key');
        
        // Create Edit Models button if it doesn't exist
        if (!document.getElementById('edit-models')) {
            const editModelsButton = document.createElement('button');
            editModelsButton.id = 'edit-models';
            editModelsButton.className = 'settings-item';
            editModelsButton.innerHTML = `
                Edit Models
                <svg class="chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            `;
            
            // Insert before Add API Key button
            settingsMenu.insertBefore(editModelsButton, addApiKeyButton);
            
            // Add click handler
            editModelsButton.addEventListener('click', showModelEditor);
        }
    }

    // Show model editor
    async function showModelEditor() {
        const providers = ['openai', 'anthropic', 'openrouter', 'perplexity', 'gemini'];
        const modelEditor = document.createElement('div');
        modelEditor.className = 'model-editor';
        
        // Get enabled models for each provider
        const providerModels = await Promise.all(providers.map(async provider => {
            const hasKey = await ApiKeyManager.hasApiKey(provider);
            if (!hasKey) return null;
            
            const enabledModels = await ApiKeyManager.getEnabledModels(provider);
            const availableModels = await getProviderModels(provider);
            return { provider, enabledModels, availableModels };
        }));
        
        // Filter out providers without keys
        const activeProviders = providerModels.filter(Boolean);
        
        modelEditor.innerHTML = `
            <div class="model-editor-content">
                <h2>Edit Enabled Models</h2>
                ${activeProviders.map(({ provider, enabledModels, availableModels }) => `
                    <div class="provider-models">
                        <h3>${provider.charAt(0).toUpperCase() + provider.slice(1)}</h3>
                        <div class="model-list">
                            ${availableModels.map(model => `
                                <label class="model-option">
                                    <input type="checkbox" 
                                           data-provider="${provider}"
                                           data-model="${model.id}"
                                           ${enabledModels.includes(model.id) ? 'checked' : ''}>
                                    <span>${model.name}</span>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                `).join('')}
                <div class="model-editor-actions">
                    <button class="save-all-models">Save Changes</button>
                    <button class="close-editor">Cancel</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modelEditor);
        
        // Add event listeners
        const saveAllButton = modelEditor.querySelector('.save-all-models');
        const closeButton = modelEditor.querySelector('.close-editor');
        
        saveAllButton.addEventListener('click', async () => {
            for (const provider of providers) {
                const checkboxes = modelEditor.querySelectorAll(`input[data-provider="${provider}"]`);
                const selectedModels = Array.from(checkboxes)
                    .filter(cb => cb.checked)
                    .map(cb => cb.dataset.model);
                
                if (selectedModels.length > 0) {
                    await ApiKeyManager.saveEnabledModels(provider, selectedModels);
                }
            }
            
            showToast('Models updated successfully!');
            await initializeModelSelector();
            modelEditor.remove();
        });
        
        closeButton.addEventListener('click', () => {
            modelEditor.remove();
        });
    }

    // Add styles for new UI elements
    const modelStyles = document.createElement('style');
    modelStyles.textContent = `
        .model-selection {
            padding: 16px;
        }
        
        .model-list {
            margin: 12px 0;
            max-height: 200px;
            overflow-y: auto;
        }
        
        .model-option {
            display: flex;
            align-items: center;
            margin: 8px 0;
            cursor: pointer;
        }
        
        .model-option input[type="checkbox"] {
            margin-right: 8px;
        }
        
        .model-actions {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
            margin-top: 16px;
        }
        
        .model-editor {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        }
        
        .model-editor-content {
            background: white;
            padding: 24px;
            border-radius: 8px;
            max-width: 500px;
            width: 90%;
            max-height: 90vh;
            overflow-y: auto;
        }
        
        .provider-models {
            margin: 16px 0;
        }
        
        .model-editor-actions {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
            margin-top: 24px;
        }
        
        button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
    `;
    document.head.appendChild(modelStyles);

    // Initialize edit models button
    document.addEventListener('DOMContentLoaded', () => {
        addEditModelsButton();
    });

    // Add function to handle API key removal
    async function handleApiKeyRemove(provider) {
        try {
            await ApiKeyManager.deleteApiKey(provider);
            await ApiKeyManager.clearEnabledModels(provider);
            await updateProviderStatus(provider);
            await initializeModelSelector();
            showToast(`${provider} API key removed successfully`);
            
            // Reset the input field
            const input = document.querySelector(`input[data-provider="${provider}"]`);
            if (input) {
                input.value = '';
            }
        } catch (error) {
            console.error('Error removing API key:', error);
            showToast(`Error removing ${provider} API key`, 'error');
        }
    }
} catch (error) {
    console.error('❌ Initialization error:', error);
} 