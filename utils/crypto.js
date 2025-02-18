// Utility functions for encrypting and decrypting API keys
const ENCRYPTION_KEY = 'llamabar_key_v1'; // This is just for basic obfuscation

// Simple XOR encryption for basic obfuscation
function xorEncrypt(text, key) {
    let result = '';
    for (let i = 0; i < text.length; i++) {
        result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return result;
}

export async function encryptApiKey(apiKey) {
    try {
        // Use simple XOR encryption instead of WebCrypto API
        const encrypted = xorEncrypt(apiKey, ENCRYPTION_KEY);
        return btoa(encrypted);
    } catch (error) {
        console.error('Encryption error:', error);
        return null;
    }
}

export async function decryptApiKey(encryptedKey) {
    try {
        // Decrypt using XOR
        const encrypted = atob(encryptedKey);
        return xorEncrypt(encrypted, ENCRYPTION_KEY);
    } catch (error) {
        console.error('Decryption error:', error);
        return null;
    }
}

// Validate API key format for different providers
export async function validateApiKey(provider, key) {
    const patterns = {
        openai: /^sk-[A-Za-z0-9-_]{20,}$/,  // Allow underscores and be more lenient
        openrouter: /^sk-or-[A-Za-z0-9-]{20,}$/,
        anthropic: /^sk-ant-[A-Za-z0-9-_]{20,}$/,  // More lenient pattern for Anthropic keys
        perplexity: /^pplx-[A-Za-z0-9]{48}$/,  // Updated to match actual Perplexity key format (pplx- prefix + 48 chars)
        gemini: /^[A-Za-z0-9-]{39}$/,
        grok: /^[A-Za-z0-9-_]{40,}$/  // Grok API key pattern
    };
    
    // First validate the key format
    const isValidFormat = patterns[provider] ? patterns[provider].test(key) : true;
    console.log(`Validating ${provider} key format:`, { 
        keyLength: key.length,
        keyPrefix: key.slice(0, 7),
        isValidFormat,
        pattern: patterns[provider]?.toString()
    });
    if (!isValidFormat) {
        console.error(`Invalid ${provider} key format - Key length: ${key.length}, Expected pattern: ${patterns[provider]}`);
        return false;
    }

    // For OpenAI, fetch actual available models
    if (provider === 'openai') {
        try {
            const response = await fetch('https://api.openai.com/v1/models', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${key}`,
                    'Content-Type': 'application/json'
                },
                credentials: 'omit'
            });

            if (!response.ok) {
                console.error(`OpenAI API error: ${response.status}`);
                return false;
            }

            return true;
        } catch (error) {
            console.error('Error validating OpenAI key:', error);
            return false;
        }
    }

    // For Anthropic, validate the key by making a test request
    if (provider === 'anthropic') {
        try {
            console.log('Testing Anthropic API key with test request...');
            const testRequest = {
                model: 'claude-3.5-sonnet-20241022',
                messages: [{ role: 'user', content: 'test' }],
                max_tokens: 1024
            };
            console.log('Request body:', JSON.stringify(testRequest));

            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': key,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify(testRequest)
            });

            const errorData = await response.json().catch(() => null);
            if (!response.ok) {
                console.error('Anthropic API validation error:', {
                    status: response.status,
                    statusText: response.statusText,
                    error: errorData,
                    request: testRequest,
                    headers: Object.fromEntries(response.headers.entries())
                });
                throw new Error(errorData?.error?.message || `API error: ${response.status}`);
            }

            console.log('Anthropic API key validation successful');
            return true;
        } catch (error) {
            console.error('Error validating Anthropic key:', {
                name: error.name,
                message: error.message,
                stack: error.stack,
                fullError: error
            });
            return false;
        }
    }

    return true;
} 