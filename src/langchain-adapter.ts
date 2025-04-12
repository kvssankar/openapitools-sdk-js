import {
  BaseToolsAdapter,
  Tool,
  ToolNameParam,
  ToolExecutionResult,
  ChatbotResult,
} from "./base-adapter";
import { z } from "zod";

/**
 * LangChain tool format matching StructuredToolInterface
 */
export interface LangChainTool {
  name: string;
  description: string;
  schema: z.ZodObject<any>;
  func: (input: Record<string, any>) => Promise<string>;
  invoke: (input: Record<string, any>) => Promise<string>;
  lc_namespace: string[];
  returnDirect: boolean;
}

/**
 * Options for the LangChain chatbot
 */
export interface LangChainChatbotOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  [key: string]: any; // Allow any additional LangChain options
}

/**
 * Adapter for LangChain
 */
export class LangChainAdapter extends BaseToolsAdapter {
  /**
   * Convert JSON Schema to Zod schema
   * @param jsonSchema - JSON Schema object
   * @returns Zod schema object
   */
  private jsonSchemaToZod(jsonSchema: Record<string, any>): z.ZodObject<any> {
    // Create a map for the properties
    const schemaMap: Record<string, any> = {};

    // If the schema has properties, convert each one
    if (jsonSchema.properties) {
      Object.entries(jsonSchema.properties).forEach(
        ([key, prop]: [string, any]) => {
          let zodType: any;

          // Convert JSON Schema types to Zod types
          switch (prop.type) {
            case "string":
              zodType = z.string();
              if (prop.enum) {
                zodType = z.enum(prop.enum);
              }
              if (prop.format === "date-time") {
                zodType = z.string().datetime();
              }
              break;
            case "number":
              zodType = z.number();
              break;
            case "integer":
              zodType = z.number().int();
              break;
            case "boolean":
              zodType = z.boolean();
              break;
            case "array":
              const itemType = prop.items?.type || "string";
              let innerType = z.string();

              //@ts-ignore
              if (itemType === "number") innerType = z.number();
              //@ts-ignore
              if (itemType === "integer") innerType = z.number().int();
              //@ts-ignore
              if (itemType === "boolean") innerType = z.boolean();

              zodType = z.array(innerType);
              break;
            case "object":
              // Recursively convert nested objects
              zodType = this.jsonSchemaToZod(prop);
              break;
            default:
              zodType = z.any();
          }

          // Make property optional if not required
          if (jsonSchema.required && !jsonSchema.required.includes(key)) {
            zodType = zodType.optional();
          }

          // Add the property to the schema map
          schemaMap[key] = zodType;
        }
      );
    }

    // Create and return the Zod object schema
    return z.object(schemaMap);
  }

  /**
   * Convert tools to LangChain format
   * @param toolNames - Optional list of specific tools to convert
   * @returns Array of tools in LangChain format
   */
  public async getLangChainTools(
    toolNames?: ToolNameParam[]
  ): Promise<LangChainTool[]> {
    await this.ensureInitialized();

    this.log(`Converting tools to LangChain format...`);
    const selectedTools = await this.getToolsByNames(toolNames);

    const langChainTools: LangChainTool[] = [];

    // Create each tool with its executor function
    for (const tool of Object.values(selectedTools)) {
      // Create the executor for this tool
      const executor = this.createToolExecutor(tool);

      // Convert JSON Schema to Zod Schema
      const zodSchema = this.jsonSchemaToZod(tool.input_schema);

      // Shared implementation for both func and invoke
      const executeToolFunction = async (
        input: Record<string, any>
      ): Promise<string> => {
        // Execute the tool
        const result = await executor(input);

        // Return the result as a string (or error)
        if (result.error) {
          throw new Error(result.error);
        }
        return result.output || "";
      };

      // Create LangChain tool with the executor
      const langChainTool: LangChainTool = {
        name: tool.name,
        description: tool.description,
        schema: zodSchema,
        lc_namespace: ["langchain", "tools"],
        returnDirect: false,
        func: executeToolFunction,
        invoke: executeToolFunction,
      };

      langChainTools.push(langChainTool);
      this.log(`Converted tool to LangChain format: ${tool.name}`);
    }

    this.log(`Converted ${langChainTools.length} tools to LangChain format`);
    return langChainTools;
  }
}
