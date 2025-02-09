let currentStep = 1;
let connectionAttempts = 0;
const MAX_ATTEMPTS = 3;

// Step navigation
function showStep(step) {
    document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    document.getElementById(`step${step}`).classList.add('active');
    currentStep = step;
}

// Copy command to clipboard
async function copyCommand(command) {
    const button = event.target;
    
    try {
        // Try using the Clipboard API first
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(command);
        } else {
            // Fallback for non-secure contexts or when Clipboard API is not available
            const textArea = document.createElement('textarea');
            textArea.value = command;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            
            try {
                document.execCommand('copy');
                textArea.remove();
            } catch (err) {
                console.error('Fallback: Oops, unable to copy', err);
                textArea.remove();
                throw new Error('Copy failed');
            }
        }
        
        // Success feedback
        button.textContent = 'Copied!';
        button.classList.add('copy-success');
        
        setTimeout(() => {
            button.textContent = 'Copy';
            button.classList.remove('copy-success');
        }, 2000);
    } catch (err) {
        console.error('Copy failed:', err);
        button.textContent = 'Failed';
        button.classList.add('copy-error');
        
        setTimeout(() => {
            button.textContent = 'Copy';
            button.classList.remove('copy-error');
        }, 2000);
    }
}

// Check Ollama connection
async function checkOllamaConnection() {
    const statusEl = document.getElementById('ollamaStatus');
    const terminalInstructions = document.getElementById('terminalInstructions');
    const nextButton = document.getElementById('nextStep1');
    statusEl.className = 'status-indicator pending';
    statusEl.textContent = 'Checking Ollama connection...';
    
    try {
        // Try to connect multiple times with a delay
        for (connectionAttempts = 0; connectionAttempts < MAX_ATTEMPTS; connectionAttempts++) {
            try {
                const response = await fetch('http://localhost:11434/api/version');
                if (response.ok) {
                    const version = await response.json();
                    
                    // Check if CORS is properly configured
                    const modelResponse = await fetch('http://localhost:11434/api/tags');
                    if (modelResponse.ok) {
                        statusEl.className = 'status-indicator success';
                        statusEl.textContent = `Successfully connected to Ollama ${version.version}!`;
                        nextButton.disabled = false;
                        nextButton.classList.remove('disabled');
                        terminalInstructions.style.display = 'none';
                        return;
                    }
                }
            } catch (e) {
                console.error('Connection attempt failed:', e);
            }
            
            // Wait before next attempt
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // If we get here, all attempts failed
        throw new Error('Could not connect to Ollama');
        
    } catch (error) {
        console.error('Connection check failed:', error);
        statusEl.className = 'status-indicator error';
        statusEl.textContent = 'Could not connect to Ollama. Please follow the instructions below.';
        nextButton.disabled = true;
        nextButton.classList.add('disabled');
        terminalInstructions.style.display = 'block';
    }
}

// Install model
async function installModel() {
    const statusEl = document.getElementById('modelStatus');
    statusEl.className = 'status-indicator pending';
    statusEl.textContent = 'Installing model...';
    
    try {
        const response = await fetch('http://localhost:11434/api/pull', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'llama3.2:1b' })
        });
        
        if (response.ok) {
            statusEl.className = 'status-indicator success';
            statusEl.textContent = 'Model installed successfully';
            document.getElementById('nextStep2').disabled = false;
        } else {
            throw new Error('Failed to install model');
        }
    } catch (error) {
        statusEl.className = 'status-indicator error';
        statusEl.textContent = 'Failed to install model: ' + error.message;
    }
}

// Check for installed models
async function checkInstalledModels() {
    const statusEl = document.getElementById('modelStatus');
    const nextButton = document.getElementById('nextStep2');
    
    try {
        const response = await fetch('http://localhost:11434/api/tags');
        if (response.ok) {
            const data = await response.json();
            if (data.models && data.models.length > 0) {
                statusEl.className = 'status-indicator success';
                statusEl.textContent = 'Model detected! You can proceed.';
                nextButton.disabled = false;
                return true;
            } else {
                statusEl.className = 'status-indicator pending';
                statusEl.textContent = 'No models installed yet. Please run the command above.';
                nextButton.disabled = true;
                return false;
            }
        } else {
            throw new Error('Failed to check models');
        }
    } catch (error) {
        console.error('Model check failed:', error);
        statusEl.className = 'status-indicator error';
        statusEl.textContent = 'Failed to check models. Please ensure Ollama is running.';
        nextButton.disabled = true;
        return false;
    }
}

// Initialize the wizard
function initWizard() {
    // Add event listeners
    document.getElementById('checkOllama').addEventListener('click', checkOllamaConnection);
    
    // Navigation buttons
    document.getElementById('nextStep1').addEventListener('click', () => {
        showStep(2);
        // Check for models when entering step 2
        checkInstalledModels();
    });
    document.getElementById('prevStep2').addEventListener('click', () => showStep(1));
    document.getElementById('nextStep2').addEventListener('click', () => showStep(3));
    document.getElementById('prevStep3').addEventListener('click', () => showStep(2));
    document.getElementById('finish').addEventListener('click', () => {
        window.parent.postMessage({ type: 'SETUP_COMPLETE' }, '*');
    });
    
    // Initial connection check
    checkOllamaConnection();
}

// Poll for model status every 5 seconds when on step 2
setInterval(() => {
    if (currentStep === 2) {
        checkInstalledModels();
    }
}, 5000);

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initWizard); 