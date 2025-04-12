import {
  BaseToolsAdapter,
  Tool,
  ToolNameParam,
  ToolExecutionResult,
  ChatbotResult,
} from "./base-adapter";

/**
 * Anthropic tool format
 */
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, any>;
}

/**
 * Anthropic tool call format
 */
export interface AnthropicToolUse {
  id: string;
  name: string;
  input: Record<string, any>;
}

/**
 * Options for the Anthropic chatbot
 */
export interface AnthropicChatbotOptions {
  model?: string;
  temperature?: number;
  system?: string;
  [key: string]: any; // Allow any additional Anthropic API options
}

/**
 * Result of a chatbot invocation
 */

/**
 * Adapter for Anthropic Claude API
 */
export class AnthropicAdapter extends BaseToolsAdapter {
  /**
   * Convert tools to Anthropic format
   * @param toolNames - Optional list of specific tools to convert
   * @returns Array of tools in Anthropic format
   */
  public async getAnthropicTools(
    toolNames?: ToolNameParam[]
  ): Promise<AnthropicTool[]> {
    await this.ensureInitialized();

    this.log(`Converting tools to Anthropic format...`);
    const selectedTools = await this.getToolsByNames(toolNames);

    const anthropicTools = Object.values(selectedTools).map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    }));

    this.log(`Converted ${anthropicTools.length} tools to Anthropic format`);

    return anthropicTools;
  }

  /**
   * Creates a function to handle Anthropic tool calls
   * @param toolNames - Optional list of specific tools to handle
   * @returns Tool handler function for Anthropic
   */
  public async createAnthropicToolHandler(
    toolNames?: ToolNameParam[]
  ): Promise<(toolUse: AnthropicToolUse) => Promise<ToolExecutionResult>> {
    await this.ensureInitialized();

    this.log(`Creating Anthropic tool handler...`);
    const selectedTools = await this.getToolsByNames(toolNames);
    const executors: Record<
      string,
      (args: Record<string, any>) => Promise<ToolExecutionResult>
    > = {};

    // Create executor functions for all selected tools
    Object.values(selectedTools).forEach((tool) => {
      executors[tool.name] = this.createToolExecutor(tool);
      this.log(`Created executor for tool: ${tool.name}`);
    });

    this.log(
      `Anthropic tool handler created for ${
        Object.keys(executors).length
      } tools`,
      true
    );

    return async (toolUse: AnthropicToolUse): Promise<ToolExecutionResult> => {
      const { name, input } = toolUse;
      this.log(`Anthropic requested tool: ${name}`);

      this.log(`Tool inputs: ${JSON.stringify(input)}`);

      if (executors[name]) {
        this.log(`Executing tool: ${name}`);
        const result = await executors[name](input);
        if (result.error) {
          this.logError(`Tool ${name} execution failed: ${result.error}`);
          return {
            error: `Something went wrong with the tool execution. Details: ${result.error}`,
          };
        }

        this.log(`Tool ${name} output: ${result.output}`);
        this.log(`Tool ${name} executed successfully`);
        return result;
      } else {
        const errorMsg = `Tool ${name} not found in available tools`;
        this.logError(errorMsg);
        return { error: errorMsg };
      }
    };
  }

  /**
   * Creates an Anthropic chatbot with tool capabilities
   * @param params - Configuration parameters for the chatbot
   * @param params.anthropicClient - Initialized Anthropic client
   * @param params.llmConfig - Configuration for the LLM model
   * @param params.options - Optional additional settings
   * @param params.options.toolNames - Optional list of specific tools to use
   * @returns A function that handles conversations with the chatbot
   */
  // For AnthropicAdapter
  public async createAnthropicChatbot(params: {
    anthropicClient: any;
    llmConfig: AnthropicChatbotOptions;
    options?: {
      toolNames?: ToolNameParam[];
    };
  }) {
    const { anthropicClient, llmConfig, options } = params;
    const toolNames = options?.toolNames;
    const adapter = this; // Store reference to this for inner functions

    await this.ensureInitialized();

    this.log(`Creating Anthropic chatbot...`, true);

    // Get tools
    const tools = await this.getAnthropicTools(toolNames);
    this.log(`Chatbot initialized with ${tools.length} tools`, true);

    // Create tool handler
    const toolHandler = await this.createAnthropicToolHandler(toolNames);

    // Default options
    const defaultLlmConfig: AnthropicChatbotOptions = {
      model: "claude-3-7-sonnet-20250219",
      temperature: 0.7,
      ...llmConfig,
    };

    this.log(`Chatbot configured with model: ${defaultLlmConfig.model}`, true);

    // Initialize conversation history
    const messages: any[] = [];

    /**
     * Invokes the chatbot with a user message
     * @param userInput - The message from the user (string or complex message object)
     * @returns The chatbot's response
     */
    async function invoke(
      userInput: string | Record<string, any>
    ): Promise<ChatbotResult> {
      adapter.log(`Processing user message`);

      // Handle different input types
      let userMessage: any;

      if (typeof userInput === "string") {
        // Simple text message
        userMessage = {
          role: "user",
          content: userInput,
        };
      } else {
        // Complex message object - pass as-is
        userMessage = {
          role: "user",
          content: userInput,
        };
      }

      // Add user message to history
      messages.push(userMessage);

      // Create a copy of messages for this invocation
      const currentMessages = [...messages];

      try {
        // Create API call options
        const apiOptions: any = {
          messages: currentMessages,
          ...defaultLlmConfig, // Include all default options
        };

        // Add tools if provided
        if (tools && tools.length > 0) {
          apiOptions.tools = tools;
        }

        adapter.log(`Calling Anthropic API (${tools.length} tools enabled)`);

        // Call Anthropic API with all options
        const response = await anthropicClient.messages.create(apiOptions);

        adapter.log(`Received response from Anthropic API`);

        // Process the response and handle any tool usage
        const result = await processResponse(response);

        return {
          text: result,
          messages: [...messages], // Return a copy of the conversation history
        };
      } catch (error: any) {
        // Handle errors with more details
        let errorMessage: string;

        if (error.status) {
          errorMessage = `Anthropic API Error (${error.status}): ${error.message}`;

          if (error.error) {
            errorMessage += `\nDetails: ${JSON.stringify(error.error)}`;
          }
        } else {
          errorMessage = `Error in Anthropic API: ${error.message}`;
        }

        adapter.logError(errorMessage);

        messages.push({
          role: "assistant",
          content: errorMessage,
        });

        return {
          text: errorMessage,
          messages: [...messages],
        };
      }
    }

    /**
     * Process the response from Anthropic, handling any tool usage
     * @param response - The response from Anthropic
     * @returns The final text response
     */
    async function processResponse(response: any): Promise<string> {
      // Full assistant response text
      let responseText = "";

      // Add the response to conversation history
      if (response.content.every((item: any) => item.type === "text")) {
        // If response contains only text, add it directly
        const fullText = response.content
          .map((item: any) => item.text)
          .join("");

        messages.push({
          role: "assistant",
          content: fullText,
        });

        adapter.log(`Received text-only response (${fullText.length} chars)`);
        return fullText;
      }

      adapter.log(`Processing complex response with multiple content types`);

      // Process each content item in the response
      for (const content of response.content) {
        if (content.type === "text") {
          responseText += content.text;
          adapter.log(`Added text content (${content.text.length} chars)`);
        } else if (content.type === "tool_use" && toolHandler) {
          // If there's tool usage, we'll need to execute the tool and get continuation
          adapter.log(`Detected tool use request: ${content.name}`, true);

          // First, add the assistant's tool use message to history
          messages.push({
            role: "assistant",
            content: response.content,
          });

          // Execute the tool
          try {
            adapter.log(`Executing tool ${content.name}...`);

            const toolResult = await toolHandler({
              id: content.id,
              name: content.name,
              input: content.input,
            });

            // Add tool response to messages following Anthropic's expected format
            if (toolResult.error) {
              adapter.logError(
                `Tool execution error for ${content.name}: ${toolResult.error}`
              );
              messages.push({
                role: "user",
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: content.id,
                    content: JSON.stringify({ error: toolResult.error }),
                  },
                ],
              });
            } else {
              adapter.log(`Tool ${content.name} executed successfully`);
              adapter.log(`Tool result: ${toolResult.output}`);

              messages.push({
                role: "user",
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: content.id,
                    content: JSON.stringify({ output: toolResult.output }),
                  },
                ],
              });
            }
          } catch (error: any) {
            adapter.logError(`Tool handler error: ${error.message}`);
            messages.push({
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: content.id,
                  content: JSON.stringify({
                    error: `Failed to execute tool: ${error.message}`,
                  }),
                },
              ],
            });
          }

          // Create API call options for continuation
          const apiOptions: any = {
            messages,
            ...defaultLlmConfig, // Include all default options
          };

          // Add tools if provided
          if (tools && tools.length > 0) {
            apiOptions.tools = tools;
          }

          adapter.log(`Requesting continuation from Anthropic after tool use`);

          // Get continuation from AI after tool use
          const continuation = await anthropicClient.messages.create(
            apiOptions
          );

          // Check if the continuation contains more tool usage
          if (
            continuation.content.some((item: any) => item.type === "tool_use")
          ) {
            // Recursive call to handle nested tool usage
            adapter.log(
              "Detected nested tool usage, processing recursively",
              true
            );
            const nestedResult = await processResponse(continuation);
            responseText += nestedResult;
          } else {
            // Add the continuation text
            const continuationText = continuation.content
              .filter((item: any) => item.type === "text")
              .map((item: any) => item.text)
              .join("");

            responseText += continuationText;
            adapter.log(
              `Received continuation text (${continuationText.length} chars)`
            );

            // Add continuation to history
            messages.push({
              role: "assistant",
              content: continuationText,
            });
          }
        }
      }

      return responseText;
    }

    /**
     * Resets the conversation history
     */
    function resetConversation() {
      adapter.log(`Conversation history reset`, true);
      messages.length = 0;
    }

    /**
     * Gets the current conversation history
     */
    function getConversationHistory(): any[] {
      adapter.log(
        `Retrieved conversation history (${messages.length} messages)`
      );
      return [...messages];
    }

    // Return the chatbot interface
    return {
      invoke,
      resetConversation,
      getConversationHistory,
    };
  }
}
