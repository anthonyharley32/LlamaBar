import { encryptApiKey, decryptApiKey, validateApiKey } from './crypto.js';

export class ApiKeyManager {
    static async saveApiKey(provider, key) {
        try {
            console.log(`Attempting to save API key for ${provider}...`);
            
            const isValid = await validateApiKey(provider, key);
            if (!isValid) {
                console.error(`Invalid API key format for ${provider}`);
                throw new Error(`Invalid API key format for ${provider}`);
            }

            const encryptedKey = await encryptApiKey(key);
            if (!encryptedKey) {
                console.error('Failed to encrypt API key');
                throw new Error('Failed to encrypt API key');
            }

            // Use local storage instead of sync
            await chrome.storage.local.set({
                [`apiKey_${provider}`]: encryptedKey
            });

            // For Grok, save the default models
            if (provider === 'grok') {
                console.log('Saving enabled Grok models...');
                await this.saveEnabledModels('grok', ['grok-2-1212', 'grok-2-vision-1212']);
                console.log('Enabled Grok models saved successfully');
            }

            // For Anthropic, save the default models
            if (provider === 'anthropic') {
                console.log('Saving enabled Anthropic models...');
                await this.saveEnabledModels('anthropic', [
                    'claude-3-opus-20240229',
                    'claude-3-sonnet-20240229',
                    'claude-3-haiku-20240307',
                    'claude-2.1',
                    'claude-2.0'
                ]);
                console.log('Enabled Anthropic models saved successfully');
            }

            console.log(`Successfully saved API key for ${provider}`);
            return true;
        } catch (error) {
            console.error(`Error saving API key for ${provider}:`, error);
            throw error;
        }
    }

    static async getApiKey(provider) {
        try {
            console.log(`Retrieving API key for ${provider}...`);
            const result = await chrome.storage.local.get(`apiKey_${provider}`);
            const encryptedKey = result[`apiKey_${provider}`];
            
            if (!encryptedKey) {
                console.log(`No API key found for ${provider}`);
                return null;
            }

            try {
                const decryptedKey = await decryptApiKey(encryptedKey);
                console.log(`Successfully retrieved API key for ${provider}`);
                return decryptedKey;
            } catch (error) {
                console.error(`Failed to decrypt API key for ${provider}:`, error);
                return null;
            }
        } catch (error) {
            console.error(`Error retrieving API key for ${provider}:`, error);
            return null;
        }
    }

    static async deleteApiKey(provider) {
        await chrome.storage.local.remove(`apiKey_${provider}`);
        await this.clearEnabledModels(provider);
    }

    static async hasApiKey(provider) {
        try {
            const key = await this.getApiKey(provider);
            return !!key;
        } catch (error) {
            console.error('Error checking API key:', error);
            return false;
        }
    }

    static async getAllProviders() {
        const storage = await chrome.storage.local.get(null);
        return Object.keys(storage)
            .filter(key => key.startsWith('apiKey_'))
            .map(key => key.replace('apiKey_', ''));
    }

    static async saveEnabledModels(provider, models) {
        if (await this.hasApiKey(provider)) {
            await chrome.storage.local.set({
                [`enabledModels_${provider}`]: models
            });
        }
    }

    static async getEnabledModels(provider) {
        if (await this.hasApiKey(provider)) {
            const result = await chrome.storage.local.get(`enabledModels_${provider}`);
            return result[`enabledModels_${provider}`] || [];
        }
        return [];
    }

    static async clearEnabledModels(provider) {
        await chrome.storage.local.remove(`enabledModels_${provider}`);
    }

    static async saveDefaultModel(modelId) {
        await chrome.storage.local.set({ defaultModel: modelId });
    }

    static async getDefaultModel() {
        const result = await chrome.storage.local.get('defaultModel');
        return result.defaultModel || null;
    }
} 