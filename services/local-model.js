const OLLAMA_API = 'http://localhost:11434';

export class LocalModelService {
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

    static async generateResponse(prompt, model, options = {}) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        try {
            // Verify server is running
            if (!await this.checkServerStatus()) {
                throw new Error('Ollama server is not running');
            }

            // Check if model exists
            const models = await this.getAvailableModels();
            if (!models.some(m => m.name === model)) {
                throw new Error(`Model ${model} not found`);
            }

            const isVisionModel = model.toLowerCase().includes('vision') || 
                                model.toLowerCase().includes('dream') || 
                                model.toLowerCase().includes('image');

            console.log('Model request details:', {
                model,
                isVisionModel,
                hasImage: prompt.includes('<image>'),
                promptLength: prompt.length
            });

            if (isVisionModel && prompt.includes('<image>')) {
                return this.handleVisionRequest(prompt, model);
            } else {
                return this.handleTextRequest(prompt, model, options);
            }
        } catch (error) {
            console.error('Generation error:', error);
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    static async handleVisionRequest(prompt, model) {
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
            body: JSON.stringify(requestBody)
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
            type: 'success',
            content: data.message.content,
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
            body: JSON.stringify(requestBody)
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
                            yield {
                                type: 'success',
                                content: data.response,
                                done: data.done
                            };
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