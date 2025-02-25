let currentStep = 1;
let connectionAttempts = 0;
const MAX_ATTEMPTS = 3;

// Detect user's operating system
function detectOS() {
    const platform = navigator.platform.toLowerCase();
    
    if (platform.includes('mac') || platform.includes('darwin')) {
        return 'mac';
    } else if (platform.includes('win')) {
        return 'windows';
    } else if (platform.includes('linux') || platform.includes('x11')) {
        return 'linux';
    } else {
        return 'unknown';
    }
}

// Show only relevant OS installation instructions
function showRelevantOSInstructions() {
    const userOS = detectOS();
    
    // Handle installation options
    const installOptions = document.querySelectorAll('.install-option');
    installOptions.forEach(option => {
        if (option.classList.contains(userOS) || option.classList.contains('all-os')) {
            option.style.display = 'block';
        } else {
            option.style.display = 'none';
        }
    });
    
    // Handle start instructions
    const startInstructions = document.querySelectorAll('.os-specific-instructions');
    startInstructions.forEach(instruction => {
        if (instruction.classList.contains(userOS) || instruction.classList.contains('all-os')) {
            instruction.style.display = 'block';
        } else {
            instruction.style.display = 'none';
        }
    });
    
    // Show "Show all options" button if we detected a specific OS
    const showAllButton = document.getElementById('showAllOptions');
    if (showAllButton) {
        if (userOS !== 'unknown') {
            showAllButton.style.display = 'block';
        } else {
            showAllButton.style.display = 'none';
        }
    }
    
    // Add OS class to body for potential CSS targeting
    document.body.classList.add('os-' + userOS);
}

// Toggle showing all OS options
function toggleAllOSOptions() {
    const installOptions = document.querySelectorAll('.install-option');
    const startInstructions = document.querySelectorAll('.os-specific-instructions');
    const showAllButton = document.getElementById('showAllOptions');
    
    if (showAllButton.textContent.includes('Show all')) {
        // Show all options
        installOptions.forEach(option => {
            option.style.display = 'block';
        });
        
        // For start instructions, we still only show one set to avoid confusion
        // But we add a note that there are different instructions for different OS
        const osNote = document.createElement('p');
        osNote.className = 'note os-note';
        osNote.textContent = 'Note: Instructions may vary depending on your operating system.';
        
        const existingNote = document.querySelector('.os-note');
        if (!existingNote) {
            const firstVisibleInstructions = startInstructions[0];
            if (firstVisibleInstructions && firstVisibleInstructions.parentNode) {
                firstVisibleInstructions.parentNode.insertBefore(osNote, firstVisibleInstructions);
            }
        }
        
        showAllButton.textContent = 'Show only my OS';
    } else {
        // Show only relevant OS
        showRelevantOSInstructions();
        
        // Remove the OS note
        const osNote = document.querySelector('.os-note');
        if (osNote) {
            osNote.remove();
        }
        
        showAllButton.textContent = 'Show all options';
    }
}

// Step navigation
function showStep(step) {
    document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    document.getElementById(`step${step}`).classList.add('active');
    currentStep = step;
}

// Toggle setup step collapse/expand
function toggleSetupStep(element) {
    element.classList.toggle('collapsed');
}

// Update step status
function updateStepStatus(stepId, status) {
    const stepElement = document.querySelector(`.setup-step[data-step="${stepId}"]`);
    if (stepElement) {
        const statusDot = stepElement.querySelector('.setup-step-status');
        if (statusDot) {
            statusDot.className = 'setup-step-status ' + status;
            
            // If this is the install step and status is success, collapse it
            if (stepId === 'install' && status === 'success') {
                stepElement.classList.add('collapsed');
            }
        }
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
    
    statusEl.className = 'status-indicator pending';
    statusEl.textContent = 'Checking for installed models...';
    
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
    // Add event listeners for collapsible steps
    document.querySelectorAll('.setup-step-header').forEach(header => {
        header.addEventListener('click', () => {
            toggleSetupStep(header.closest('.setup-step'));
        });
    });
    
    // Add event listener for the checkbox
    const ollamaServedCheckbox = document.getElementById('ollamaServedCheckbox');
    const nextButton = document.getElementById('nextStep1');
    
    if (ollamaServedCheckbox) {
        ollamaServedCheckbox.addEventListener('change', function() {
            // Enable/disable the Next button based on checkbox state
            nextButton.disabled = !this.checked;
            
            if (this.checked) {
                // Update step status for install and collapse it
                updateStepStatus('install', 'success');
                
                // Explicitly collapse the install step
                const installStep = document.querySelector('.setup-step[data-step="install"]');
                if (installStep) {
                    installStep.classList.add('collapsed');
                }
                
                // Remove disabled class from Next button
                nextButton.classList.remove('disabled');
            } else {
                // Add disabled class to Next button
                nextButton.classList.add('disabled');
            }
        });
    }
    
    // Add event listener for "Show all options" button
    const showAllButton = document.getElementById('showAllOptions');
    if (showAllButton) {
        showAllButton.addEventListener('click', toggleAllOSOptions);
    }
    
    // Navigation buttons
    document.getElementById('nextStep1').addEventListener('click', () => {
        showStep(2);
        // Check for models when entering step 2
        checkInstalledModels();
    });
    document.getElementById('prevStep2').addEventListener('click', () => {
        showStep(1);
    });
    document.getElementById('nextStep2').addEventListener('click', () => showStep(3));
    document.getElementById('prevStep3').addEventListener('click', () => showStep(2));
    document.getElementById('finish').addEventListener('click', () => {
        window.parent.postMessage({ type: 'SETUP_COMPLETE' }, '*');
    });
    
    // Set install step to success by default
    updateStepStatus('install', 'success');
    
    // Collapse the install step since it's set to success by default
    const installStep = document.querySelector('.setup-step[data-step="install"]');
    if (installStep) {
        installStep.classList.add('collapsed');
    }
    
    // Always show CORS instructions
    const terminalInstructions = document.getElementById('terminalInstructions');
    if (terminalInstructions) {
        terminalInstructions.style.display = 'block';
    }
    
    // Show only relevant OS installation instructions
    showRelevantOSInstructions();
}

// Poll for model status every 5 seconds when on step 2
setInterval(() => {
    if (currentStep === 2) {
        checkInstalledModels();
    }
}, 5000);

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initWizard); 