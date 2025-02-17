import { LocalModelService } from '../services/local-model.js';
import { ExternalModelService } from '../services/external-model.js';

// Streaming configuration
const MIN_TIME_BETWEEN_UPDATES = 50; // Milliseconds - reduced for smoother streaming

export class MessageRouter {
    static async routeModelRequest(message, port = null, sendResponse = null) {
        // Send initial response immediately to keep channel open
        if (sendResponse) {
            sendResponse({ success: true, streaming: true });
        }

        try {
            let provider, modelId;
            
            if (message.model.startsWith('local:')) {
                provider = 'local';
                modelId = message.model.substring(6);
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

            if (!responseGenerator) {
                throw new Error('No response generator returned from model service');
            }

            // Handle streaming responses
            if (typeof responseGenerator[Symbol.asyncIterator] === 'function') {
                let messageStarted = false;
                let chunkCount = 0;
                let accumulatedContent = '';
                let previousContent = '';
                
                for await (const chunk of responseGenerator) {
                    if (!chunk) continue;  // Skip empty chunks
                    
                    chunkCount++;
                    const newContent = chunk.response || chunk.content || '';
                    if (!newContent) continue;  // Skip empty content
                    
                    const deltaContent = newContent.slice(previousContent.length);
                    if (!deltaContent) continue;  // Skip if no new content
                    
                    previousContent = newContent;
                    accumulatedContent = newContent;

                    if (!messageStarted) {
                        messageStarted = true;
                        console.log('Started receiving content');
                    }
                    
                    console.log('Streaming delta:', {
                        chunkCount,
                        deltaContent,
                        totalLength: accumulatedContent.length,
                        isDone: chunk.done || false
                    });
                    
                    const response = {
                        type: 'MODEL_RESPONSE',
                        success: true,
                        delta: { content: deltaContent },
                        response: accumulatedContent,
                        done: chunk.done || false
                    };

                    try {
                        if (port) {
                            port.postMessage(response);
                        } else {
                            chrome.runtime.sendMessage(response);
                        }
                    } catch (error) {
                        console.warn('Error sending delta:', error);
                        // Don't break the stream on send error
                    }
                    
                    if (chunk.done) {
                        console.log('Stream complete:', {
                            totalChunks: chunkCount,
                            finalLength: accumulatedContent.length
                        });
                        break;
                    }
                }

                // Only send final message if we actually got content
                if (accumulatedContent) {
                    const finalResponse = {
                        type: 'MODEL_RESPONSE',
                        success: true,
                        delta: { content: '' },
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
                }
            } else {
                // Handle non-streaming response
                const content = responseGenerator.response || responseGenerator.content;
                if (!content) {
                    throw new Error('Empty response received from model');
                }

                const response = {
                    type: 'MODEL_RESPONSE',
                    success: true,
                    response: content,
                    done: true
                };
                
                try {
                    if (port) {
                        port.postMessage(response);
                    } else {
                        chrome.runtime.sendMessage(response);
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