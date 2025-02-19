// Utility functions for encrypting and decrypting API keys using WebCrypto API
class SecureKeyManager {
    static async encrypt(text) {
        try {
            // Generate a random salt for each encryption
            const salt = crypto.getRandomValues(new Uint8Array(16));
            
            // Derive a key from the extension's ID (unique per installation)
            const keyMaterial = await crypto.subtle.importKey(
                "raw",
                new TextEncoder().encode(chrome.runtime.id),
                { name: "PBKDF2" },
                false,
                ["deriveBits", "deriveKey"]
            );
            
            // Create the actual encryption key
            const key = await crypto.subtle.deriveKey(
                {
                    name: "PBKDF2",
                    salt: salt,
                    iterations: 100000,
                    hash: "SHA-256"
                },
                keyMaterial,
                { name: "AES-GCM", length: 256 },
                false,
                ["encrypt"]
            );
            
            // Generate random IV
            const iv = crypto.getRandomValues(new Uint8Array(12));
            
            // Encrypt the data
            const encrypted = await crypto.subtle.encrypt(
                {
                    name: "AES-GCM",
                    iv: iv
                },
                key,
                new TextEncoder().encode(text)
            );
            
            // Combine salt, iv, and encrypted data into a single array
            const encryptedData = new Uint8Array([
                ...salt,
                ...iv,
                ...new Uint8Array(encrypted)
            ]);
            
            // Convert to base64 for storage
            return btoa(String.fromCharCode(...encryptedData));
        } catch (error) {
            console.error('Encryption error:', error);
            throw new Error('Failed to encrypt data');
        }
    }

    static async decrypt(encryptedData) {
        try {
            // Convert from base64
            const data = new Uint8Array(
                atob(encryptedData)
                .split('')
                .map(char => char.charCodeAt(0))
            );
            
            // Extract salt, iv, and encrypted data
            const salt = data.slice(0, 16);
            const iv = data.slice(16, 28);
            const encrypted = data.slice(28);
            
            // Recreate the key
            const keyMaterial = await crypto.subtle.importKey(
                "raw",
                new TextEncoder().encode(chrome.runtime.id),
                { name: "PBKDF2" },
                false,
                ["deriveBits", "deriveKey"]
            );
            
            const key = await crypto.subtle.deriveKey(
                {
                    name: "PBKDF2",
                    salt: salt,
                    iterations: 100000,
                    hash: "SHA-256"
                },
                keyMaterial,
                { name: "AES-GCM", length: 256 },
                false,
                ["decrypt"]
            );
            
            // Decrypt
            const decrypted = await crypto.subtle.decrypt(
                {
                    name: "AES-GCM",
                    iv: iv
                },
                key,
                encrypted
            );
            
            return new TextDecoder().decode(decrypted);
        } catch (error) {
            console.error('Decryption error:', error);
            throw new Error('Failed to decrypt data');
        }
    }
}

export async function encryptApiKey(apiKey) {
    return SecureKeyManager.encrypt(apiKey);
}

export async function decryptApiKey(encryptedKey) {
    return SecureKeyManager.decrypt(encryptedKey);
}

// Validate API key format for different providers
export async function validateApiKey(provider, key) {
    const patterns = {
        openai: /^sk-[A-Za-z0-9-_]{20,}$/,  // Allow underscores and be more lenient
        openrouter: /^sk-or-v1-[A-Za-z0-9]{64}$/,  // Updated to match actual format
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
                model: 'claude-3-5-sonnet-20241022',
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