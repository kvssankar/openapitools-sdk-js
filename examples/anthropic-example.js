// chatbot.js
import readline from "readline";
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicAdapter } from "@reacter/openapitools"; // Adjust path as needed

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: "your-anthropic-key",
});

// Initialize your tools adapter
const toolsAdapter = new AnthropicAdapter(
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

  // Get tools in Anthropic format
  const tools = await toolsAdapter.getAnthropicTools();
  console.log(`Loaded ${tools.length} tools`);

  // Create tool handler
  const toolHandler = await toolsAdapter.createAnthropicToolHandler();

  // Start conversation
  console.log("\n=== AI Assistant with Tools ===");
  console.log("Type 'exit' to quit");

  // Store conversation history
  const messages = [
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

      // Call Anthropic API with tools
      const response = await anthropic.messages.create({
        model: "claude-3-opus-20240229",
        max_tokens: 1024,
        temperature: 0.7,
        messages: messages,
        tools: tools,
      });

      // Clear the thinking indicator
      clearInterval(thinkingInterval);
      process.stdout.write("\n");

      // Process the response
      for (const content of response.content) {
        if (content.type === "text") {
          console.log(`\nAssistant: ${content.text}`);
          messages.push({
            role: "assistant",
            content: content.text,
          });
        } else if (content.type === "tool_use") {
          console.log(`\nAssistant is using tool: ${content.name}`);
          console.log(content.input);

          messages.push({
            role: "assistant",
            content: response.content,
          });

          // Execute the tool
          const result = await toolHandler({
            id: content.id,
            name: content.name,
            input: content.input,
          });

          // Add tool response to messages following Anthropic's expected format
          if (result.error) {
            console.log(`\nTool Error: ${result.error}`);
            messages.push({
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: content.id,
                  content: JSON.stringify({ error: result.error }),
                },
              ],
            });
          } else {
            console.log(`\nTool Result: ${result.output}`);
            messages.push({
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: content.id,
                  content: JSON.stringify({ output: result.output }),
                },
              ],
            });
          }

          // Get continuation from AI after tool use
          const continuation = await anthropic.messages.create({
            model: "claude-3-opus-20240229",
            max_tokens: 1024,
            temperature: 0.7,
            messages: messages,
          });

          const continuationText = continuation.content[0].text;
          console.log(`\nAssistant: ${continuationText}`);

          // Add continuation to history
          messages.push({
            role: "assistant",
            content: continuationText,
          });
        }
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
