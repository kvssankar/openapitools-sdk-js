import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { createToolCallingAgent } from "langchain/agents";
import { AgentExecutor } from "langchain/agents";
import { LangChainAdapter } from "@reacter/openapitools";
import { ChatAnthropic } from "@langchain/anthropic";

// const llm = new ChatOpenAI({
//   model: "gpt-4o-mini",
//   apiKey:
//     "your-openai-key",
//   verbose: true,
// });

const llm = new ChatAnthropic({
  model: "claude-3-7-sonnet-20250219",
  apiKey: "your-anthropic-key",
  verbose: true,
});

const toolsAdapter = new LangChainAdapter(
  "apik_47677d9a7375d4087bdcf60a6b861d33bff06bff1f5bdddaad0e1a1959759430eaf8bd94cef844245200fedccd55b5c8_c4854ed60d3ee64f",
  {
    autoRefreshCount: 50,
  }
);

async function main() {
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", "You are a helpful assistant"],
    ["placeholder", "{chat_history}"],
    ["human", "{input}"],
    ["placeholder", "{agent_scratchpad}"],
  ]);

  const tools = await toolsAdapter.getLangChainTools();

  const agent = createToolCallingAgent({
    llm,
    tools,
    prompt,
  });

  const agentExecutor = new AgentExecutor({
    agent,
    tools,
  });

  const res = await agentExecutor.invoke({
    input: "can u pls generate otp for 98989898981",
  });

  console.log(res);
}

main().catch(console.error);
