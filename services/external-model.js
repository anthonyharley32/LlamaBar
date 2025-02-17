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
        return this.handleProviderStream(
            response,
            'OpenAI',
            json => json.choices?.[0]?.delta?.content || ''
        );
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
        return this.handleProviderStream(
            response,
            'Anthropic',
            json => json.delta?.text || ''
        );
    }

    // Generic streaming handler for all providers
    static async *handleProviderStream(response, provider, contentExtractor) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulatedContent = '';

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
                        const content = contentExtractor(json);
                        if (content) {
                            accumulatedContent += content;
                            yield {
                                type: 'MODEL_RESPONSE',
                                success: true,
                                delta: {
                                    content: content
                                },
                                response: accumulatedContent,
                                done: false
                            };
                        }
                    } catch (e) {
                        console.error(`Error parsing ${provider} SSE message:`, e);
                    }
                }
            }

            // Send completion signal
            if (accumulatedContent) {
                yield {
                    type: 'MODEL_RESPONSE',
                    success: true,
                    delta: {
                        content: ''
                    },
                    response: accumulatedContent,
                    done: true
                };
            }
        } finally {
            reader.releaseLock();
        }
    }

    static async handleGemini(modelId, prompt, options = {}) {
        const apiKey = await ApiKeyManager.getApiKey('gemini');
        if (!apiKey) {
            throw new Error('Gemini API key not found');
        }

        const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/${modelId}:streamGenerateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 2048
                }
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || `Gemini API error: ${response.status}`);
        }

        return this.handleGeminiStream(response);
    }

    static async *handleGeminiStream(response) {
        return this.handleProviderStream(
            response,
            'Gemini',
            json => json.candidates?.[0]?.content?.parts?.[0]?.text || ''
        );
    }

    static async handlePerplexity(modelId, prompt, options = {}) {
        const apiKey = await ApiKeyManager.getApiKey('perplexity');
        if (!apiKey) {
            throw new Error('Perplexity API key not found');
        }

        const response = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: modelId,
                messages: [{ role: 'user', content: prompt }],
                stream: true
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || `Perplexity API error: ${response.status}`);
        }

        return this.handlePerplexityStream(response);
    }

    static async *handlePerplexityStream(response) {
        return this.handleProviderStream(
            response,
            'Perplexity',
            json => json.choices?.[0]?.delta?.content || ''
        );
    }

    static async handleOpenRouter(modelId, prompt, options = {}) {
        const apiKey = await ApiKeyManager.getApiKey('openrouter');
        if (!apiKey) {
            throw new Error('OpenRouter API key not found');
        }

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': chrome.runtime.getURL(''),
                'X-Title': 'LlamaBar'
            },
            body: JSON.stringify({
                model: modelId,
                messages: [{ role: 'user', content: prompt }],
                stream: true
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || `OpenRouter API error: ${response.status}`);
        }

        return this.handleOpenRouterStream(response);
    }

    static async *handleOpenRouterStream(response) {
        return this.handleProviderStream(
            response,
            'OpenRouter',
            json => json.choices?.[0]?.delta?.content || ''
        );
    }
} 