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
        anthropic: /^sk-ant-[A-Za-z0-9-]{20,}$/,
        perplexity: /^pplx-[A-Za-z0-9]{32,}$/,
        gemini: /^[A-Za-z0-9-]{39}$/,
    };
    
    // First validate the key format
    const isValidFormat = patterns[provider] ? patterns[provider].test(key) : true;
    if (!isValidFormat) {
        console.log(`Invalid ${provider} key format`);
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

    return true;
} 