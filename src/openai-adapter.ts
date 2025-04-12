import {
  BaseToolsAdapter,
  Tool,
  ToolNameParam,
  ToolExecutionResult,
  ChatbotResult,
} from "./base-adapter";

/**
 * OpenAI tool format
 */
export interface OpenAITool {
  type: string;
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

/**
 * OpenAI tool call format
 */
export interface OpenAIToolUse {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Options for the OpenAI chatbot
 */
export interface OpenAIChatbotOptions {
  model?: string;
  temperature?: number;
  system?: string;
  [key: string]: any; // Allow any additional OpenAI API options
}

/**
 * Result of a chatbot invocation
 */

/**
 * Adapter for OpenAI API
 */
export class OpenAIAdapter extends BaseToolsAdapter {
  /**
   * Convert tools to OpenAI format
   * @param toolNames - Optional list of specific tools to convert
   * @returns Array of tools in OpenAI format
   */
  public async getOpenAITools(
    toolNames?: ToolNameParam[]
  ): Promise<OpenAITool[]> {
    await this.ensureInitialized();

    this.log(`Converting tools to OpenAI format...`);
    const selectedTools = await this.getToolsByNames(toolNames);

    const openaiTools = Object.values(selectedTools).map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }));

    this.log(`Converted ${openaiTools.length} tools to OpenAI format`);

    return openaiTools;
  }

  /**
   * Creates a function to handle OpenAI tool calls
   * @param toolNames - Optional list of specific tools to handle
   * @returns Tool handler function for OpenAI
   */
  public async createOpenAIToolHandler(
    toolNames?: ToolNameParam[]
  ): Promise<(toolUse: OpenAIToolUse) => Promise<ToolExecutionResult>> {
    await this.ensureInitialized();

    this.log(`Creating OpenAI tool handler...`);
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
      `OpenAI tool handler created for ${Object.keys(executors).length} tools`,
      true
    );

    return async (toolUse: OpenAIToolUse): Promise<ToolExecutionResult> => {
      const {
        function: { name, arguments: argsString },
      } = toolUse;
      this.log(`OpenAI requested tool: ${name}`);

      // Parse the arguments string to an object
      let input: Record<string, any>;
      try {
        input = JSON.parse(argsString);
        this.log(`Tool inputs: ${JSON.stringify(input)}`);
      } catch (error) {
        const errorMsg = `Failed to parse tool arguments: ${error}`;
        this.logError(errorMsg);
        return { error: errorMsg };
      }

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
   * Creates an OpenAI chatbot with tool capabilities
   * @param params - Configuration parameters for the chatbot
   * @param params.openaiClient - Initialized OpenAI client
   * @param params.llmConfig - Configuration for the LLM model
   * @param params.options - Optional additional settings
   * @param params.options.toolNames - Optional list of specific tools to use
   * @returns A function that handles conversations with the chatbot
   */
  // For OpenAIAdapter
  public async createOpenAIChatbot(params: {
    openaiClient: any;
    llmConfig: OpenAIChatbotOptions;
    options?: {
      toolNames?: ToolNameParam[];
    };
  }) {
    const { openaiClient, llmConfig, options } = params;
    const toolNames = options?.toolNames;
    const adapter = this; // Store reference to this for inner functions

    await this.ensureInitialized();

    this.log(`Creating OpenAI chatbot...`, true);

    // Get tools
    const tools = await this.getOpenAITools(toolNames);
    this.log(`Chatbot initialized with ${tools.length} tools`, true);

    // Create tool handler
    const toolHandler = await this.createOpenAIToolHandler(toolNames);

    // Default options
    const defaultLlmConfig: OpenAIChatbotOptions = {
      model: "gpt-4o",
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

      // Add system message at the beginning if provided
      if (
        defaultLlmConfig.system &&
        currentMessages.length > 0 &&
        currentMessages[0].role !== "system"
      ) {
        currentMessages.unshift({
          role: "system",
          content: defaultLlmConfig.system,
        });
      }

      try {
        delete defaultLlmConfig.system;
        // Create API call options
        const apiOptions: any = {
          messages: currentMessages,
          ...defaultLlmConfig,
        };

        // Add any additional options from llmConfig
        for (const [key, value] of Object.entries(defaultLlmConfig)) {
          if (!["model", "temperature", "max_tokens", "system"].includes(key)) {
            apiOptions[key] = value;
          }
        }

        // Add tools if provided
        if (tools && tools.length > 0) {
          apiOptions.tools = tools;
        }

        adapter.log(`Calling OpenAI API (${tools.length} tools enabled)`);

        // Call OpenAI API with all options
        const response = await openaiClient.chat.completions.create(apiOptions);

        adapter.log(`Received response from OpenAI API`);

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
          errorMessage = `OpenAI API Error (${error.status}): ${error.message}`;

          if (error.error) {
            errorMessage += `\nDetails: ${JSON.stringify(error.error)}`;
          }
        } else {
          errorMessage = `Error in OpenAI API: ${error.message}`;
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
     * Process the response from OpenAI, handling any tool usage
     * @param response - The response from OpenAI
     * @returns The final text response
     */
    async function processResponse(response: any): Promise<string> {
      const message = response.choices[0].message;

      // Check if there are tool calls
      if (message.tool_calls && message.tool_calls.length > 0) {
        adapter.log(`Detected ${message.tool_calls.length} tool call(s)`, true);

        // Add the assistant's message with tool calls to history
        messages.push({
          role: "assistant",
          content: message.content,
          tool_calls: message.tool_calls,
        });

        // Process each tool call
        const toolResults = [];
        for (const toolCall of message.tool_calls) {
          adapter.log(`Executing tool call: ${toolCall.function.name}`, true);

          // Execute the tool
          try {
            const toolResult = await toolHandler(toolCall);

            // Add tool response to messages
            toolResults.push({
              tool_call_id: toolCall.id,
              role: "tool",
              name: toolCall.function.name,
              content: toolResult.error
                ? JSON.stringify({ error: toolResult.error })
                : JSON.stringify({ output: toolResult.output }),
            });
          } catch (error: any) {
            adapter.logError(`Tool handler error: ${error.message}`);
            toolResults.push({
              tool_call_id: toolCall.id,
              role: "tool",
              name: toolCall.function.name,
              content: JSON.stringify({
                error: `Failed to execute tool: ${error.message}`,
              }),
            });
          }
        }

        // Add all tool results to messages
        messages.push(...toolResults);

        // Create API call options for continuation
        const apiOptions: any = {
          messages: [...messages],
          model: defaultLlmConfig.model,
          temperature: defaultLlmConfig.temperature,
          max_tokens: defaultLlmConfig.max_tokens,
          stream: false,
        };

        // Add any additional options from llmConfig
        for (const [key, value] of Object.entries(defaultLlmConfig)) {
          if (!["model", "temperature", "max_tokens", "system"].includes(key)) {
            apiOptions[key] = value;
          }
        }

        // Add tools again for potential future tool calls
        if (tools && tools.length > 0) {
          apiOptions.tools = tools;
        }

        adapter.log(`Requesting continuation from OpenAI after tool use`);

        // Get continuation from AI after tool use
        const continuation = await openaiClient.chat.completions.create(
          apiOptions
        );

        // Check if the continuation contains more tool calls
        const continuationMessage = continuation.choices[0].message;
        if (
          continuationMessage.tool_calls &&
          continuationMessage.tool_calls.length > 0
        ) {
          // Recursive call to handle nested tool usage
          adapter.log(
            "Detected nested tool usage, processing recursively",
            true
          );
          const nestedResult = await processResponse(continuation);
          return nestedResult;
        } else {
          // Add continuation to history
          messages.push({
            role: "assistant",
            content: continuationMessage.content,
          });

          adapter.log(
            `Received continuation text (${continuationMessage.content.length} chars)`
          );
          return continuationMessage.content;
        }
      } else {
        // Simple text response without tool usage
        const responseText = message.content || "";

        // Add the response to conversation history
        messages.push({
          role: "assistant",
          content: responseText,
        });

        adapter.log(
          `Received text-only response (${responseText.length} chars)`
        );
        return responseText;
      }
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
