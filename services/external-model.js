import { ApiKeyManager } from "../utils/api-key-manager.js";

export class ExternalModelService {
  static async generateResponse(provider, modelId, prompt, options = {}) {
    console.log("🎯 Starting generateResponse:", {
      provider,
      modelId,
      promptLength: prompt.length,
      options: JSON.stringify(options),
    });

    const handler = this.getProviderHandler(provider);
    if (!handler) {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    // Clean model ID by removing provider prefix if present
    modelId = modelId.replace(`${provider}:`, "");

    // Check for image input and switch to vision model for Grok
    const hasImageInput = prompt.includes("<image>");
    if (
      provider === "grok" &&
      hasImageInput &&
      modelId !== "grok-2-vision-1212"
    ) {
      console.log("🔄 Switching to grok-2-vision-1212 for image input");
      modelId = "grok-2-vision-1212";
    }

    // Check model capabilities
    const capabilities = await this.getModelCapabilities(provider, modelId);

    console.log("🖼️ Image detection:", {
      hasImageInput,
      imageTagFound: prompt.includes("<image>"),
      imageMatch: prompt.match(/<image>.*?<\/image>/),
      capabilities,
      modelId,
    });

    // Check if trying to use image with non-vision model
    if (hasImageInput && !capabilities.vision) {
      console.warn("⚠️ Attempting to use image with non-vision model:", {
        modelId,
        hasImageInput,
        capabilities,
      });
      throw new Error(
        `Model ${modelId} does not support image input. Please use a vision-capable model.`
      );
    }

    // Add hasImage to options if image is detected
    const updatedOptions = {
      ...options,
      hasImage: hasImageInput,
      capabilities,
    };

    console.log("🔄 Calling provider handler with:", {
      modelId,
      hasImage: updatedOptions.hasImage,
      capabilities: updatedOptions.capabilities,
    });

    return handler(modelId, prompt, updatedOptions);
  }

  static getProviderHandler(provider) {
    const handlers = {
      openai: this.handleOpenAI,
      anthropic: this.handleAnthropic,
      gemini: this.handleGemini,
      perplexity: this.handlePerplexity,
      openrouter: this.handleOpenRouter,
      grok: this.handleGrok,
    };
    return handlers[provider];
  }

  static async handleOpenAI(modelId, prompt, options = {}) {
    try {
      console.log("🚀 Starting OpenAI request handler:", {
        modelId,
        hasImage: options.hasImage,
      });
      const apiKey = await ApiKeyManager.getApiKey("openai");
      if (!apiKey) {
        throw new Error("OpenAI API key not found");
      }
      console.log("✅ API key retrieved successfully");

      const messages = [];
      if (options.hasImage) {
        const base64Image = prompt.match(/<image>(.*?)<\/image>/)?.[1];
        const text = prompt.replace(/<image>.*?<\/image>\n?/, "").trim();

        if (!base64Image) {
          throw new Error("Image data is missing or invalid");
        }

        messages.push({
          role: "user",
          content: [
            { type: "text", text },
            {
              type: "image_url",
              image_url: { url: base64Image },
            },
          ],
        });
      } else {
        messages.push({
          role: "user",
          content: prompt,
        });
      }

      console.log("📝 Preparing OpenAI API request:", {
        modelId,
        messageCount: messages.length,
        firstMessageContent: messages[0].content,
      });

      const requestBody = {
        model: modelId,
        messages,
        stream: true,
      };
      console.log("📦 Request body prepared:", requestBody);

      console.log("🌐 Making OpenAI API request...");
      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        }
      );

      console.log("📨 Received response from OpenAI:", {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("❌ OpenAI API error:", errorData);
        throw new Error(
          errorData.error?.message || `OpenAI API error: ${response.status}`
        );
      }

      if (!response.body) {
        console.error("❌ Response body is null");
        throw new Error("Response body is null");
      }

      console.log("✨ OpenAI request successful, initializing stream handler");
      return ExternalModelService.handleOpenAIStream(response);
    } catch (error) {
      console.error("💥 Error in handleOpenAI:", error);
      throw error;
    }
  }

  static async *handleOpenAIStream(response) {
    console.log("🔄 Initializing OpenAI stream handler");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulatedContent = "";

    try {
      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          console.log("🏁 Stream complete");
          if (accumulatedContent) {
            yield {
              type: "MODEL_RESPONSE",
              success: true,
              delta: { content: "" },
              response: accumulatedContent,
              done: true,
            };
          }
          break;
        }

        // Decode the chunk and add to buffer
        buffer += decoder.decode(value, { stream: true });
        console.log("📦 Received chunk:", buffer);

        // Process complete messages in buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          console.log("🔍 Processing line:", line);

          // Skip empty lines
          if (!line.trim()) {
            console.log("⏭️ Skipping empty line");
            continue;
          }

          // Check for end of stream
          if (line === "data: [DONE]") {
            console.log("🏁 Received DONE marker");
            yield {
              type: "MODEL_RESPONSE",
              success: true,
              delta: { content: "" },
              response: accumulatedContent,
              done: true,
            };
            continue;
          }

          // Process data line
          if (line.startsWith("data: ")) {
            try {
              const jsonData = JSON.parse(line.slice(6)); // Remove 'data: ' prefix
              console.log("📄 Parsed JSON:", jsonData);

              const content = jsonData.choices?.[0]?.delta?.content || "";
              if (content) {
                console.log("✨ Extracted content:", content);
                accumulatedContent += content;

                yield {
                  type: "MODEL_RESPONSE",
                  success: true,
                  delta: { content },
                  response: accumulatedContent,
                  done: false,
                };
              }
            } catch (e) {
              console.warn("⚠️ Error parsing JSON:", e);
              continue;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  static async handleAnthropic(modelId, prompt, options = {}) {
    try {
      console.log("🚀 Starting Anthropic request handler:", {
        modelId,
        hasImage: options.hasImage,
      });
      const apiKey = await ApiKeyManager.getApiKey("anthropic");
      if (!apiKey) {
        throw new Error("Anthropic API key not found");
      }
      console.log("✅ API key retrieved successfully");

      const messages = [];
      if (options.hasImage) {
        const base64Image = prompt.match(/<image>(.*?)<\/image>/)?.[1];
        const text = prompt.replace(/<image>.*?<\/image>\n?/, "").trim();

        messages.push({
          role: "user",
          content: [
            { type: "text", text },
            base64Image
              ? {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/jpeg",
                    data: base64Image,
                  },
                }
              : null,
          ].filter(Boolean),
        });
      } else {
        messages.push({
          role: "user",
          content: prompt,
        });
      }

      console.log("📝 Preparing Anthropic API request:", {
        model: modelId,
        messageCount: messages.length,
        firstMessageContent: messages[0].content,
      });

      const requestBody = {
        model: modelId,
        messages,
        stream: true,
        max_tokens: 4096,
      };

      console.log(
        "🌐 Making Anthropic API request with body:",
        JSON.stringify(requestBody)
      );

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(requestBody),
      });

      console.log("📨 Received response from Anthropic:", {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("❌ Anthropic API error:", errorData);

        // Handle specific error types
        if (errorData.error?.type === "overloaded_error") {
          throw new Error(
            "Claude is currently experiencing high traffic. Please try again in a few moments."
          );
        }

        throw new Error(
          errorData.error?.message || `Anthropic API error: ${response.status}`
        );
      }

      return ExternalModelService.handleProviderStream(
        response,
        "anthropic",
        (json) => {
          return json.delta?.text || "";
        }
      );
    } catch (error) {
      console.error("💥 Error in handleAnthropic:", error);
      throw error;
    }
  }

  // Generic streaming handler for all providers
  static async *handleProviderStream(response, provider, contentExtractor) {
    console.log(`🌊 Starting ${provider} stream handler`);
    const reader = response.body.getReader();
    console.log("📖 Stream reader created");
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulatedContent = "";
    let chunkCounter = 0;

    try {
      console.log("🔄 Entering stream processing loop");
      while (true) {
        console.log(`⏳ Reading chunk #${++chunkCounter}`);
        const { value, done } = await reader.read();

        if (done) {
          console.log(
            `✅ ${provider} stream complete after ${chunkCounter} chunks`
          );
          // Yield final accumulated content if any
          if (accumulatedContent) {
            yield {
              type: "MODEL_RESPONSE",
              success: true,
              delta: { content: "" },
              response: accumulatedContent,
              done: true,
            };
          }
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        console.log(`📦 Raw ${provider} chunk #${chunkCounter}:`, {
          length: chunk.length,
          preview: chunk.slice(0, 100),
        });

        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        console.log(`📝 Processing ${lines.length} lines from chunk`);
        for (const line of lines) {
          if (!line.trim()) {
            console.log("⏭️ Skipping empty line");
            continue;
          }
          if (line === "data: [DONE]") {
            console.log("🏁 Stream done marker received");
            // Yield final state
            yield {
              type: "MODEL_RESPONSE",
              success: true,
              delta: { content: "" },
              response: accumulatedContent,
              done: true,
            };
            continue;
          }

          try {
            const cleanLine = line.replace(/^data: /, "");
            console.log(`🔍 Processing line:`, cleanLine);

            let json;
            try {
              json = JSON.parse(cleanLine);
            } catch (e) {
              console.warn(`⚠️ Failed to parse JSON, skipping line:`, e);
              continue; // Skip this line but continue processing
            }

            const content = contentExtractor(json);
            console.log(`📄 Extracted content:`, { content });

            if (content) {
              accumulatedContent += content;
              console.log(`📬 Yielding content:`, {
                newContent: content,
                totalLength: accumulatedContent.length,
              });

              yield {
                type: "MODEL_RESPONSE",
                success: true,
                delta: { content },
                response: accumulatedContent,
                contentLength: accumulatedContent.length,
                done: false,
              };
            }
          } catch (e) {
            console.warn(`⚠️ Error processing line:`, {
              error: e,
              line: line,
            });
            // Continue processing instead of throwing
            continue;
          }
        }
      }
    } catch (error) {
      console.error(`❌ Fatal error in stream handler:`, error);
      // Yield error state if we have content
      if (accumulatedContent) {
        yield {
          type: "MODEL_RESPONSE",
          success: true,
          delta: { content: "" },
          response: accumulatedContent,
          done: true,
          error: error.message,
        };
      }
      throw error;
    } finally {
      console.log("🔒 Releasing stream reader");
      reader.releaseLock();
    }
  }

  static async handleGemini(modelId, prompt, options = {}) {
    const apiKey = await ApiKeyManager.getApiKey("gemini");
    if (!apiKey) {
      throw new Error("Gemini API key not found");
    }

    // Use the correct model format
    const model = modelId.replace("gemini:", "");
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        error.error?.message || `Gemini API error: ${response.status}`
      );
    }

    const result = await response.json();
    return {
      type: "MODEL_RESPONSE",
      success: true,
      response: result.candidates?.[0]?.content?.parts?.[0]?.text || "",
      done: true,
    };
  }

  static async handlePerplexity(modelId, prompt, options = {}) {
    const apiKey = await ApiKeyManager.getApiKey("perplexity");
    if (!apiKey) {
      throw new Error("Perplexity API key not found");
    }

    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: prompt }],
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        error: { message: `HTTP error! status: ${response.status}` },
      }));
      throw new Error(
        error.error?.message || `Perplexity API error: ${response.status}`
      );
    }

    return ExternalModelService.handleProviderStream(
      response,
      "perplexity",
      (json) => {
        return json.choices?.[0]?.delta?.content || "";
      }
    );
  }

  static async handleOpenRouter(modelId, prompt, options = {}) {
    const apiKey = await ApiKeyManager.getApiKey("openrouter");
    if (!apiKey) {
      throw new Error("OpenRouter API key not found");
    }

    // Remove any openrouter: prefix if present
    const cleanModelId = modelId.replace("openrouter:", "");

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": chrome.runtime.getURL(""),
          "X-Title": "LlamaBar",
        },
        body: JSON.stringify({
          model: cleanModelId,
          messages: [{ role: "user", content: prompt }],
          stream: true,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        error.error?.message || `OpenRouter API error: ${response.status}`
      );
    }

    return ExternalModelService.handleProviderStream(
      response,
      "openrouter",
      (json) => {
        return json.choices?.[0]?.delta?.content || "";
      }
    );
  }

  static async handleGrok(modelId, prompt, options = {}) {
    try {
      console.log("🚀 Starting Grok request handler:", {
        modelId,
        hasImage: options.hasImage,
        promptLength: prompt.length,
        containsImageTag: prompt.includes("<image>"),
        options: JSON.stringify(options),
      });
      const apiKey = await ApiKeyManager.getApiKey("grok");
      if (!apiKey) {
        throw new Error("Grok API key not found");
      }
      console.log("✅ API key retrieved successfully");

      const messages = [];
      if (options.hasImage) {
        const imageMatch = prompt.match(/<image>(.*?)<\/image>/);
        console.log("🔍 Image extraction details:", {
          promptStart: prompt.substring(0, 100),
          promptEnd: prompt.substring(prompt.length - 100),
          imageTagCount: (prompt.match(/<image>/g) || []).length,
          imageMatchSuccess: !!imageMatch,
          imageMatchGroups: imageMatch ? imageMatch.length : 0,
          imageDataPreview: imageMatch?.[1]?.substring(0, 50) + "...",
        });

        const base64Image = imageMatch?.[1];
        const text = prompt.replace(/<image>.*?<\/image>\n?/, "").trim();

        console.log("📸 Image processing details:", {
          hasBase64Data: !!base64Image,
          base64DataLength: base64Image?.length || 0,
          isBase64Valid: base64Image?.startsWith("data:image/"),
          extractedTextLength: text.length,
          textPreview: text.substring(0, 50),
        });

        if (!base64Image || !base64Image.startsWith("data:image/")) {
          console.error("❌ Invalid image data:", {
            hasBase64: !!base64Image,
            startsWithDataImage: base64Image?.startsWith("data:image/"),
            imageMatchFound: !!imageMatch,
          });
          throw new Error("Invalid or missing image data");
        }

        messages.push({
          role: "user",
          content: [
            { type: "text", text },
            {
              type: "image_url",
              image_url: { url: base64Image },
            },
          ],
        });

        console.log("📤 Prepared message structure:", {
          messageCount: messages.length,
          contentTypes: messages[0].content.map((c) => c.type),
          textLength: text.length,
          imageUrlLength: base64Image.length,
        });
      } else {
        messages.push({
          role: "user",
          content: prompt,
        });
      }

      console.log("📝 Preparing Grok API request:", {
        model: modelId,
        messageCount: messages.length,
        firstMessageContent: messages[0].content,
      });

      const requestBody = {
        model: modelId,
        messages,
        stream: true,
      };

      console.log(
        "🌐 Making Grok API request with body:",
        JSON.stringify(requestBody)
      );

      try {
        const response = await fetch("https://api.x.ai/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          credentials: "omit",
          body: JSON.stringify(requestBody),
        });

        console.log("📨 Received response from Grok:", {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
        });

        if (!response.ok) {
          const errorData = await response.json();
          console.error("❌ Grok API error:", errorData);
          throw new Error(
            errorData.error?.message || `Grok API error: ${response.status}`
          );
        }

        return ExternalModelService.handleProviderStream(
          response,
          "grok",
          (json) => {
            return json.choices?.[0]?.delta?.content || "";
          }
        );
      } catch (error) {
        console.error("❌ Fetch error:", {
          name: error.name,
          message: error.message,
          cause: error.cause,
        });
        throw error;
      }
    } catch (error) {
      console.error("💥 Error in handleGrok:", error);
      throw error;
    }
  }

  static async getModelCapabilities(provider, modelId) {
    console.log("🔍 Checking model capabilities:", { provider, modelId });
    try {
      switch (provider) {
        case "openai":
          const response = await fetch("https://api.openai.com/v1/models", {
            method: "GET",
            headers: {
              Authorization: `Bearer ${await ApiKeyManager.getApiKey(
                "openai"
              )}`,
              "Content-Type": "application/json",
            },
          });

          if (!response.ok) {
            throw new Error("Failed to fetch OpenAI model capabilities");
          }

          const data = await response.json();
          const model = data.data.find((m) => m.id === modelId);

          return {
            vision: model?.capabilities?.vision || false,
          };

        case "anthropic":
          // Claude 3 models support vision
          return {
            vision: modelId.includes("claude-3"),
          };

        case "gemini":
          // Gemini models with 'vision' in ID support vision
          return {
            vision: modelId.includes("vision"),
          };

        case "grok":
          // Grok vision models explicitly named
          const isVisionModel = modelId === "grok-2-vision-1212";
          console.log("📋 Grok model capabilities:", {
            modelId,
            isVisionModel,
            requestedModel: modelId,
            supportsVision: isVisionModel,
          });
          return {
            vision: isVisionModel,
          };

        case "openrouter":
          const orResponse = await fetch(
            "https://openrouter.ai/api/v1/models",
            {
              method: "GET",
              headers: {
                Authorization: `Bearer ${await ApiKeyManager.getApiKey(
                  "openrouter"
                )}`,
                "Content-Type": "application/json",
                "HTTP-Referer": chrome.runtime.getURL(""),
                "X-Title": "LlamaBar",
              },
            }
          );

          if (!orResponse.ok) {
            throw new Error("Failed to fetch OpenRouter model capabilities");
          }

          const orData = await orResponse.json();
          const orModel = orData.data.find((m) => m.id === modelId);

          return {
            vision: orModel?.capabilities?.vision || false,
          };

        default:
          return {
            vision: false,
          };
      }
    } catch (error) {
      console.error(`Error fetching ${provider} model capabilities:`, error);
      // Default to conservative capabilities if we can't determine
      return {
        vision: false,
      };
    }
  }
}
