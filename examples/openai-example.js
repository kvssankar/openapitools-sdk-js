// openai-chatbot.js
import readline from "readline";
import OpenAI from "openai/index.mjs";
import { OpenAIAdapter } from "@reacter/openapitools"; // Adjust path as needed

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: "your-openai-key", // Replace with your actual OpenAI API key
});

// Initialize your tools adapter
const toolsAdapter = new OpenAIAdapter(
  "apik_47677d9a7375d4087bdcf60a6b861d33bff06bff1f5bdddaad0e1a1959759430eaf8bd94cef844245200fedccd55b5c8_c4854ed60d3ee64f",
  {
    autoRefreshCount: 50, // Refresh tools after 50 calls
    verbose: false,
  }
);

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Function to ask a question and get input
function askQuestion(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function main() {
  console.log("Initializing tools...");
  await toolsAdapter.initialize();

  // Get tools in OpenAI format
  const tools = await toolsAdapter.getOpenAITools();
  console.log(`Loaded ${tools.length} tools`);

  // Create tool handler
  const toolHandler = await toolsAdapter.createOpenAIToolHandler();

  // Start conversation
  console.log("\n=== AI Assistant with Tools ===");
  console.log("Type 'exit' to quit");

  // Store conversation history
  const messages = [
    {
      role: "system",
      content: "You are a helpful AI assistant with tool capabilities.",
    },
    {
      role: "assistant",
      content:
        "Hello! I'm your AI assistant with tool capabilities. How can I help you today?",
    },
  ];

  console.log(
    "\nAssistant: Hello! I'm your AI assistant with tool capabilities. How can I help you today?"
  );

  // Chat loop
  while (true) {
    const userInput = await askQuestion("\nYou: ");

    if (userInput.toLowerCase() === "exit") {
      console.log("Goodbye!");
      rl.close();
      break;
    }

    // Add user message to history
    messages.push({
      role: "user",
      content: userInput,
    });

    try {
      // Log that we're waiting for a response
      const thinkingInterval = setInterval(() => {
        process.stdout.write(".");
      }, 500);

      // Call OpenAI API with tools
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: messages,
        temperature: 0.7,
        max_tokens: 1024,
        tools: tools,
      });

      // Clear the thinking indicator
      clearInterval(thinkingInterval);
      process.stdout.write("\n");

      // Get the response message
      const responseMessage = response.choices[0].message;

      // Check if there are tool calls
      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        // Add assistant's message with tool calls to history
        messages.push({
          role: "assistant",
          content: responseMessage.content,
          tool_calls: responseMessage.tool_calls,
        });

        console.log(
          `\nAssistant: ${
            responseMessage.content || "Let me use a tool to help with that."
          }`
        );

        // Process each tool call
        for (const toolCall of responseMessage.tool_calls) {
          console.log(`\nAssistant is using tool: ${toolCall.function.name}`);
          console.log(`Input: ${toolCall.function.arguments}`);

          // Execute the tool
          const result = await toolHandler(toolCall);

          // Format the tool result
          const resultContent = result.error
            ? JSON.stringify({ error: result.error })
            : JSON.stringify({ output: result.output });

          // Add tool response to messages
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
            content: resultContent,
          });

          if (result.error) {
            console.log(`\nTool Error: ${result.error}`);
          } else {
            console.log(`\nTool Result: ${result.output}`);
          }
        }

        // Get continuation from AI after tool use
        const continuation = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: messages,
          temperature: 0.7,
          max_tokens: 1024,
          tools: tools, // Include tools again for potential future tool calls
        });

        const continuationMessage = continuation.choices[0].message;

        // Check if there are more tool calls in the continuation
        if (
          continuationMessage.tool_calls &&
          continuationMessage.tool_calls.length > 0
        ) {
          // This would require recursive handling, but for simplicity in this example,
          // we'll just note that there are more tool calls
          console.log(
            "\nAssistant wants to use more tools. Simplifying response for this example."
          );

          messages.push({
            role: "assistant",
            content:
              continuationMessage.content ||
              "I'd like to use more tools, but let me summarize what I've found so far.",
          });

          console.log(
            `\nAssistant: ${
              continuationMessage.content ||
              "Let me summarize what I've found so far."
            }`
          );
        } else {
          // Add continuation to history
          messages.push({
            role: "assistant",
            content: continuationMessage.content,
          });

          console.log(`\nAssistant: ${continuationMessage.content}`);
        }
      } else {
        // Simple text response
        console.log(`\nAssistant: ${responseMessage.content}`);

        // Add to history
        messages.push({
          role: "assistant",
          content: responseMessage.content,
        });
      }
    } catch (error) {
      console.error("\nError:", error.message);
    }
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  rl.close();
});
