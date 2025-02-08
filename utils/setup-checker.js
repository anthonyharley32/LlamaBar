// Utility functions to check Ollama setup status

export async function checkOllamaInstallation() {
    try {
        const response = await fetch('http://localhost:11434/api/version');
        if (response.ok) {
            const data = await response.json();
            return {
                installed: true,
                version: data.version
            };
        }
        return { 
            installed: false, 
            error: 'Ollama server not running with correct permissions. Please restart with OLLAMA_ORIGINS setting.' 
        };
    } catch (error) {
        if (error.message.includes('403')) {
            return { 
                installed: false, 
                error: 'Ollama is running but needs CORS permissions. Please restart with OLLAMA_ORIGINS setting.' 
            };
        }
        return { 
            installed: false, 
            error: 'Ollama not installed or not running' 
        };
    }
}

export async function checkRequiredModel(modelName = 'llama3.2:1b') {
    try {
        const response = await fetch('http://localhost:11434/api/tags');
        if (response.ok) {
            const data = await response.json();
            const hasModel = data.models.some(model => model.name === modelName);
            return { hasModel, models: data.models };
        }
        return { hasModel: false, error: 'Could not check models' };
    } catch (error) {
        return { hasModel: false, error: 'Could not connect to Ollama' };
    }
}

export function getOllamaStartInstructions() {
    const platform = navigator.platform.toLowerCase();
    
    if (platform.includes('win')) {
        return `
1. First, stop any running Ollama process:
   - Open Task Manager
   - Find "ollama.exe" and end the task
   - Or run in Command Prompt as Admin: taskkill /F /IM ollama.exe

2. Open Command Prompt or PowerShell as Administrator
3. Run this command:
   set OLLAMA_ORIGINS=chrome-extension://* && ollama serve

Note: 
- Keep the terminal window open while using the extension
- Ollama will keep running in the background even after closing the extension
- To stop Ollama completely, close the terminal window or press Ctrl+C`;
    } else if (platform.includes('mac')) {
        return `
1. First, stop any running Ollama process:
   killall ollama
   
   If you see "address in use" error, also run:
   sudo kill -9 $(lsof -t -i:11434)

2. Then start Ollama with CORS enabled:
   OLLAMA_ORIGINS="chrome-extension://*" ollama serve

Note: 
- Keep the terminal window open while using the extension
- Ollama will keep running in the background even after closing the extension
- To stop Ollama completely, either:
  • Close the terminal window
  • Press Ctrl+C in the terminal
  • Run 'killall ollama' in a new terminal`;
    } else {
        return `
1. First, stop any running Ollama process:
   killall ollama
   
   If you see "address in use" error, also run:
   sudo kill -9 $(lsof -t -i:11434)

2. Then start Ollama with CORS enabled:
   OLLAMA_ORIGINS="chrome-extension://*" ollama serve

Note: 
- Keep the terminal window open while using the extension
- Ollama will keep running in the background even after closing the extension
- To stop Ollama completely, either:
  • Close the terminal window
  • Press Ctrl+C in the terminal
  • Run 'killall ollama' in a new terminal`;
    }
} 