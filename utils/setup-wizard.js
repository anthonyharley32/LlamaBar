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
function copyCommand() {
    const command = 'OLLAMA_ORIGINS="chrome-extension://*" ollama serve';
    
    // Create a temporary input element
    const input = document.createElement('input');
    input.style.position = 'fixed';
    input.style.opacity = 0;
    input.value = command;
    document.body.appendChild(input);
    
    // Select the text
    input.select();
    input.setSelectionRange(0, 99999); // For mobile devices
    
    // Copy the text
    try {
        document.execCommand('copy');
        const copyButton = document.querySelector('.copy-button');
        copyButton.textContent = 'Copied!';
        copyButton.classList.add('copy-success');
        
        setTimeout(() => {
            copyButton.textContent = 'Copy';
            copyButton.classList.remove('copy-success');
        }, 2000);
    } catch (err) {
        console.error('Copy failed:', err);
        const copyButton = document.querySelector('.copy-button');
        copyButton.textContent = 'Failed';
        copyButton.classList.add('copy-error');
        
        setTimeout(() => {
            copyButton.textContent = 'Copy';
            copyButton.classList.remove('copy-error');
        }, 2000);
    }
    
    // Clean up
    document.body.removeChild(input);
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

// Initialize the wizard
function initWizard() {
    // Add event listeners
    document.getElementById('checkOllama').addEventListener('click', checkOllamaConnection);
    document.getElementById('installModel').addEventListener('click', installModel);
    
    // Navigation buttons
    document.getElementById('nextStep1').addEventListener('click', () => showStep(2));
    document.getElementById('prevStep2').addEventListener('click', () => showStep(1));
    document.getElementById('nextStep2').addEventListener('click', () => showStep(3));
    document.getElementById('prevStep3').addEventListener('click', () => showStep(2));
    document.getElementById('finish').addEventListener('click', () => {
        window.parent.postMessage({ type: 'SETUP_COMPLETE' }, '*');
    });

    // Make copyCommand available globally
    window.copyCommand = copyCommand;
    
    // Initial connection check
    checkOllamaConnection();
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initWizard); 