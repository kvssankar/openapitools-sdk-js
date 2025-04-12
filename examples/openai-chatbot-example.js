import OpenAI from "openai";
import { OpenAIAdapter } from "@reacter/openapitools";

async function main() {
  // Initialize OpenAI client
  const openai = new OpenAI({
    apiKey: "your-openai-key", // Replace with your actual OpenAI API key
  });

  // Initialize tools adapter
  const toolsAdapter = new OpenAIAdapter(
    "apik_47677d9a7375d4087bdcf60a6b861d33bff06bff1f5bdddaad0e1a1959759430eaf8bd94cef844245200fedccd55b5c8_c4854ed60d3ee64f",
    {
      verbose: true,
    }
  );

  await toolsAdapter.initialize();

  // Create a chatbot with tools
  const chatbot = await toolsAdapter.createOpenAIChatbot({
    openaiClient: openai,
    llmConfig: {
      model: "gpt-4o",
      temperature: 0.7,
      max_tokens: 4096,
      system:
        "You are a helpful assistant with access to tools. Use them when appropriate.",
    },
    options: {
      toolNames: [
        {
          name: "generateotptool",
          version: "initial",
        },
      ],
    },
  });

  // Get a response that might use tools
  const result = await chatbot.invoke("can u generate otp for 98989898981");
  console.log("final result: ", result.text);
}

main().catch(console.error);
