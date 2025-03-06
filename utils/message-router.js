import { LocalModelService } from '../services/local-model.js';
import { ExternalModelService } from '../services/external-model.js';

// Streaming configuration
const MIN_TIME_BETWEEN_UPDATES = 50; // Milliseconds - reduced for smoother streaming

export class MessageRouter {
    static activeStreams = new Set();
    static isProcessingStop = false;

    static async routeModelRequest(message, port = null, sendResponse = null) {
        console.log('🚀 Starting model request routing');

        // For streaming responses, we need to acknowledge receipt immediately
        if (sendResponse) {
            sendResponse({ success: true });
        }
        
        // Handle stop generation message
        if (message.type === 'STOP_GENERATION') {
            console.log('🛑 Received stop generation request');
            if (this.isProcessingStop) {
                console.log('Already processing stop request');
                return false;
            }
            
            this.isProcessingStop = true;
            console.log('🛑 Stopping all active generations');

            try {
                // Stop all active services
                await Promise.all([
                    LocalModelService.stopGeneration(),
                    ExternalModelService.stopGeneration()
                ]);
                
                console.log('✅ Services stopped successfully');
                
                // Clear active streams
                this.activeStreams.clear();
                console.log('✅ Active streams cleared');
                
                // Send a final message to close the stream
                const finalResponse = {
                    type: 'MODEL_RESPONSE',
                    success: true,
                    error: 'Generation stopped by user',
                    done: true
                };
                
                try {
                    console.log('📤 Sending stop confirmation message');
                    if (port) {
                        port.postMessage(finalResponse);
                    } else {
                        await chrome.runtime.sendMessage(finalResponse);
                    }
                    console.log('✅ Stop confirmation sent');
                } catch (error) {
                    console.error('Error sending stop message:', error);
                }
            } catch (error) {
                console.error('Error stopping generation:', error);
            } finally {
                this.isProcessingStop = false;
            }
            return false;
        }

        try {
            let provider, modelId;
            
            if (message.model.startsWith('local:')) {
                provider = 'local';
                modelId = message.model.substring(6);
            } else {
                [provider, modelId] = message.model.split(':');
            }
            
            console.log('🎯 Model request details:', {
                provider,
                modelId,
                hasImage: message.hasImage,
                promptLength: message.prompt.length,
                isLocal: provider === 'local'
            });

            let responseGenerator;
            try {
                // Clear any existing streams before starting a new one
                this.activeStreams.clear();
                
                if (provider === 'local') {
                    console.log('🏠 Calling local model service');
                    responseGenerator = await LocalModelService.generateResponse(
                        message.prompt,
                        modelId,
                        {
                            hasImage: message.hasImage,
                            onCancel: () => {
                                console.log('🛑 Local model stream cancelled');
                                this.activeStreams.delete(responseGenerator);
                            }
                        }
                    );
                } else {
                    console.log('🌐 Calling external model service');
                    responseGenerator = await ExternalModelService.generateResponse(
                        provider,
                        modelId,
                        message.prompt,
                        {
                            hasImage: message.hasImage,
                            onCancel: () => {
                                console.log('🛑 External model stream cancelled');
                                this.activeStreams.delete(responseGenerator);
                            }
                        }
                    );
                }

                if (!responseGenerator) {
                    throw new Error('No response generator returned from model service');
                }
                
                // Track this stream
                this.activeStreams.add(responseGenerator);
                console.log('✅ Response generator created and tracked');
            } catch (error) {
                console.error('❌ Error generating response:', error);
                throw error;
            }

            // Handle streaming responses
            if (typeof responseGenerator[Symbol.asyncIterator] === 'function') {
                try {
                    for await (const chunk of responseGenerator) {
                        // Check if stream was cancelled
                        if (!this.activeStreams.has(responseGenerator)) {
                            console.log('🛑 Stream was cancelled, stopping iteration');
                            break;
                        }

                        if (!chunk || !chunk.delta?.content) continue;

                        try {
                            const response = {
                                type: 'MODEL_RESPONSE',
                                success: true,
                                delta: { content: chunk.delta.content },
                                response: chunk.response || '',
                                done: chunk.done || false
                            };

                            if (port) {
                                port.postMessage(response);
                            } else {
                                await chrome.runtime.sendMessage(response);
                            }
                        } catch (error) {
                            console.error('Error sending chunk:', error);
                            if (error.message?.includes('message channel closed')) {
                                console.warn('Message channel closed, stopping stream');
                                break;
                            }
                            throw error;
                        }

                        if (chunk.done) break;
                    }
                } catch (error) {
                    console.error('Error in stream processing:', error);
                    throw error;
                } finally {
                    this.activeStreams.delete(responseGenerator);
                    console.log('Stream cleanup complete');
                }

                // Send final done message
                try {
                    const finalResponse = {
                        type: 'MODEL_RESPONSE',
                        success: true,
                        delta: { content: '' },
                        done: true
                    };

                    if (port) {
                        port.postMessage(finalResponse);
                    } else {
                        await chrome.runtime.sendMessage(finalResponse);
                    }
                } catch (error) {
                    console.error('Failed to send final message:', error);
                }
            } else {
                // Handle non-streaming response
                console.log('📝 Handling non-streaming response');
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
                    console.log('📤 Sending non-streaming response');
                    if (port) {
                        port.postMessage(response);
                    } else {
                        await chrome.runtime.sendMessage(response);
                    }
                    console.log('✅ Non-streaming response sent successfully');
                } catch (error) {
                    console.error('❌ Failed to send response:', error);
                    throw error;
                }
            }
            
            return false;
        } catch (error) {
            console.error('Error in routeModelRequest:', error);
            const errorResponse = {
                type: 'MODEL_RESPONSE',
                success: false,
                error: error.message || 'Unknown error occurred',
                done: true
            };
            
            try {
                console.log('📤 Sending error response to UI');
                if (port) {
                    port.postMessage(errorResponse);
                } else {
                    await chrome.runtime.sendMessage(errorResponse);
                }
            } catch (sendError) {
                console.error('❌ Failed to send error response:', sendError);
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