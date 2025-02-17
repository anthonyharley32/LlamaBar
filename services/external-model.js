import { ApiKeyManager } from '../utils/api-key-manager.js';

export class ExternalModelService {
    static async generateResponse(provider, modelId, prompt, options = {}) {
        const handler = this.getProviderHandler(provider);
        if (!handler) {
            throw new Error(`Unsupported provider: ${provider}`);
        }
        return handler(modelId, prompt, options);
    }

    static getProviderHandler(provider) {
        const handlers = {
            'openai': this.handleOpenAI,
            'anthropic': this.handleAnthropic,
            'gemini': this.handleGemini,
            'perplexity': this.handlePerplexity,
            'openrouter': this.handleOpenRouter
        };
        return handlers[provider];
    }

    static async handleOpenAI(modelId, prompt, options = {}) {
        const apiKey = await ApiKeyManager.getApiKey('openai');
        if (!apiKey) {
            throw new Error('OpenAI API key not found');
        }

        const messages = [];
        if (options.hasImage) {
            const base64Image = prompt.match(/<image>(.*?)<\/image>/)?.[1];
            const text = prompt.replace(/<image>.*?<\/image>\n?/, '').trim();
            
            if (!base64Image) {
                throw new Error('Image data is missing or invalid');
            }

            messages.push({
                role: 'user',
                content: [
                    { type: 'text', text },
                    {
                        type: 'image_url',
                        image_url: { url: base64Image }
                    }
                ]
            });
        } else {
            messages.push({
                role: 'user',
                content: prompt
            });
        }

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: modelId,
                messages,
                stream: true
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
        }

        return ExternalModelService.handleOpenAIStream(response);
    }

    static async *handleOpenAIStream(response) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim() || line === 'data: [DONE]') continue;

                    const jsonStr = line.replace(/^data: /, '').trim();
                    if (!jsonStr) continue;

                    try {
                        const json = JSON.parse(jsonStr);
                        const content = json.choices?.[0]?.delta?.content || '';
                        if (content) {
                            yield {
                                type: 'success',
                                content,
                                done: false
                            };
                        }
                    } catch (e) {
                        console.error('Error parsing OpenAI SSE message:', e);
                    }
                }
            }

            // Handle any remaining buffer content
            if (buffer.trim()) {
                const jsonStr = buffer.replace(/^data: /, '').trim();
                if (jsonStr && jsonStr !== '[DONE]') {
                    try {
                        const json = JSON.parse(jsonStr);
                        const content = json.choices?.[0]?.delta?.content || '';
                        if (content) {
                            yield {
                                type: 'success',
                                content,
                                done: false
                            };
                        }
                    } catch (e) {
                        console.error('Error parsing final buffer:', e);
                    }
                }
            }

            yield {
                type: 'success',
                content: '',
                done: true
            };
        } finally {
            reader.releaseLock();
        }
    }

    static async handleAnthropic(modelId, prompt, options = {}) {
        const apiKey = await ApiKeyManager.getApiKey('anthropic');
        if (!apiKey) {
            throw new Error('Anthropic API key not found');
        }

        const messages = [];
        if (options.hasImage) {
            const base64Image = prompt.match(/<image>(.*?)<\/image>/)?.[1];
            const text = prompt.replace(/<image>.*?<\/image>\n?/, '').trim();
            
            messages.push({
                role: 'user',
                content: [
                    { type: 'text', text },
                    base64Image ? {
                        type: 'image',
                        source: { type: 'base64', data: base64Image }
                    } : null
                ].filter(Boolean)
            });
        } else {
            messages.push({
                role: 'user',
                content: prompt
            });
        }

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                model: modelId,
                messages,
                stream: true
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || `API error: ${response.status}`);
        }

        return ExternalModelService.handleAnthropicStream(response);
    }

    static async *handleAnthropicStream(response) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim() || line === 'data: [DONE]') continue;
                    
                    try {
                        const json = JSON.parse(line.replace(/^data: /, ''));
                        const content = json.delta?.text || '';
                        if (content) {
                            yield {
                                type: 'success',
                                content,
                                done: false
                            };
                        }
                    } catch (e) {
                        console.error('Error parsing Anthropic SSE message:', e);
                    }
                }
            }

            yield {
                type: 'success',
                content: '',
                done: true
            };
        } finally {
            reader.releaseLock();
        }
    }

    // Similar implementations for Gemini, Perplexity, and OpenRouter...
    static async handleGemini(modelId, prompt, options = {}) {
        const apiKey = await ApiKeyManager.getApiKey('gemini');
        if (!apiKey) {
            throw new Error('Gemini API key not found');
        }

        // Implementation similar to other providers...
        throw new Error('Gemini implementation pending');
    }

    static async handlePerplexity(modelId, prompt, options = {}) {
        const apiKey = await ApiKeyManager.getApiKey('perplexity');
        if (!apiKey) {
            throw new Error('Perplexity API key not found');
        }

        // Implementation similar to other providers...
        throw new Error('Perplexity implementation pending');
    }

    static async handleOpenRouter(modelId, prompt, options = {}) {
        const apiKey = await ApiKeyManager.getApiKey('openrouter');
        if (!apiKey) {
            throw new Error('OpenRouter API key not found');
        }

        // Implementation similar to other providers...
        throw new Error('OpenRouter implementation pending');
    }
} 