import { encryptApiKey, decryptApiKey, validateApiKey } from './crypto.js';

export class ApiKeyManager {
    static async saveApiKey(provider, key) {
        if (!validateApiKey(provider, key)) {
            throw new Error(`Invalid API key format for ${provider}`);
        }

        const encryptedKey = await encryptApiKey(key);
        if (!encryptedKey) {
            throw new Error('Failed to encrypt API key');
        }

        await chrome.storage.sync.set({
            [`apiKey_${provider}`]: encryptedKey
        });

        return true;
    }

    static async getApiKey(provider) {
        try {
            console.log(`Retrieving API key for ${provider}...`);
            const result = await chrome.storage.sync.get(`apiKey_${provider}`);
            const encryptedKey = result[`apiKey_${provider}`];
            
            if (!encryptedKey) {
                console.log(`No API key found for ${provider}`);
                return null;
            }

            const decryptedKey = await decryptApiKey(encryptedKey);
            if (!decryptedKey) {
                console.error(`Failed to decrypt API key for ${provider}`);
                return null;
            }

            console.log(`Successfully retrieved API key for ${provider}`);
            return decryptedKey;
        } catch (error) {
            console.error(`Error retrieving API key for ${provider}:`, error);
            return null;
        }
    }

    static async deleteApiKey(provider) {
        await chrome.storage.sync.remove(`apiKey_${provider}`);
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
        const storage = await chrome.storage.sync.get(null);
        return Object.keys(storage)
            .filter(key => key.startsWith('apiKey_'))
            .map(key => key.replace('apiKey_', ''));
    }

    static async saveEnabledModels(provider, models) {
        if (await this.hasApiKey(provider)) {
            await chrome.storage.sync.set({
                [`enabledModels_${provider}`]: models
            });
        }
    }

    static async getEnabledModels(provider) {
        if (await this.hasApiKey(provider)) {
            const result = await chrome.storage.sync.get(`enabledModels_${provider}`);
            return result[`enabledModels_${provider}`] || [];
        }
        return [];
    }

    static async clearEnabledModels(provider) {
        await chrome.storage.sync.remove(`enabledModels_${provider}`);
    }
} 