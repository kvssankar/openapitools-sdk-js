# OpenAPITools SDK

## Introduction

OpenAPITools JS package enables developers to manage, and execute tools across multiple AI API providers. It provides a unified interface for working with tools in Anthropic's Claude, OpenAI's GPT models, and LangChain frameworks.

With OpenAPITools, you can:

- Create tools as Python or Bash scripts with standardized input/output
- Access these tools through a single, consistent SDK
- Integrate tools with Claude, GPT, and LangChain models
- Build interactive chatbots that can use tools to solve complex tasks

### Install from npm

```bash
npm install @reacter/openapitools
```

## Tool Execution Details

### Python Tools

- Python tools are executed spawning new threads in nodejs
- Considerations:
  - Has interpreter startup overhead in JS environments
  - Full privacy (code runs locally)
  - Better for complex tasks requiring Python packages
- Python tools receive arguments via an `input_json` dictionary and can access environment variables through `input_json["openv"]`

### Bash Tools

- Bash tools are executed as subprocesses
- Arguments are passed as JSON to the script's standard input
- Very fast execution in nodejs environments
- Preferred for JavaScript/nodejs environments for better performance
- Note: Bash tools should be tested in Linux environments or WSL, as they may not function correctly in Windows

## Usage Modes

### [Local Mode](https://claude.ai/localmode) (preferred)

```js
const toolsAdapter = new AnthropicAdapter(
    path.join(__dirname, "openapitools"),
    { verbose: true }
  );
```

### API Mode (rate limits apply)

```python
adapter = ToolsAdapter(api_key="your_api_key")

```

## Performance Considerations

- **Python Tools**: Better for readability and when complex Python packages are needed
- **Bash Tools**: Significantly faster in nodejs environments with minimal overhead
- For maximum performance in JavaScript/nodejs environments, prefer Bash tools
- If you need more readability or complex packages, go with Python tools

## Security and Privacy

- All tool execution happens locally within your environment
- No code is sent to external servers for execution
- Environment variables can be securely passed to tools

## Integration with AI Models

OpenAPITools provides native integration with:

- Anthropic's Claude
- OpenAI's GPT models
- LangChain frameworks

This allows you to build AI assistants that can leverage tools to perform complex tasks.

> [!NOTE]
>
> Platform Considerations:
> Python servers have better compatibility with the latest AI packages, LangChain SDKs, and other AI development frameworks. Consider working in a Python-centric environment using the Python SDK: `pip install reacter-openapitools`

Visit [docs.openapitools.com](https://docs.openapitools.com) for more information on how to use the OpenAPITools SDK, including detailed examples and API references.
