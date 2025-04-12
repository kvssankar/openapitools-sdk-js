import Anthropic from "@anthropic-ai/sdk";
import { AnthropicAdapter } from "@reacter/openapitools";
import path from "path";
import { fileURLToPath } from "url";

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  // Initialize Anthropic client
  const anthropic = new Anthropic({
    apiKey: "your-anthropic-key",
  });

  // Initialize tools adapter

  // const toolsAdapter = new AnthropicAdapter(
  //   "apik_47677d9a7375d4087bdcf60a6b861d33bff06bff1f5bdddaad0e1a1959759430eaf8bd94cef844245200fedccd55b5c8_c4854ed60d3ee64f",
  //   {
  //     verbose: true,
  //   }
  // );

  const toolsAdapter = new AnthropicAdapter(
    path.join(__dirname, "openapitools"),
    { verbose: true }
  );

  toolsAdapter.addEnvironmentVariable("secret", 20);

  // Create a chatbot with tools
  const chatbot = await toolsAdapter.createAnthropicChatbot({
    anthropicClient: anthropic,
    llmConfig: {
      model: "claude-3-7-sonnet-20250219",
      temperature: 0.7,
      max_tokens: 4096,
      system:
        "You are a helpful assistant with access to tools. Use them when appropriate.",
    },
  });

  // Get a response that might use tools
  const result = await chatbot.invoke("can u generate otp for 98989898981");
  console.log("final result: ", result.text);
}

main().catch(console.error);
