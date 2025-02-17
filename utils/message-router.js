import { LocalModelService } from '../services/local-model.js';
import { ExternalModelService } from '../services/external-model.js';

// Streaming configuration
const MIN_TIME_BETWEEN_UPDATES = 50; // Milliseconds - reduced for smoother streaming

export class MessageRouter {
    static async routeModelRequest(message, port = null, sendResponse = null) {
        try {
            let provider, modelId;
            
            // Special handling for local models to preserve full model name
            if (message.model.startsWith('local:')) {
                provider = 'local';
                modelId = message.model.substring(6); // Remove 'local:' prefix
            } else {
                [provider, modelId] = message.model.split(':');
            }
            
            console.log('Routing model request:', {
                provider,
                modelId,
                hasImage: message.hasImage,
                promptLength: message.prompt.length
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
                let messageStarted = false;
                let chunkCount = 0;
                let accumulatedContent = '';
                let previousContent = '';
                
                // Send initial response to keep the message channel open
                if (sendResponse) {
                    sendResponse({ success: true, streaming: true });
                }
                
                for await (const chunk of responseGenerator) {
                    chunkCount++;
                    
                    // Get the new content from the chunk
                    const newContent = chunk.response || chunk.content || '';
                    
                    // Calculate the actual delta (only the new content)
                    const deltaContent = newContent.slice(previousContent.length);
                    previousContent = newContent;
                    
                    // Normalize response format to match OpenAI's delta pattern
                    const response = {
                        type: 'MODEL_RESPONSE',
                        success: chunk.success ?? true,
                        delta: {
                            content: deltaContent
                        },
                        response: newContent,
                        done: chunk.done || false
                    };

                    if (deltaContent) {
                        if (!messageStarted) {
                            messageStarted = true;
                            console.log('Started receiving content');
                        }
                        
                        accumulatedContent = newContent;
                        
                        console.log('Streaming delta:', {
                            chunkCount,
                            deltaContent,
                            totalLength: accumulatedContent.length,
                            isDone: response.done
                        });
                        
                        try {
                            if (port) {
                                port.postMessage(response);
                            } else {
                                chrome.runtime.sendMessage(response);
                            }
                        } catch (error) {
                            console.warn('Error sending delta:', error);
                            // Continue streaming despite errors
                        }
                        
                        if (response.done) {
                            console.log('Stream complete:', {
                                totalChunks: chunkCount,
                                finalLength: accumulatedContent.length
                            });
                            break;
                        }
                    }
                }
                
                // Send final message with complete content
                const finalResponse = {
                    type: 'MODEL_RESPONSE',
                    success: true,
                    delta: {
                        content: ''  // Empty delta for final message
                    },
                    response: accumulatedContent,
                    done: true
                };
                
                try {
                    if (port) {
                        port.postMessage(finalResponse);
                    } else {
                        chrome.runtime.sendMessage(finalResponse);
                    }
                } catch (error) {
                    console.error('Failed to send final message:', error);
                }
                
                return true;
            }
            
            // Handle non-streaming response
            if (responseGenerator) {
                const response = {
                    type: 'MODEL_RESPONSE',
                    success: responseGenerator.success ?? true,
                    response: responseGenerator.response || responseGenerator.content || '',
                    done: true
                };
                
                if (!response.response) {
                    throw new Error('Empty response received');
                }
                
                try {
                    if (port) {
                        port.postMessage(response);
                    } else {
                        chrome.runtime.sendMessage(response);
                    }
                    if (sendResponse) {
                        sendResponse({ success: true });
                    }
                } catch (error) {
                    console.error('Failed to send response:', error);
                    throw error;
                }
            }
            
            return true;
        } catch (error) {
            console.error('Error in routeModelRequest:', error);
            const errorResponse = {
                type: 'MODEL_RESPONSE',
                success: false,
                error: error.message || 'Unknown error occurred'
            };
            
            try {
                if (port) {
                    port.postMessage(errorResponse);
                } else {
                    chrome.runtime.sendMessage(errorResponse);
                }
                if (sendResponse) {
                    sendResponse({ success: false, error: error.message });
                }
            } catch (sendError) {
                console.error('Failed to send error response:', sendError);
            }
            
            return false;
        }
    }

    static async sendResponse(response, port = null, sendResponse = null) {
        // Ensure consistent message format
        const formattedResponse = {
            type: 'MODEL_RESPONSE',
            success: response.success ?? true,
            response: response.response || '',
            done: response.done ?? false
        };

        if (!formattedResponse.success && response.error) {
            formattedResponse.error = response.error;
        }

        console.log('🎯 Sending to UI:', {
            destination: port ? 'Port (Popup)' : 'Runtime Message (Sidebar)',
            messageType: formattedResponse.type,
            success: formattedResponse.success,
            contentLength: formattedResponse.response.length,
            isDone: formattedResponse.done,
            hasError: !!formattedResponse.error
        });

        try {
            if (port) {
                port.postMessage(formattedResponse);
            } else {
                await chrome.runtime.sendMessage(formattedResponse);
            }
            console.log('✅ Message sent successfully');
            return true;
        } catch (error) {
            console.error('❌ Failed to send message:', error);
            return false;
        }
    }
} 