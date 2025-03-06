const OLLAMA_API = 'http://localhost:11434';

export class LocalModelService {
    static abortController = null;

    static async checkServerStatus() {
        try {
            const response = await fetch(`${OLLAMA_API}/api/version`);
            return response.ok;
        } catch (error) {
            console.error('Ollama server check failed:', error);
            return false;
        }
    }

    static async startServer() {
        try {
            if (await this.checkServerStatus()) {
                console.log('Ollama is already running');
                return true;
            }

            console.log('Attempting to start Ollama server...');
            chrome.runtime.sendNativeMessage('com.ollama.native', {
                command: 'start_server',
                args: 'OLLAMA_ORIGINS="chrome-extension://*" ollama serve'
            });

            // Wait for server to start
            let attempts = 0;
            while (attempts < 10) {
                if (await this.checkServerStatus()) {
                    console.log('Ollama server started successfully');
                    return true;
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
                attempts++;
            }

            console.error('Timeout waiting for Ollama server to start');
            return false;
        } catch (error) {
            console.error('Error starting Ollama server:', error);
            return false;
        }
    }

    static async stopServer() {
        try {
            chrome.runtime.sendNativeMessage('com.ollama.native', {
                command: 'stop_server'
            });
            return true;
        } catch (error) {
            console.error('Error stopping Ollama server:', error);
            return false;
        }
    }

    static async getAvailableModels() {
        try {
            const response = await fetch(`${OLLAMA_API}/api/tags`);
            if (!response.ok) {
                throw new Error('Failed to fetch models');
            }
            const data = await response.json();
            return data.models || [];
        } catch (error) {
            console.error('Error fetching models:', error);
            return [];
        }
    }

    static async getModelCapabilities(model) {
        try {
            // First check if model exists
            const models = await this.getAvailableModels();
            const modelInfo = models.find(m => m.name === model);
            
            if (!modelInfo) {
                throw new Error(`Model ${model} not found`);
            }

            // Get model details using modelfile show
            const response = await fetch(`${OLLAMA_API}/api/show`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name: model })
            });

            if (!response.ok) {
                throw new Error('Failed to fetch model capabilities');
            }

            const data = await response.json();
            const modelfile = data.modelfile || '';
            
            // Parse modelfile for capabilities
            const capabilities = {
                vision: false,
                // Add other capabilities as needed
            };

            // Check for vision capability through modelfile parameters
            capabilities.vision = modelfile.includes('multimodal') || 
                                modelfile.includes('vision') ||
                                modelfile.includes('clip');

            return capabilities;
        } catch (error) {
            console.error('Error fetching model capabilities:', error);
            // Default to conservative capabilities if we can't determine
            return {
                vision: false
            };
        }
    }

    static async generateResponse(prompt, model, options = {}) {
        // Create new AbortController for this request
        this.abortController = new AbortController();
        const signal = this.abortController.signal;
        const timeoutId = setTimeout(() => this.abortController.abort(), 30000);

        try {
            // Verify server is running
            if (!await this.checkServerStatus()) {
                throw new Error('Ollama server is not running');
            }

            // Get model capabilities
            const capabilities = await this.getModelCapabilities(model);
            const hasImageInput = prompt.includes('<image>');

            // Check if trying to use image with non-vision model
            if (hasImageInput && !capabilities.vision) {
                throw new Error(`Model ${model} does not support image input. Please use a vision-capable model.`);
            }

            console.log('Model request details:', {
                model,
                capabilities,
                hasImage: hasImageInput,
                promptLength: prompt.length
            });

            // Add signal event listener for cleanup
            signal.addEventListener('abort', () => {
                if (options.onCancel) {
                    options.onCancel();
                }
            });

            if (capabilities.vision && hasImageInput) {
                return this.handleVisionRequest(prompt, model, { ...options, signal });
            } else {
                return this.handleTextRequest(prompt, model, { ...options, signal });
            }
        } catch (error) {
            console.error('Generation error:', error);
            // Check if this was an abort error
            if (error.name === 'AbortError') {
                throw new Error('Generation stopped by user');
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
            // Ensure AbortController is cleaned up
            if (this.abortController?.signal.aborted) {
                this.abortController = null;
            }
        }
    }

    static stopGeneration() {
        if (this.abortController) {
            try {
                this.abortController.abort();
            } catch (error) {
                console.error('Error aborting generation:', error);
            } finally {
                this.abortController = null;
            }
        }
    }

    static async handleVisionRequest(prompt, model, options = {}) {
        const imageMatch = prompt.match(/<image>(.*?)<\/image>/s);
        const base64Image = imageMatch ? imageMatch[1] : null;
        const textPrompt = prompt.replace(/<image>.*?<\/image>/s, '').trim();

        if (!base64Image) {
            throw new Error('Image data is missing or invalid');
        }

        const cleanBase64 = base64Image.replace(/^data:image\/[a-z]+;base64,/, '');
        
        const requestBody = {
            model,
            messages: [{
                role: "user",
                content: textPrompt || "Describe this image",
                images: [cleanBase64]
            }],
            stream: false,
            options: {
                temperature: 0.0,
                num_predict: 500
            }
        };

        const response = await fetch(`${OLLAMA_API}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody),
            signal: options.signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Vision request failed: ${response.status} ${response.statusText}\n${errorText}`);
        }

        const data = await response.json();
        if (!data.message?.content) {
            throw new Error('Invalid response format from vision model');
        }

        return {
            type: 'MODEL_RESPONSE',
            success: true,
            response: data.message.content,
            done: true
        };
    }

    static async handleTextRequest(prompt, model, options = {}) {
        const requestBody = {
            model,
            prompt,
            stream: true,
            options: {
                temperature: options.temperature || 0.7,
                top_k: options.top_k || 50,
                top_p: options.top_p || 0.95,
                repeat_penalty: options.repeat_penalty || 1.1
            }
        };

        const response = await fetch(`${OLLAMA_API}/api/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody),
            signal: options.signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Text request failed: ${response.status} ${response.statusText}\n${errorText}`);
        }

        return this.handleStreamingResponse(response);
    }

    static async *handleStreamingResponse(response) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulatedContent = '';

        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (!line.trim()) continue;

                    try {
                        const data = JSON.parse(line);
                        if (data.response) {
                            const newContent = data.response;
                            accumulatedContent += newContent;
                            yield {
                                type: 'MODEL_RESPONSE',
                                success: true,
                                delta: {
                                    content: newContent
                                },
                                response: accumulatedContent,
                                done: data.done
                            };

                            if (data.done) {
                                return;
                            }
                        }
                    } catch (e) {
                        console.error('Error parsing response chunk:', e);
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }
} 