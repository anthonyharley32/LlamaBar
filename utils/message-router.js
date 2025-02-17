import { LocalModelService } from '../services/local-model.js';
import { ExternalModelService } from '../services/external-model.js';

export class MessageRouter {
    static async routeModelRequest(message, port = null) {
        try {
            const [provider, modelId] = message.model.split(':');
            
            console.log('Routing model request:', {
                provider,
                modelId,
                hasImage: message.hasImage
            });

            let responseGenerator;
            if (provider === 'local') {
                responseGenerator = await LocalModelService.generateResponse(
                    message.prompt,
                    modelId,
                    {
                        hasImage: message.hasImage
                    }
                );
            } else {
                responseGenerator = await ExternalModelService.generateResponse(
                    provider,
                    modelId,
                    message.prompt,
                    {
                        hasImage: message.hasImage
                    }
                );
            }

            // Handle streaming responses
            if (responseGenerator && typeof responseGenerator[Symbol.asyncIterator] === 'function') {
                for await (const chunk of responseGenerator) {
                    const response = {
                        type: 'OLLAMA_RESPONSE',
                        success: true,
                        response: chunk.content,
                        done: chunk.done
                    };
                    
                    await this.sendResponse(response, port);
                }
            } else if (responseGenerator) {
                // Handle non-streaming responses
                const response = {
                    type: 'OLLAMA_RESPONSE',
                    success: true,
                    response: responseGenerator.content,
                    done: true
                };
                
                await this.sendResponse(response, port);
            }
        } catch (error) {
            console.error('Error routing model request:', error);
            const errorResponse = {
                type: 'OLLAMA_RESPONSE',
                success: false,
                error: error.message
            };
            
            await this.sendResponse(errorResponse, port);
        }
    }

    static async sendResponse(response, port = null) {
        if (port) {
            port.postMessage(response);
        } else {
            chrome.runtime.sendMessage(response);
        }
    }
} 