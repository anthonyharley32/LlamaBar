import { ApiKeyManager } from './api-key-manager.js';

export class ApiService {
    static async callApi(provider, model, prompt, options = {}) {
        const apiKey = await ApiKeyManager.getApiKey(provider);
        if (!apiKey) {
            throw new Error(`No API key found for ${provider}`);
        }

        switch (provider) {
            case 'openai':
                return this.callOpenAI(model, prompt, apiKey, options);
            case 'anthropic':
                return this.callAnthropic(model, prompt, apiKey, options);
            case 'openrouter':
                return this.callOpenRouter(model, prompt, apiKey, options);
            case 'perplexity':
                return this.callPerplexity(model, prompt, apiKey, options);
            case 'gemini':
                return this.callGemini(model, prompt, apiKey, options);
            default:
                throw new Error(`Unsupported provider: ${provider}`);
        }
    }

    static async callOpenAI(model, prompt, apiKey, options) {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model,
                messages: [{ role: 'user', content: prompt }],
                stream: true,
                ...options
            })
        });

        if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.statusText}`);
        }

        return response.body;
    }

    static async callAnthropic(model, prompt, apiKey, options) {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: model,
                messages: [{ role: 'user', content: prompt }],
                stream: true,
                ...options
            })
        });

        if (!response.ok) {
            throw new Error(`Anthropic API error: ${response.statusText}`);
        }

        return response.body;
    }

    static async callOpenRouter(model, prompt, apiKey, options) {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': chrome.runtime.getURL(''),
                'X-Title': 'LlamaBar'
            },
            body: JSON.stringify({
                model: model,
                messages: [{ role: 'user', content: prompt }],
                stream: true,
                ...options
            })
        });

        if (!response.ok) {
            throw new Error(`OpenRouter API error: ${response.statusText}`);
        }

        return response.body;
    }

    static async callPerplexity(model, prompt, apiKey, options) {
        const response = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model,
                messages: [{ role: 'user', content: prompt }],
                stream: true,
                ...options
            })
        });

        if (!response.ok) {
            throw new Error(`Perplexity API error: ${response.statusText}`);
        }

        return response.body;
    }

    static async callGemini(model, prompt, apiKey, options) {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/${model}:streamGenerateContent?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                ...options
            })
        });

        if (!response.ok) {
            throw new Error(`Gemini API error: ${response.statusText}`);
        }

        return response.body;
    }
} 