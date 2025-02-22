console.log('🔍 Script tag loaded');

// Move imports to top
import { ApiKeyManager } from './utils/api-key-manager.js';
import { ApiService } from './utils/api-service.js';

console.log('✅ Imports successful');
console.log('🚀 Sidebar script starting...');

// Global variables and constants
const logoMap = {
    'local': 'ollama.jpg',
    'openai': 'openai.jpg',
    'anthropic': 'claude.jpg',
    'gemini': 'gemini.webp',
    'perplexity': 'perplexity.png',
    'openrouter': 'openrouter.jpeg',
    'grok': 'grok.webp'
};

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
    let currentModel = 'local:llama3.2:1b';  // Initialize with local: prefix
    let currentImage = null;
    let setupWizardFrame = null;
    let markdownEnabled = true;

    // Initialize markdown toggle
    markdownToggle.addEventListener('change', (e) => {
        markdownEnabled = e.target.checked;
        console.log('🔄 Markdown toggle changed:', markdownEnabled);
    });

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
            const providers = ['openai', 'anthropic', 'openrouter', 'perplexity', 'gemini', 'grok'];
            for (const provider of providers) {
                await updateProviderStatus(provider);
            }
            
            // Initialize model selector without setup check
            await initializeModelSelector();
            
            addEditModelsButton();
        } catch (error) {
            console.error('Initialization error:', error);
            showToast('Failed to initialize. Please check if Ollama is running.', 'error');
        }
    });

    // Update the handleApiKeySave function to properly show/hide UI elements
    async function handleApiKeySave(provider) {
        const input = document.querySelector(`input[data-provider="${provider}"]`);
        if (!input || !input.value) {
            showToast('Please enter an API key', 'error');
            return;
        }

        const apiKeyInput = input.closest('.api-key-input');
        const saveButton = apiKeyInput.querySelector('.save-key');
        const originalText = saveButton.textContent;

        try {
            const apiKey = input.value; // Removed trim() to preserve exact key format
            
            // Preliminary format validation for Anthropic
            if (provider === 'anthropic' && !apiKey.startsWith('sk-ant-')) {
                throw new Error('Invalid Anthropic API key format. Key should start with "sk-ant-"');
            }
            
            // Show loading state
            saveButton.textContent = 'Validating...';
            saveButton.disabled = true;

            // First validate the key
            try {
                const isValid = await validateApiKey(provider, apiKey);
                if (!isValid) {
                    throw new Error('Invalid API key format');
                }
            } catch (error) {
                saveButton.textContent = originalText;
                saveButton.disabled = false;
                throw error;
            }
            
            // Save the key if validation passed
            await ApiKeyManager.saveApiKey(provider, apiKey);
            
            // Handle model saving
            if (provider === 'openrouter') {
                await ApiKeyManager.saveEnabledModels(provider, []);
            } else if (provider === 'gemini') {
                // Save all Gemini models as enabled
                await ApiKeyManager.saveEnabledModels('gemini', [
                    // Gemini 1.5 Models
                    'gemini-1.5-pro',
                    'gemini-1.5-flash',
                    'gemini-1.0-pro',
                    // Experimental Models
                    'gemini-1.5-pro-exp-0827',
                    'gemini-1.5-flash-exp-0827',
                    'gemini-1.5-flash-8b-exp-0924'
                ]);
            } else {
                // Get available models
                const models = await getProviderModels(provider, null, null, null, null);
                if (!models || models.length === 0) {
                    throw new Error('No models available for this API key');
                }
                // Save all models as enabled by default
                await ApiKeyManager.saveEnabledModels(provider, models.map(m => m.id));
            }
            
            // Update checkmark and UI
            await updateProviderStatus(provider);
            await initializeModelSelector();
            
            // Reset button state and close the dropdown
            saveButton.textContent = originalText;
            saveButton.disabled = false;
            apiKeyInput.classList.remove('show');
            
            showToast(`${provider} API key saved successfully!`);
        } catch (error) {
            console.error(`Error saving API key for ${provider}:`, error);
            showToast(`Error: ${error.message}`, 'error');
            
            saveButton.textContent = originalText;
            saveButton.disabled = false;
            
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
                // Filter for specific OpenAI models
                const supportedModels = data.data.filter(model => {
                    const id = model.id.toLowerCase();
                    return (
                        // o-series models
                        id === 'o1' ||  // o1 base
                        id === 'o1-mini' ||  // o1 mini
                        id === 'o3-mini' ||  // o3 mini base
                        id === 'o3-mini-high' ||  // o3 mini high
                        // GPT-4o models
                        id === 'gpt-4o' ||  // GPT-4o base
                        id === 'gpt-4o-mini'  // GPT-4o mini
                    );
                }).map(model => ({
                    id: model.id,
                    name: model.id
                    .replace(/^gpt-/i, 'GPT-')  // Keep 'gpt' lowercase
                        .trim()
                }));
                
                if (supportedModels.length === 0) {
                    throw new Error('No supported models available for this API key');
                }
                
                return true;

            case 'anthropic':
                try {
                    // Validate Anthropic key format first
                    if (!apiKey.startsWith('sk-ant-')) {
                        throw new Error('Invalid Anthropic API key format. Key should start with "sk-ant-"');
                    }

                    const response = await fetch('https://api.anthropic.com/v1/messages', {
                        method: 'POST',
                        headers: {
                            'anthropic-version': '2023-06-01',
                            'x-api-key': apiKey,
                            'content-type': 'application/json',
                            'anthropic-dangerous-direct-browser-access': 'true'
                        },
                        body: JSON.stringify({
                            model: 'claude-3-haiku-20240307',
                            messages: [{ role: 'user', content: 'test' }],
                            max_tokens: 1
                        })
                    });

                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        if (response.status === 401) {
                            throw new Error(errorData.error?.message || 'Invalid API key');
                        }
                        throw new Error(errorData.error?.message || `API error: ${response.status}`);
                    }

                    return true;
                } catch (error) {
                    console.error('Error validating Anthropic key:', error);
                    throw error;
                }

            case 'gemini':
                // Test the API key by making a simple request to list models
                const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`);
                
                if (!geminiResponse.ok) {
                    if (geminiResponse.status === 401 || geminiResponse.status === 403) {
                        throw new Error('Invalid API key');
                    }
                    throw new Error(`Gemini API error: ${geminiResponse.status}`);
                }
                
                const geminiData = await geminiResponse.json();
                const geminiModels = geminiData.models || [];
                
                // Check for any Gemini model instead of just gemini-pro
                const hasGeminiModel = geminiModels.some(model => 
                    model.name.includes('gemini-') || model.name.includes('models/gemini-')
                );
                
                if (!hasGeminiModel) {
                    throw new Error('No Gemini models are available for this API key');
                }
                
                // Save all Gemini models as enabled
                await ApiKeyManager.saveEnabledModels('gemini', [
                    // Gemini 1.5 Models
                    'gemini-1.5-pro',
                    'gemini-1.5-flash',
                    'gemini-1.0-pro',
                    // Experimental Models
                    'gemini-1.5-pro-exp-0827',
                    'gemini-1.5-flash-exp-0827',
                    'gemini-1.5-flash-8b-exp-0924'
                ]);
                
                return true;

            case 'grok':
                try {
                    console.log('Validating Grok API key format...');
                    // Save grok-2-1212 as the enabled model
                    await ApiKeyManager.saveEnabledModels('grok', ['grok-2-1212', 'grok-2-vision-1212']);
                    return true;
                } catch (error) {
                    console.error('Error validating Grok API key:', error);
                    throw new Error(`Failed to validate Grok API key: ${error.message}`);
                }

            case 'perplexity':
                try {
                    // Validate Perplexity key format first
                    if (!apiKey.startsWith('pplx-')) {
                        throw new Error('Invalid Perplexity API key format. Key should start with "pplx-"');
                    }

                    // Test the API key with a minimal chat completion request
                    const response = await fetch('https://api.perplexity.ai/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${apiKey}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            model: 'sonar',  // Use the base Sonar model for validation
                            messages: [{ role: 'user', content: 'test' }],
                            max_tokens: 1
                        })
                    });

                    if (!response.ok) {
                        if (response.status === 401) {
                            throw new Error('Invalid API key');
                        }
                        throw new Error(`API error: ${response.status}`);
                    }

                    // Save all Sonar models as enabled
                    await ApiKeyManager.saveEnabledModels('perplexity', [
                        'sonar-reasoning-pro',
                        'sonar-reasoning',
                        'sonar-pro',
                        'sonar'
                    ]);
                    
                    return true;
                } catch (error) {
                    console.error('Error validating Perplexity key:', error);
                    throw error;
                }

            case 'openrouter':
                try {
                    // Test the API key with a minimal request
                    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${apiKey}`,
                            'Content-Type': 'application/json',
                            'HTTP-Referer': chrome.runtime.getURL(''),
                            'X-Title': 'LlamaBar'
                        },
                        body: JSON.stringify({
                            model: 'openai/gpt-4o',
                            messages: [{ role: 'user', content: 'test' }],
                            max_tokens: 1
                        })
                    });

                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        if (response.status === 401) {
                            throw new Error('Invalid API key');
                        }
                        throw new Error(errorData.error?.message || `API error: ${response.status}`);
                    }

                    return true;
                } catch (error) {
                    console.error('Error validating OpenRouter key:', error);
                    throw error;
                }

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

    // Update model selection handler
    modelSelector.addEventListener('change', async (e) => {
        currentModel = e.target.value;
        console.log('Model changed to:', currentModel);
        
        // Update provider logo
        updateProviderLogo(currentModel);
        
        // Check if there's an image and update warning
        if (currentImage) {
            const modelName = currentModel.replace('local:', '');
            const isVisionModel = modelName.toLowerCase().includes('vision') || 
                                modelName.toLowerCase().includes('dream') || 
                                modelName.toLowerCase().includes('image');
            
            warningContainer.style.display = 'inline-flex';
            if (!isVisionModel) {
                warningContainer.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    Current model doesn't support images
                `;
                inputExplainButton.style.display = 'none'; // Hide explain button
            } else {
                warningContainer.style.display = 'none';
                // Only show explain button if there's text
                const text = userInput.value.trim();
                inputExplainButton.style.display = text ? 'block' : 'none';
            }
        } else {
            warningContainer.style.display = 'none';
            // Show explain button if there's text
            const text = userInput.value.trim();
            inputExplainButton.style.display = text ? 'block' : 'none';
        }
    });

    // Function to update provider logo
    function updateProviderLogo(modelId) {
        const [provider] = modelId.split(':');
        const logoContainer = document.querySelector('.model-selector-container');
        let logoImg = logoContainer.querySelector('.provider-logo');
        
        if (!logoImg) {
            logoImg = document.createElement('img');
            logoImg.className = 'provider-logo';
            logoContainer.insertBefore(logoImg, modelSelector);
        }

        const logoFile = logoMap[provider];
        if (logoFile) {
            logoImg.src = chrome.runtime.getURL(`assets/${logoFile}`);
            logoImg.style.display = 'block';
        } else {
            logoImg.style.display = 'none';
        }
    }

    // Initialize model selector and setup wizard
    async function initializeModelSelector() {
        try {
            console.log('Initializing model selector...');
            const sections = [];  // Initialize sections array
            const customSelect = document.getElementById('model-selector');
            const selectSelected = customSelect.querySelector('.select-selected');
            const selectItems = customSelect.querySelector('.select-items');
            
            // Remove existing event listeners
            const newSelectSelected = selectSelected.cloneNode(true);
            const newSelectItems = selectItems.cloneNode(false);
            selectSelected.parentNode.replaceChild(newSelectSelected, selectSelected);
            selectItems.parentNode.replaceChild(newSelectItems, selectItems);
            
            // Get new references after DOM updates
            const selectedText = newSelectSelected.querySelector('.selected-text');
            const selectedLogo = newSelectSelected.querySelector('.provider-logo');
            
            // Set initial loading state
            selectedText.textContent = 'Loading models...';
            selectedLogo.style.display = 'none';
            
            // Clear existing options
            newSelectItems.innerHTML = '';
            
            let hasAnyModels = false;  // Track if we find any models
            let hasSelectedModel = false;

            // Get default model if available
            const defaultModel = await ApiKeyManager.getDefaultModel();
            if (defaultModel) {
                currentModel = defaultModel;
            }
            
            // Get local models from Ollama
            try {
                const response = await fetch('http://localhost:11434/api/tags');
                if (response.ok) {
                    const data = await response.json();
                    console.log('Local models found:', data.models);
                    
                    if (data.models.length > 0) {
                        hasAnyModels = true;
                        const localSection = document.createElement('div');
                        localSection.className = 'provider-section';
                        localSection.innerHTML = `
                            <div class="provider-header">
                                <img class="provider-logo" src="${chrome.runtime.getURL('assets/ollama.jpg')}" alt="Ollama">
                                <span>Local Models</span>
                            </div>
                        `;
                        
                        data.models.forEach(model => {
                            const option = document.createElement('div');
                            option.className = 'model-option';
                            option.dataset.value = `local:${model.name}`;
                            option.innerHTML = `
                                <img class="provider-logo" src="${chrome.runtime.getURL('assets/ollama.jpg')}" alt="Ollama">
                                <span>${model.name}</span>
                            `;
                            if (`local:${model.name}` === currentModel) {
                                option.classList.add('selected');
                                selectedText.textContent = model.name;
                                selectedLogo.src = chrome.runtime.getURL('assets/ollama.jpg');
                                selectedLogo.style.display = 'block';
                                hasSelectedModel = true;
                            }
                            localSection.appendChild(option);
                        });
                        
                        sections.push(localSection);
                    }
                }
            } catch (error) {
                // Don't show any error for local models, just log it
                console.log('Local models not available:', error);
            }
            
            // Add API models based on saved keys
            const providers = await ApiKeyManager.getAllProviders();
            console.log('Found providers with keys:', providers);
            
            if (providers.length > 0) {
                for (const provider of providers) {
                    console.log(`Fetching models for ${provider}...`);
                    const enabledModels = await ApiKeyManager.getEnabledModels(provider);
                    console.log(`Enabled models for ${provider}:`, enabledModels);
                    
                    if (enabledModels.length > 0) {
                        const availableModels = await getProviderModels(provider);
                        console.log(`Available models for ${provider}:`, availableModels);
                        
                        if (!availableModels || availableModels.length === 0) {
                            console.warn(`No available models found for ${provider}`);
                            continue;
                        }
                        
                        const filteredModels = availableModels.filter(model => enabledModels.includes(model.id));
                        console.log(`Filtered models for ${provider}:`, filteredModels);
                        
                        if (filteredModels.length > 0) {
                            hasAnyModels = true;
                            const providerSection = document.createElement('div');
                            providerSection.className = 'provider-section';
                            const logoFile = logoMap[provider];
                            
                            // Format provider name
                            let providerDisplay = provider === 'openai' ? 'OpenAI' : 
                                                provider.charAt(0).toUpperCase() + provider.slice(1);
                            
                            providerSection.innerHTML = `
                                <div class="provider-header">
                                    <img class="provider-logo" src="${chrome.runtime.getURL(`assets/${logoFile}`)}" alt="${provider}">
                                    <span>${providerDisplay} Models</span>
                                </div>
                            `;
                            
                            filteredModels.forEach(model => {
                                const option = document.createElement('div');
                                option.className = 'model-option';
                                option.dataset.value = `${provider}:${model.id}`;
                                option.innerHTML = `
                                    <img class="provider-logo" src="${chrome.runtime.getURL(`assets/${logoFile}`)}" alt="${provider}">
                                    <span>${model.name}</span>
                                `;
                                if (`${provider}:${model.id}` === currentModel) {
                                    option.classList.add('selected');
                                    selectedText.textContent = model.name;
                                    selectedLogo.src = chrome.runtime.getURL(`assets/${logoFile}`);
                                    selectedLogo.style.display = 'block';
                                    hasSelectedModel = true;
                                }
                                providerSection.appendChild(option);
                            });
                            
                            sections.push(providerSection);
                        }
                    }
                }
            }
            
            // Add sections to dropdown
            sections.forEach(section => newSelectItems.appendChild(section));
            
            // Update UI based on whether we found any models
            if (!hasAnyModels) {
                console.log('No models available in selector');
                selectedText.textContent = 'No models configured';
                selectedLogo.style.display = 'none';
                
                // Add a helper section to guide users
                const helperSection = document.createElement('div');
                helperSection.className = 'provider-section';
                helperSection.innerHTML = `
                    <div class="provider-header">
                        <span>No Models Available</span>
                    </div>
                    <div class="model-list">
                        <div class="model-option helper-message">
                            <ul class="helper-list">
                                <li class="helper-header">You can add models by:</li>
                                <li>Clicking "Launch Local" to set up Ollama</li>
                                <li>Adding API keys for other providers</li>
                            </ul>
                        </div>
                    </div>
                `;
                newSelectItems.appendChild(helperSection);
            } else if (!hasSelectedModel) {
                // If we have models but none is selected, select the first one
                const firstOption = newSelectItems.querySelector('.model-option');
                if (firstOption && firstOption.dataset.value) {
                    const value = firstOption.dataset.value;
                    const [provider] = value.split(':');
                    currentModel = value;
                    selectedText.textContent = firstOption.querySelector('span').textContent;
                    selectedLogo.src = chrome.runtime.getURL(`assets/${logoMap[provider]}`);
                    selectedLogo.style.display = 'block';
                    firstOption.classList.add('selected');
                }
            }
            
            // Toggle dropdown with new elements
            newSelectSelected.addEventListener('click', (e) => {
                e.stopPropagation();
                // Close settings menu if open
                settingsMenu.classList.remove('show');
                apiKeyDropdown.classList.remove('show');
                // Toggle model selector
                customSelect.classList.toggle('open');
            });
            
            // Close dropdown when clicking outside
            const closeDropdown = (e) => {
                if (!customSelect.contains(e.target)) {
                    customSelect.classList.remove('open');
                }
            };
            document.removeEventListener('click', closeDropdown);
            document.addEventListener('click', closeDropdown);
            
            // Handle model selection with new elements
            newSelectItems.addEventListener('click', async (e) => {
                const option = e.target.closest('.model-option');
                if (option && option.dataset.value) {  // Only handle clicks on valid model options
                    const value = option.dataset.value;
                    const [provider] = value.split(':');
                    
                    // Update selected option
                    currentModel = value;
                    selectedText.textContent = option.querySelector('span').textContent;
                    selectedLogo.src = chrome.runtime.getURL(`assets/${logoMap[provider]}`);
                    selectedLogo.style.display = 'block';
                    
                    // Update selected state
                    newSelectItems.querySelectorAll('.model-option').forEach(opt => {
                        opt.classList.toggle('selected', opt === option);
                    });
                    
                    // Close dropdown
                    customSelect.classList.remove('open');
                    
                    console.log('Model changed to:', currentModel);
                }
            });
            
        } catch (error) {
            console.error('Error initializing model selector:', error);
            const selectedText = newSelectSelected.querySelector('.selected-text');
            const selectedLogo = newSelectSelected.querySelector('.provider-logo');
            selectedText.textContent = 'No models configured';
            selectedLogo.style.display = 'none';
        }
    }

    // Get available models for each provider
    async function getProviderModels(provider, sections, customSelect, selectedText, selectedLogo) {
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
                
                // Filter for specific OpenAI models
                const supportedModels = data.data.filter(model => {
                    const id = model.id.toLowerCase();
                    return (
                        // o-series models
                        id === 'o1' ||  // o1 base
                        id === 'o1-mini' ||  // o1 mini
                        id === 'o3-mini' ||  // o3 mini base
                        id === 'o3-mini-high' ||  // o3 mini high
                        // GPT-4o models
                        id === 'gpt-4o' ||  // GPT-4o base
                        id === 'gpt-4o-mini'  // GPT-4o mini
                    );
                }).map(model => ({
                    id: model.id,
                    name: model.id
                        .replace(/^gpt-/i, 'GPT-')  // Keep 'gpt' lowercase
                        .trim()
                }));
                
                console.log('Available OpenAI models:', supportedModels);
                return supportedModels;
            } catch (error) {
                console.error('Error fetching OpenAI models:', error);
                return [];
            }
        }

        // For OpenRouter, return an empty array since models are managed differently
        if (provider === 'openrouter') {
            const enabledModels = await ApiKeyManager.getEnabledModels('openrouter');
            return enabledModels.map(modelId => ({
                id: modelId,
                name: modelId.split('/').pop() // Extract model name from ID
            }));
        }

        // Fallback static lists for other providers
        const models = {
            anthropic: [
                // Claude 3.5 Models
                { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
                { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
                // Claude 3 Models
                { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
                { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet' },
                { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' },
                // Claude 2 Models
                { id: 'claude-2.1', name: 'Claude 2.1' },
                { id: 'claude-2.0', name: 'Claude 2.0' }
            ],
            perplexity: [
                { id: 'sonar-reasoning-pro', name: 'Sonar Reasoning Pro' },
                { id: 'sonar-reasoning', name: 'Sonar Reasoning' },
                { id: 'sonar-pro', name: 'Sonar Pro' },
                { id: 'sonar', name: 'Sonar' }
            ],
            gemini: [
                // Gemini 1.5 Models
                { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
                { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
                { id: 'gemini-1.0-pro', name: 'Gemini 1.0 Pro' },
                // Experimental Models
                { id: 'gemini-1.5-pro-exp-0827', name: 'Gemini 1.5 Pro (Experimental)' },
                { id: 'gemini-1.5-flash-exp-0827', name: 'Gemini 1.5 Flash (Experimental)' },
                { id: 'gemini-1.5-flash-8b-exp-0924', name: 'Gemini 1.5 Flash-8B (Experimental)' }
            ],
            grok: [
                { id: 'grok-2-1212', name: 'Grok 2' },
                { id: 'grok-2-vision-1212', name: 'Grok 2 Vision' }
            ]
        };
        
        return models[provider] || [];
    }

    // Handle image paste
    async function handleImagePaste(e) {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        
        for (const item of items) {
            if (item.type.indexOf('image') === 0) {
                e.preventDefault();
                const blob = item.getAsFile();
                const reader = new FileReader();
                
                reader.onload = async function(event) {
                    const base64Image = event.target.result;
                    displayImagePreview(base64Image);
                    currentImage = base64Image;
                    
                    // Always show container when there's an image
                    explainButtonContainer.style.display = 'block';
                    
                    // Check if current model supports vision
                    const modelName = currentModel.replace('local:', '');
                    const isVisionModel = modelName.toLowerCase().includes('vision') || 
                                        modelName.toLowerCase().includes('dream') || 
                                        modelName.toLowerCase().includes('image');
                    
                    // Show warning if model doesn't support vision
                    if (!isVisionModel) {
                        warningContainer.innerHTML = `
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                            Current model doesn't support images
                        `;
                        warningContainer.style.display = 'inline-flex';
                        inputExplainButton.style.display = 'none'; // Hide explain button
                    } else {
                        warningContainer.style.display = 'none';
                        // Only show explain button if there's text
                        const text = userInput.value.trim();
                        inputExplainButton.style.display = text ? 'block' : 'none';
                    }
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
            <button class="remove-image" aria-label="Remove image">×</button>
        `;
        imagePreview.classList.add('active');
        
        // Add event listener to the remove button
        const removeButton = imagePreview.querySelector('.remove-image');
        removeButton.addEventListener('click', removeImage);
    }

    // Remove image (change to regular function instead of window property)
    function removeImage() {
        imagePreview.innerHTML = '';
        imagePreview.classList.remove('active');
        currentImage = null;
        warningContainer.style.display = 'none';
        // Show explain button if there's text
        const text = userInput.value.trim();
        if (text) {
            explainButtonContainer.style.display = 'block';
            inputExplainButton.style.display = 'block';
        } else {
            explainButtonContainer.style.display = 'none';
        }
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
        
        // Handle markdown formatting if enabled for assistant messages
        if (type === 'assistant' && markdownEnabled && typeof marked !== 'undefined') {
            try {
                messageDiv.innerHTML = marked.parse(content);
            } catch (error) {
                console.error('Markdown parsing failed:', error);
                messageDiv.textContent = content;
            }
        } else if (type === 'user' && content.includes('<img')) {
            // For user messages with images, use innerHTML but sanitize
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = content;
            
            // Only allow specific HTML elements and attributes
            const allowedTags = ['div', 'img'];
            const allowedAttributes = {
                'img': ['src', 'alt']
            };
            
            function sanitizeNode(node) {
                if (node.nodeType === 3) { // Text node
                    return node.cloneNode(true);
                }
                
                if (node.nodeType !== 1) { // Not an element node
                    return null;
                }
                
                if (!allowedTags.includes(node.tagName.toLowerCase())) {
                    return document.createTextNode(node.textContent);
                }
                
                const newNode = document.createElement(node.tagName);
                
                // Copy allowed attributes
                const allowedAttrs = allowedAttributes[node.tagName.toLowerCase()] || [];
                allowedAttrs.forEach(attr => {
                    if (node.hasAttribute(attr)) {
                        newNode.setAttribute(attr, node.getAttribute(attr));
                    }
                });
                
                // Recursively sanitize child nodes
                Array.from(node.childNodes).forEach(child => {
                    const sanitizedChild = sanitizeNode(child);
                    if (sanitizedChild) {
                        newNode.appendChild(sanitizedChild);
                    }
                });
                
                return newNode;
            }
            
            // Clear the message div
            messageDiv.innerHTML = '';
            
            // Add sanitized nodes
            Array.from(tempDiv.childNodes).forEach(node => {
                const sanitizedNode = sanitizeNode(node);
                if (sanitizedNode) {
                    messageDiv.appendChild(sanitizedNode);
                }
            });
        } else {
            // For regular messages without HTML
            messageDiv.textContent = content;
        }
        
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        
        return messageDiv;
    }

    // Handle user input
    async function handleUserInput(text) {
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
                // Extract MIME type and base64 data
                const [mimeHeader, originalBase64Data] = currentImage.split(',');
                let mimeType = mimeHeader.match(/data:(.*?);/)?.[1] || 'image/jpeg';
                let base64Data = originalBase64Data;
                
                // Convert WebP to JPEG
                if (mimeType === 'image/webp') {
                    try {
                        base64Data = await new Promise((resolve, reject) => {
                            const img = new Image();
                            img.onload = () => {
                                const canvas = document.createElement('canvas');
                                canvas.width = img.width;
                                canvas.height = img.height;
                                const ctx = canvas.getContext('2d');
                                ctx.drawImage(img, 0, 0);
                                const jpegData = canvas.toDataURL('image/jpeg', 0.9);
                                resolve(jpegData.split(',')[1]);
                            };
                            img.onerror = () => reject(new Error('Failed to load image'));
                            img.src = currentImage;
                        });
                        mimeType = 'image/jpeg';
                    } catch (error) {
                        console.error('Failed to convert WebP to JPEG:', error);
                        // Fall back to original image data
                        base64Data = originalBase64Data;
                    }
                }
                
                prompt = `<image>data:${mimeType};base64,${base64Data}</image>\n${text}`;
            } else {
                console.warn('Attempting to use image with non-vision model:', currentModel);
                prompt = `[Image]\n${text}`;
            }
        }
        
        // Only add markdown instruction if explicitly enabled
        if (markdownEnabled && text.includes('```') || text.includes('`') || text.includes('#')) {
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

    // Show error message in chat
    function showError(errorMessage) {
        if (currentAssistantMessage) {
            currentAssistantMessage.textContent = `Error: ${errorMessage}`;
            currentAssistantMessage.style.color = '#f44336';
        } else {
            const errorDiv = addMessage('assistant', `Error: ${errorMessage}`);
            errorDiv.style.color = '#f44336';
        }
        showToast(errorMessage, 'error');
    }

    // Add this at the top with other variables
    let scrollTimeout = null;
    let isUserScrolled = false;

    // Add KaTeX configuration
    const katexConfig = {
        delimiters: [
            { left: "$$", right: "$$", display: true },
            { left: "$", right: "$", display: false },
            { left: "\\[", right: "\\]", display: true },
            { left: "\\(", right: "\\)", display: false }
        ],
        throwOnError: false,
        output: 'html'
    };

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
            
            // Track if user has scrolled up
            if (!isUserScrolled) {
                isUserScrolled = chatContainer.scrollTop + chatContainer.clientHeight < chatContainer.scrollHeight - 10;
            }

            // Create new message if none exists
            if (!currentAssistantMessage) {
                // First, ensure proper spacing by adding margin to the last message
                const messages = chatContainer.querySelectorAll('.message');
                if (messages.length > 0) {
                    const lastMessage = messages[messages.length - 1];
                    lastMessage.style.marginBottom = '16px';
                }

                console.log('📝 Creating new assistant message');
                currentAssistantMessage = addMessage('assistant', '');
                currentAssistantMessage.dataset.content = '';
                
                // Ensure the new message is properly positioned
                currentAssistantMessage.style.position = 'relative';
                currentAssistantMessage.style.marginTop = '16px';
                currentAssistantMessage.style.marginBottom = '16px';
                
                if (!currentAssistantMessage) {
                    throw new Error('Failed to create assistant message element');
                }
            }

            // Get or create content container
            let contentContainer = currentAssistantMessage.querySelector('.content-container');
            if (!contentContainer) {
                console.log('📝 Creating new content container');
                contentContainer = document.createElement('div');
                contentContainer.className = 'content-container';
                contentContainer.style.cssText = `
                    margin: 0;
                    padding: 0;
                    white-space: pre-wrap;
                    word-wrap: break-word;
                    display: block !important;
                    position: relative;
                    z-index: 1;
                `;
                currentAssistantMessage.appendChild(contentContainer);
            }

            // Accumulate content
            const newContent = message.response;
            currentAssistantMessage.dataset.content = newContent;

            // Update content with markdown and math
            if (markdownEnabled && typeof marked !== 'undefined' && typeof katex !== 'undefined') {
                try {
                    // Only parse complete markdown blocks or if message is done
                    const shouldParseMarkdown = message.done || 
                        newContent.includes('\n\n') || 
                        newContent.length > 100;
                    
                    if (shouldParseMarkdown) {
                        // Configure marked for streaming
                        marked.setOptions({
                            breaks: true,
                            gfm: true,
                            headerIds: false,
                            mangle: false
                        });
                        
                        // Parse markdown
                        const parsedContent = marked.parse(newContent);
                        
                        // Create a temporary div to sanitize HTML
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = parsedContent;
                        
                        // Remove any script tags for security
                        const scripts = tempDiv.getElementsByTagName('script');
                        while (scripts[0]) {
                            scripts[0].parentNode.removeChild(scripts[0]);
                        }
                        
                        contentContainer.innerHTML = tempDiv.innerHTML;

                        // Render math in the content
                        if (typeof renderMathInElement !== 'undefined') {
                            renderMathInElement(contentContainer, katexConfig);
                        }
                    } else {
                        // For incomplete chunks, just escape and display as text
                        contentContainer.textContent = newContent;
                    }
                } catch (error) {
                    console.error('❌ Markdown/Math parsing failed:', error);
                    contentContainer.textContent = newContent;
                }
            } else {
                contentContainer.textContent = newContent;
            }

            // Ensure proper visibility and layout
            currentAssistantMessage.style.display = 'block';
            contentContainer.style.display = 'block';

            // Smooth scroll handling
            if (!isUserScrolled) {
                // Clear any pending scroll timeout
                if (scrollTimeout) {
                    clearTimeout(scrollTimeout);
                }
                
                // Debounce the scroll to avoid jank
                scrollTimeout = setTimeout(() => {
                    chatContainer.scrollTo({
                        top: chatContainer.scrollHeight,
                        behavior: 'smooth'
                    });
                }, 100); // Adjust this delay if needed
            }

            // Reset scroll tracking when message is complete
            if (message.done) {
                console.log('✅ Message complete, resetting current message');
                currentAssistantMessage = null;
                // Do not reset isUserScrolled here
                if (scrollTimeout) {
                    clearTimeout(scrollTimeout);
                }
                // Only scroll to bottom if user hasn't scrolled up
                if (!isUserScrolled) {
                    chatContainer.scrollTo({
                        top: chatContainer.scrollHeight,
                        behavior: 'smooth'
                    });
                }
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
        // Show container if there's text or an image
        explainButtonContainer.style.display = (text || currentImage) ? 'block' : 'none';
        
        // Check if we should show the explain button
        if (currentImage) {
            const modelName = currentModel.replace('local:', '');
            const isVisionModel = modelName.toLowerCase().includes('vision') || 
                                modelName.toLowerCase().includes('dream') || 
                                modelName.toLowerCase().includes('image');
            
            // Only show explain button if model supports vision and there's text
            inputExplainButton.style.display = (isVisionModel && text) ? 'block' : 'none';
        } else {
            // No image, show explain button if there's text
            inputExplainButton.style.display = text ? 'block' : 'none';
        }
        
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
        // Close model selector if open
        document.querySelector('.custom-select').classList.remove('open');
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
    launchLocalButton.addEventListener('click', async () => {
        console.log('Launching local setup...');
        const isSetup = await checkSetupStatus();
        if (!isSetup) {
            showSetupWizard();
        }
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
        const providers = ['openai', 'anthropic', 'perplexity', 'gemini', 'grok', 'openrouter'];
        const modelEditor = document.createElement('div');
        modelEditor.className = 'model-editor';
        
        // Get enabled models for each provider
        const providerModels = await Promise.all(providers.map(async provider => {
            const hasKey = await ApiKeyManager.hasApiKey(provider);
            if (!hasKey) return null;
            
            const enabledModels = await ApiKeyManager.getEnabledModels(provider) || [];
            const availableModels = await getProviderModels(provider, null, null, null, null);
            return { provider, enabledModels: enabledModels || [], availableModels: availableModels || [] };
        }));
        
        const activeProviders = providerModels.filter(Boolean);
        
        modelEditor.innerHTML = `
            <div class="model-editor-backdrop"></div>
            <div class="model-editor-content">
                <div class="model-editor-header">
                    <h2>Model Settings</h2>
                    <button class="close-editor" aria-label="Close">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                </div>
                <div class="model-editor-body">
                    <div class="default-model-section">
                        <h3>Default Model</h3>
                        <select class="default-model-select">
                            <option value="">Select a default model</option>
                            ${activeProviders.map(({ provider, availableModels }) => 
                                availableModels.map(model => `
                                    <option value="${provider}:${model.id}">${provider.charAt(0).toUpperCase() + provider.slice(1)} - ${model.name}</option>
                                `).join('')
                            ).join('')}
                        </select>
                    </div>
                    ${activeProviders.map(({ provider, enabledModels, availableModels }) => {
                        if (provider === 'openrouter') {
                            return `
                                <div class="provider-models">
                                    <div class="provider-header">
                                        <img class="provider-logo" src="${chrome.runtime.getURL(`assets/${logoMap[provider]}`)}" alt="${provider}">
                                        <h3>OpenRouter</h3>
                                        <span class="model-count">${enabledModels.length} models enabled</span>
                                    </div>
                                    <div class="openrouter-models">
                                        ${enabledModels && enabledModels.length > 0 ? `
                                            <div class="model-list">
                                                ${enabledModels.map(modelId => `
                                                    <div class="model-option">
                                                        <div class="model-info">
                                                            <span class="model-name">${modelId}</span>
                                                        </div>
                                                        <button class="remove-model-button" data-model="${modelId}" aria-label="Remove model">
                                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                                <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
                                                            </svg>
                                                        </button>
                                                    </div>
                                                `).join('')}
                                            </div>
                                        ` : ''}
                                        <div class="add-model-section">
                                            <div class="add-model-input-group">
                                                <input type="text" 
                                                       class="add-model-input" 
                                                       placeholder="Enter model ID (e.g., anthropic/claude-3-opus-20240229)"
                                                       data-provider="openrouter">
                                                <button class="add-model-button" disabled>
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                        <path d="M12 5v14M5 12h14" stroke-linecap="round" stroke-linejoin="round"/>
                                                    </svg>
                                                    Add Model
                                                </button>
                                            </div>
                                            <div class="model-validation-message"></div>
                                        </div>
                                    </div>
                                </div>
                            `;
                        }
                        return `
                            <div class="provider-models">
                                <div class="provider-header">
                                    <img class="provider-logo" src="${chrome.runtime.getURL(`assets/${logoMap[provider]}`)}" alt="${provider}">
                                    <h3>${provider.charAt(0).toUpperCase() + provider.slice(1)}</h3>
                                    <span class="model-count">${enabledModels.length} of ${availableModels.length} enabled</span>
                                </div>
                                <div class="model-list">
                                    ${availableModels.map(model => `
                                        <label class="model-option">
                                            <div class="checkbox-wrapper">
                                                <input type="checkbox" 
                                                       data-provider="${provider}"
                                                       data-model="${model.id}"
                                                       ${enabledModels.includes(model.id) ? 'checked' : ''}>
                                                <span class="checkbox-custom"></span>
                                            </div>
                                            <div class="model-info">
                                                <span class="model-name">${model.name}</span>
                                                <span class="model-id">${model.id}</span>
                                            </div>
                                        </label>
                                    `).join('')}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
                <div class="model-editor-footer">
                    <button class="secondary-button close-editor">Cancel</button>
                    <button class="primary-button save-all-models">
                        <span class="button-content">
                            <svg class="save-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" stroke-linecap="round" stroke-linejoin="round"/>
                                <path d="M17 21v-8H7v8M7 3v5h8" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                            <span>Save Changes</span>
                        </span>
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modelEditor);
        
        // Add animation class after a small delay to trigger transition
        requestAnimationFrame(() => {
            modelEditor.classList.add('show');
        });

        // Handle backdrop click
        const backdrop = modelEditor.querySelector('.model-editor-backdrop');
        backdrop.addEventListener('click', () => {
            closeModelEditor(modelEditor);
        });
        
        // Add event listeners
        const saveAllButton = modelEditor.querySelector('.save-all-models');
        const closeButtons = modelEditor.querySelectorAll('.close-editor');
        
        // Handle OpenRouter model input
        const openRouterSection = modelEditor.querySelector('.openrouter-models');
        if (openRouterSection) {
            const addModelInput = openRouterSection.querySelector('.add-model-input');
            const addModelButton = openRouterSection.querySelector('.add-model-button');
            const validationMessage = openRouterSection.querySelector('.model-validation-message');
            
            // Add input validation
            addModelInput.addEventListener('input', async () => {
                const modelId = addModelInput.value.trim();
                addModelButton.disabled = !modelId;
                
                if (modelId) {
                    try {
                        validationMessage.textContent = 'Checking model availability...';
                        validationMessage.className = 'model-validation-message loading';
                        
                        const response = await fetch('https://openrouter.ai/api/v1/models', {
                            method: 'GET',
                            headers: {
                                'Authorization': `Bearer ${await ApiKeyManager.getApiKey('openrouter')}`,
                                'Content-Type': 'application/json',
                                'HTTP-Referer': chrome.runtime.getURL(''),
                                'X-Title': 'LlamaBar'
                            }
                        });
                        
                        if (!response.ok) {
                            throw new Error('Failed to fetch models');
                        }
                        
                        const data = await response.json();
                        const modelExists = data.data.some(model => model.id === modelId);
                        
                        if (modelExists) {
                            validationMessage.textContent = 'Model is available ✓';
                            validationMessage.className = 'model-validation-message success';
                            addModelButton.disabled = false;
                        } else {
                            validationMessage.textContent = 'Model not found on OpenRouter';
                            validationMessage.className = 'model-validation-message error';
                            addModelButton.disabled = true;
                        }
                    } catch (error) {
                        console.error('Error validating model:', error);
                        validationMessage.textContent = 'Error checking model availability';
                        validationMessage.className = 'model-validation-message error';
                        addModelButton.disabled = true;
                    }
                } else {
                    validationMessage.textContent = '';
                    validationMessage.className = 'model-validation-message';
                }
            });
            
            // Add model button handler
            addModelButton.addEventListener('click', async () => {
                const modelId = addModelInput.value.trim();
                if (!modelId) return;
                
                const enabledModels = await ApiKeyManager.getEnabledModels('openrouter') || [];
                if (!enabledModels.includes(modelId)) {
                    enabledModels.push(modelId);
                    await ApiKeyManager.saveEnabledModels('openrouter', enabledModels);
                    
                    // Refresh the model editor
                    modelEditor.remove();
                    showModelEditor();
                }
            });
            
            // Remove model button handler
            openRouterSection.querySelectorAll('.remove-model-button').forEach(button => {
                button.addEventListener('click', async () => {
                    const modelId = button.dataset.model;
                    const enabledModels = await ApiKeyManager.getEnabledModels('openrouter') || [];
                    const updatedModels = enabledModels.filter(id => id !== modelId);
                    await ApiKeyManager.saveEnabledModels('openrouter', updatedModels);
                    
                    // Refresh the model editor
                    modelEditor.remove();
                    showModelEditor();
                });
            });
        }
        
        saveAllButton.addEventListener('click', async () => {
            // Show loading state
            const buttonContent = saveAllButton.querySelector('.button-content');
            const originalContent = buttonContent.innerHTML;
            buttonContent.innerHTML = `
                <svg class="loading-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span>Saving...</span>
            `;
            saveAllButton.disabled = true;

            try {
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
                closeModelEditor(modelEditor);
            } catch (error) {
                console.error('Error saving models:', error);
                showToast('Error saving models', 'error');
                // Restore button state
                buttonContent.innerHTML = originalContent;
                saveAllButton.disabled = false;
            }
        });
        
        closeButtons.forEach(button => {
            button.addEventListener('click', () => {
                closeModelEditor(modelEditor);
            });
        });

        // Add checkbox change handler to update model count
        modelEditor.querySelectorAll('.model-list').forEach(list => {
            const provider = list.closest('.provider-models');
            const countSpan = provider.querySelector('.model-count');
            
            list.addEventListener('change', () => {
                const total = list.querySelectorAll('input[type="checkbox"]').length;
                const checked = list.querySelectorAll('input[type="checkbox"]:checked').length;
                countSpan.textContent = `${checked} of ${total} enabled`;
            });
        });

        // Add default model handler
        const defaultModelSelect = modelEditor.querySelector('.default-model-select');
        const currentDefaultModel = await ApiKeyManager.getDefaultModel();
        if (currentDefaultModel) {
            defaultModelSelect.value = currentDefaultModel;
        }

        defaultModelSelect.addEventListener('change', async () => {
            const selectedModel = defaultModelSelect.value;
            if (selectedModel) {
                const [provider, modelId] = selectedModel.split(':');
                
                // Get current enabled models for the provider
                const enabledModels = await ApiKeyManager.getEnabledModels(provider) || [];
                
                // If the model isn't enabled, enable it
                if (!enabledModels.includes(modelId)) {
                    enabledModels.push(modelId);
                    await ApiKeyManager.saveEnabledModels(provider, enabledModels);
                    
                    // Update the checkbox in the UI
                    const checkbox = modelEditor.querySelector(`input[data-provider="${provider}"][data-model="${modelId}"]`);
                    if (checkbox) {
                        checkbox.checked = true;
                        
                        // Update the model count
                        const modelList = checkbox.closest('.model-list');
                        const countSpan = modelList.closest('.provider-models').querySelector('.model-count');
                        const total = modelList.querySelectorAll('input[type="checkbox"]').length;
                        const checked = modelList.querySelectorAll('input[type="checkbox"]:checked').length;
                        countSpan.textContent = `${checked} of ${total} enabled`;
                    }
                }
                
                await ApiKeyManager.saveDefaultModel(selectedModel);
                showToast('Default model updated successfully!');
            }
        });

        // Add styles for default model section
        const defaultModelStyles = document.createElement('style');
        defaultModelStyles.textContent = `
            .default-model-section {
                padding: 16px;
                border-bottom: 1px solid var(--border-color);
                margin-bottom: 16px;
            }

            .default-model-section h3 {
                margin: 0 0 12px 0;
                font-size: 16px;
                font-weight: 500;
                color: var(--text-color);
            }

            .default-model-select {
                width: 100%;
                padding: 8px 12px;
                border: 1px solid var(--border-color);
                border-radius: 6px;
                background: var(--background-color);
                color: var(--text-color);
                font-size: 14px;
                cursor: pointer;
                transition: border-color 0.2s;
            }

            .default-model-select:hover {
                border-color: var(--primary-color);
            }

            .default-model-select:focus {
                outline: none;
                border-color: var(--primary-color);
            }

            .default-model-select option {
                padding: 8px;
            }
        `;
        document.head.appendChild(defaultModelStyles);

        // Add animation class after a small delay to trigger transition
        requestAnimationFrame(() => {
            modelEditor.classList.add('show');
        });
    }

    // Function to close model editor with animation
    function closeModelEditor(modelEditor) {
        modelEditor.classList.remove('show');
        modelEditor.classList.add('hide');
        
        // Remove element after animation
        setTimeout(() => {
            modelEditor.remove();
        }, 300); // Match this with CSS animation duration
    }

    // Add styles for new UI elements
    const modelStyles = document.createElement('style');
    modelStyles.textContent = `
        .model-editor {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.3s ease, visibility 0.3s ease;
        }

        .model-editor.show {
            opacity: 1;
            visibility: visible;
        }

        .model-editor.hide {
            opacity: 0;
            visibility: hidden;
        }

        .model-editor-backdrop {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(4px);
        }

        .model-editor-content {
            position: relative;
            background: white;
            border-radius: 12px;
            max-width: 600px;
            width: 90%;
            max-height: 90vh;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            display: flex;
            flex-direction: column;
            transform: scale(0.95);
            opacity: 0;
            transition: transform 0.3s ease, opacity 0.3s ease;
        }

        .model-editor.show .model-editor-content {
            transform: scale(1);
            opacity: 1;
        }

        .model-editor-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 20px 24px;
            border-bottom: 1px solid #eee;
        }

        .model-editor-header h2 {
            margin: 0;
            font-size: 20px;
            font-weight: 600;
            color: #1a1a1a;
        }

        .model-editor-body {
            padding: 24px;
            overflow-y: auto;
            flex: 1;
        }

        .provider-models {
            margin-bottom: 32px;
            background: white;
            border-radius: 12px;
            overflow: hidden;
        }

        .provider-models:last-child {
            margin-bottom: 0;
        }

        .provider-header {
            display: flex;
            align-items: center;
            padding: 16px;
            background: #f8f9fa;
            border-bottom: 1px solid #eee;
            margin-bottom: 0;
        }

        .provider-header .provider-logo {
            width: 24px;
            height: 24px;
            border-radius: 6px;
            margin-right: 12px;
        }

        .provider-header h3 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: #1a1a1a;
        }

        .model-count {
            margin-left: auto;
            font-size: 14px;
            color: #666;
        }

        .model-list {
            display: flex;
            flex-direction: column;
            padding: 12px;
            gap: 8px;
        }

        .model-option {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: flex-start;
            padding: 12px;
            border-radius: 8px;
            background: #f8f9fa;
            transition: all 0.2s ease;
            gap: 12px;
            cursor: pointer;
            border: 1px solid transparent;
        }

        .model-option:hover {
            background: #f0f1f2;
            border-color: #e0e0e0;
        }

        .model-option.selected {
            background: #e8f0fe;
            border-color: #4285f4;
        }

        .checkbox-wrapper {
            position: relative;
            flex-shrink: 0;
            margin-top: 2px;
        }

        .checkbox-wrapper input[type="checkbox"] {
            position: absolute;
            opacity: 0;
            cursor: pointer;
        }

        .checkbox-custom {
            display: block;
            width: 18px;
            height: 18px;
            border: 2px solid #ddd;
            border-radius: 4px;
            background: white;
            transition: all 0.2s ease;
        }

        .checkbox-wrapper input[type="checkbox"]:checked + .checkbox-custom {
            background: #4285f4;
            border-color: #4285f4;
        }

        .checkbox-custom::after {
            content: '';
            position: absolute;
            left: 6px;
            top: 2px;
            width: 4px;
            height: 8px;
            border: solid white;
            border-width: 0 2px 2px 0;
            transform: rotate(45deg) scale(0);
            opacity: 0;
            transition: all 0.2s ease;
        }

        .checkbox-wrapper input[type="checkbox"]:checked + .checkbox-custom::after {
            transform: rotate(45deg) scale(1);
            opacity: 1;
        }

        .model-info {
            display: flex;
            flex-direction: column;
            flex: 1;
            min-width: 0;
        }

        .model-name {
            font-size: 14px;
            font-weight: 500;
            color: #1a1a1a;
            text-align: left;
        }

        .model-id {
            font-size: 12px;
            color: #666;
            margin-top: 2px;
            text-align: left;
        }

        .remove-model-button {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 4px;
            background: none;
            border: none;
            color: #666;
            cursor: pointer;
            transition: color 0.2s ease;
            opacity: 0;
            margin-left: auto;
        }

        .model-option:hover {
            background: #f0f1f2;
        }

        .model-option:hover .remove-model-button {
            opacity: 1;
        }

        .remove-model-button:hover {
            color: #FF3B30;
        }

        .model-editor-footer {
            display: flex;
            justify-content: flex-end;
            gap: 12px;
            padding: 20px 24px;
            border-top: 1px solid #eee;
        }

        .primary-button,
        .secondary-button {
            padding: 8px 16px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .primary-button {
            background: #007AFF;
            color: white;
            border: none;
        }

        .primary-button:hover {
            background: #0066CC;
        }

        .primary-button:disabled {
            background: #99C4FF;
            cursor: not-allowed;
        }

        .secondary-button {
            background: #f8f9fa;
            color: #1a1a1a;
            border: 1px solid #ddd;
        }

        .secondary-button:hover {
            background: #f0f1f2;
        }

        .close-editor {
            background: none;
            border: none;
            padding: 4px;
            cursor: pointer;
            color: #666;
            transition: color 0.2s ease;
        }

        .close-editor:hover {
            color: #1a1a1a;
        }

        .button-content {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .save-icon {
            width: 16px;
            height: 16px;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .loading-spinner {
            animation: spin 1s linear infinite;
        }

        .openrouter-models {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .add-model-section {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .add-model-input-group {
            display: flex;
            gap: 8px;
        }

        .add-model-input {
            flex: 1;
            padding: 8px 12px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 14px;
            transition: border-color 0.2s ease;
        }

        .add-model-input:focus {
            outline: none;
            border-color: #007AFF;
        }

        .add-model-button {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 12px;
            background: #007AFF;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .add-model-button:disabled {
            background: #99C4FF;
            cursor: not-allowed;
        }

        .add-model-button:not(:disabled):hover {
            background: #0066CC;
        }

        .model-validation-message {
            font-size: 13px;
            color: #666;
            min-height: 20px;
        }

        .model-validation-message.loading {
            color: #666;
        }

        .model-validation-message.success {
            color: #34C759;
        }

        .model-validation-message.error {
            color: #FF3B30;
        }
    `;
    document.head.appendChild(modelStyles);

    // Add styles for the helper message
    const helperStyles = document.createElement('style');
    helperStyles.textContent = `
        .helper-message {
            padding: 16px;
            cursor: default;
        }
        
        .helper-message:hover {
            background: #f8f9fa;
            border-color: transparent;
        }
        
        .helper-list {
            margin: 0;
            padding: 0;
            list-style: none;
            color: #666;
        }
        
        .helper-header {
            margin-bottom: 8px;
            font-weight: 500;
            color: #333;
        }
        
        .helper-list li:not(.helper-header) {
            margin: 8px 0;
            padding-left: 24px;
            position: relative;
        }
        
        .helper-list li:not(.helper-header):before {
            content: "•";
            position: absolute;
            left: 8px;
            color: #666;
        }
    `;
    document.head.appendChild(helperStyles);

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

    // Add scroll listener to detect when user manually scrolls
    document.getElementById('chat-messages').addEventListener('scroll', function() {
        const chatContainer = this;
        // Check if user has scrolled up
        isUserScrolled = chatContainer.scrollTop + chatContainer.clientHeight < chatContainer.scrollHeight - 10;
    });

    // Add warning message container
    const warningContainer = document.createElement('div');
    warningContainer.id = 'image-warning';
    warningContainer.className = 'image-warning';
    warningContainer.style.display = 'none';
    explainButtonContainer.appendChild(warningContainer);

    // Add styles for warning message
    const warningStyles = document.createElement('style');
    warningStyles.textContent = `
        .image-warning {
            color: #FF3B30;
            font-size: 12px;
            margin-left: 8px;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }
        
        .image-warning svg {
            width: 14px;
            height: 14px;
        }
    `;
    document.head.appendChild(warningStyles);

    // Add drag and drop event listeners
    const inputWrapper = document.querySelector('.input-wrapper');
    
    inputWrapper.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        inputWrapper.classList.add('drag-over');
    });

    inputWrapper.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        inputWrapper.classList.remove('drag-over');
    });

    inputWrapper.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        inputWrapper.classList.remove('drag-over');

        const items = e.dataTransfer.items;
        for (const item of items) {
            if (item.type.indexOf('image') === 0) {
                const file = item.getAsFile();
                const reader = new FileReader();
                
                reader.onload = async function(event) {
                    // Match the paste handler's simpler approach
                    currentImage = event.target.result;
                    displayImagePreview(currentImage);

                    // Check if current model supports vision
                    const modelName = currentModel.replace('local:', '');
                    const isVisionModel = modelName.toLowerCase().includes('vision') || 
                                        modelName.toLowerCase().includes('dream') || 
                                        modelName.toLowerCase().includes('image');

                    // Show warning if model doesn't support vision
                    if (!isVisionModel) {
                        warningContainer.innerHTML = `
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                            Current model doesn't support images
                        `;
                        warningContainer.style.display = 'inline-flex';
                        inputExplainButton.style.display = 'none';
                    } else {
                        warningContainer.style.display = 'none';
                        // Only show explain button if there's text
                        const text = userInput.value.trim();
                        inputExplainButton.style.display = text ? 'block' : 'none';
                    }
                };
                
                reader.readAsDataURL(file);
                break;
            }
        }
    });
} catch (error) {
    console.error('❌ Initialization error:', error);
} 