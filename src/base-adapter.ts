import { exec, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

/**
 * Represents the structure of a single tool
 */
export interface Tool {
  id: string;
  name: string;
  description: string;
  input_schema: Record<string, any>; // JSON Schema
  script: string;
  script_type: "bash" | "python";
  version_name: string;
  script_path?: string; // Path to script file for local mode
}

export interface ChatbotResult {
  text: string;
  messages: any[];
}

/**
 * Tool name parameter which can be a string or object with version
 */
export type ToolNameParam = string | { name: string; version?: string };

/**
 * Map of tool keys to tool objects
 */
export type ToolsMap = Record<string, Tool>;

/**
 * Tool execution result
 */
export interface ToolExecutionResult {
  output?: string;
  error?: string;
}

/**
 * Environment check result
 */
export interface EnvironmentCheck {
  scriptType: string;
  valid: boolean;
  executor: string;
  error?: string;
}

/**
 * Adapter initialization options
 */
export interface ToolsAdapterOptions {
  apiUrl?: string;
  folderPath?: string; // Path to local tools folder
  autoRefreshCount?: number; // Number of tool calls before auto-refresh
  skipEnvironmentCheck?: boolean; // Skip initial environment check
  verbose?: boolean; // Enable verbose logging
}

/**
 * Base adapter class for tools
 */
export class BaseToolsAdapter {
  protected apiKey?: string;
  protected folderPath?: string;
  protected toolsMap: ToolsMap = {};
  protected initialized: boolean = false;
  protected apiUrl: string = "https://s8ka4ekkbp.us-east-1.awsapprunner.com";
  protected environmentChecks: Record<string, EnvironmentCheck> = {};
  protected toolCallCount: number = 0;
  protected autoRefreshCount: number = 100; // Default to refresh after 100 tool calls
  protected skipInitialEnvironmentCheck: boolean = false;
  protected environmentVariables: Record<string, string> = {};
  protected verbose: boolean | undefined = true;
  protected localMode: boolean = false;

  /**
   * @param pathOrKey - API key for authentication or folder path
   * @param options - Optional configuration
   */
  constructor(pathOrKey: string, options?: ToolsAdapterOptions) {
    options = options || {};

    // Determine if the provided string is an API key or folder path
    if (pathOrKey.startsWith("apik_")) {
      this.apiKey = pathOrKey;
      this.localMode = false;
    } else {
      this.folderPath = pathOrKey;
      this.localMode = true;
    }

    if (options.apiUrl) {
      this.apiUrl = options.apiUrl;
    }

    if (options.folderPath) {
      // Override the path if explicitly provided in options
      this.folderPath = options.folderPath;
      this.localMode = true;
      // If both API key and folder path are provided, folder path takes precedence
      this.apiKey = undefined;
    }

    if (options.autoRefreshCount !== undefined) {
      this.autoRefreshCount = options.autoRefreshCount;
    }

    // If environment check isn't explicitly skipped, we'll do it during initialization
    this.skipInitialEnvironmentCheck = options?.skipEnvironmentCheck || false;

    // Set verbose mode
    this.verbose = options?.verbose;

    // Validate that we have either API key or folder path
    if (!this.localMode && !this.apiKey) {
      throw new Error("Either apiKey or folderPath must be provided");
    }

    this.initialize();
  }

  /**
   * Log message based on verbose setting
   * @param message - Message to log
   * @param force - Force log regardless of verbose setting
   * @private
   */
  protected log(message: string, force: boolean = false): void {
    if (this.verbose) {
      console.log(`[OpenAPI Tools SDK] ${message}`);
    }
  }

  /**
   * Log error message (always shown)
   * @param message - Error message to log
   * @private
   */
  protected logError(message: string): void {
    console.error(`[OpenAPI Tools SDK ERROR] ${message}`);
  }

  /**
   * Check if the current OS supports the script type
   * @param scriptType - Type of script (bash or python)
   * @protected
   */
  protected async checkEnvironment(
    scriptType: string
  ): Promise<EnvironmentCheck> {
    // If we already checked this script type, return cached result
    if (this.environmentChecks[scriptType]) {
      return this.environmentChecks[scriptType];
    }

    let result: EnvironmentCheck;

    if (scriptType === "python") {
      // Check Python availability separately
      result = await new Promise((resolve) => {
        // First try 'python' command
        exec("python --version", (pythonError) => {
          if (!pythonError) {
            // python command works
            resolve({ scriptType, valid: true, executor: "python" });
          } else {
            // If python fails, try python3
            exec("python3 --version", (python3Error) => {
              if (!python3Error) {
                // python3 command works
                resolve({ scriptType, valid: true, executor: "python3" });
              } else {
                // Neither python nor python3 is available
                resolve({
                  scriptType,
                  valid: false,
                  executor: "",
                  error: "Python is not installed or not available in PATH.",
                });
              }
            });
          }
        });
      });
    } else if (scriptType === "bash") {
      // Check bash availability without WSL checks
      result = await new Promise((resolve) => {
        exec("bash --version", (error) => {
          if (error) {
            resolve({
              scriptType,
              valid: false,
              executor: "",
              error: "Bash is not installed or not available in PATH.",
            });
          } else {
            resolve({ scriptType, valid: true, executor: "bash" });
          }
        });
      });
    } else {
      result = {
        scriptType,
        valid: false,
        executor: "",
        error: `Unsupported script type: ${scriptType}`,
      };
    }

    // Cache the result
    this.environmentChecks[scriptType] = result;
    return result;
  }

  /**
   * Check the environment for all supported script types
   * @returns Map of environment check results by script type
   */
  public async checkAllEnvironments(): Promise<
    Record<string, EnvironmentCheck>
  > {
    // Check all commonly used script types
    await this.checkEnvironment("python");
    await this.checkEnvironment("bash");

    return this.environmentChecks;
  }

  /**
   * Manually recheck the environment
   * @param forceRefresh - Force a refresh even if already checked
   * @returns Map of environment check results by script type
   */
  public async recheckEnvironment(
    forceRefresh: boolean = true
  ): Promise<Record<string, EnvironmentCheck>> {
    if (forceRefresh) {
      // Clear cached results
      this.environmentChecks = {};
    }

    // Check all script types used by the current tools
    const scriptTypes = new Set<string>();
    Object.values(this.toolsMap).forEach((tool) => {
      scriptTypes.add(tool.script_type);
    });

    // Always check the common script types anyway
    scriptTypes.add("python");
    scriptTypes.add("bash");

    // Check each script type
    for (const scriptType of scriptTypes) {
      await this.checkEnvironment(scriptType);
    }

    return this.environmentChecks;
  }

  /**
   * Initializes the adapter by fetching tools from the API or loading from folder
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.log("Initializing tools adapter...", true);

      if (this.localMode) {
        await this.loadToolsFromFolder();
      } else {
        await this.fetchTools();
      }

      // Perform environment checks for all tool script types
      if (!this.skipInitialEnvironmentCheck) {
        await this.recheckEnvironment();
        this.logEnvironmentStatus();
      }

      this.initialized = true;
      this.log(
        `Initialization complete. ${
          Object.keys(this.toolsMap).length
        } tools available.`,
        true
      );
    } catch (error: any) {
      this.logError(`Failed to initialize tools: ${error.message}`);
      throw error;
    }
  }

  /**
   * Loads tools from the specified folder path without loading script content
   */
  protected async loadToolsFromFolder(): Promise<void> {
    try {
      if (!this.folderPath) {
        throw new Error("Folder path is not set");
      }

      this.log(`Loading tools from folder: ${this.folderPath}`);

      // Validate folder path
      if (!fs.existsSync(this.folderPath)) {
        throw new Error(`Folder path does not exist: ${this.folderPath}`);
      }

      // Load tools.json file
      const toolsFilePath = path.join(this.folderPath, "tools.json");
      if (!fs.existsSync(toolsFilePath)) {
        throw new Error(`tools.json file not found in ${this.folderPath}`);
      }

      const toolsData = JSON.parse(fs.readFileSync(toolsFilePath, "utf8"));

      // Process each tool
      for (const toolData of toolsData) {
        const toolName = toolData.name;
        const toolId = toolData.id || "";
        const productionVersionName = toolData.production_version_name || "";

        // Access the production version from the versions map
        const versions = toolData.versions || {};

        // Check if versions is a dictionary
        if (typeof versions !== "object" || versions === null) {
          this.logError(`Versions for tool ${toolName} is not a dictionary`);
          continue;
        }

        // Get the production version from the versions map
        if (!versions[productionVersionName]) {
          this.logError(
            `Production version ${productionVersionName} not found for tool ${toolName}`
          );
          continue;
        }

        const productionVersion = versions[productionVersionName];

        // Create script path instead of loading content
        const scriptExtension =
          productionVersion.script_type === "python" ? ".py" : ".sh";
        const scriptFilename = `${toolName}-${productionVersionName}${scriptExtension}`;
        const scriptPath = path.join(this.folderPath, scriptFilename);

        if (!fs.existsSync(scriptPath)) {
          this.logError(`Script file not found: ${scriptPath}`);
          continue;
        }

        // Create the tool object without loading script content
        this.toolsMap[toolName.toLowerCase()] = {
          id: toolId,
          name: toolName,
          description: productionVersion.description || "",
          input_schema: productionVersion.input_schema || {},
          script: "", // Empty script content
          script_type: productionVersion.script_type || "bash",
          version_name: productionVersionName,
          script_path: scriptPath, // Store the path instead
        };

        this.log(
          `Loaded tool reference: ${toolName} (version: ${productionVersionName})`
        );
      }
    } catch (error: any) {
      this.logError(`Failed to load tools from folder: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetches tools from the API
   */
  protected async fetchTools(): Promise<void> {
    try {
      this.log("Fetching tools from API...");

      const response = await fetch(`${this.apiUrl}/api/get-tools`, {
        headers: {
          "x-api-key": this.apiKey || "",
        },
      });

      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }

      const result = await response.json();
      const tools = result.data || [];

      // Convert array to map with name as key
      this.toolsMap = tools.reduce((map: ToolsMap, tool: any) => {
        map[tool.name.toLowerCase()] = {
          ...tool,
          script: tool.script || "",
          script_type: tool.script_type || "bash", // Default to bash if not specified
        };
        return map;
      }, {});
    } catch (error: any) {
      this.logError(`Failed to fetch tools: ${error.message}`);
      throw error;
    }
  }

  /**
   * Manually refresh the tools from the API or local folder
   */
  public async refreshTools(): Promise<void> {
    try {
      this.log("Refreshing tools...", true);

      if (this.localMode) {
        await this.loadToolsFromFolder();
      } else {
        await this.fetchTools();
      }

      this.toolCallCount = 0; // Reset the counter after refresh
      this.log(
        `Tools refreshed successfully. ${
          Object.keys(this.toolsMap).length
        } tools available.`,
        true
      );
    } catch (error: any) {
      this.logError(`Failed to refresh tools: ${error.message}`);
      throw error;
    }
  }

  /**
   * Log the environment status to the console
   */
  protected logEnvironmentStatus(): void {
    this.log("=== Environment Status ===", true);
    Object.values(this.environmentChecks).forEach((check) => {
      if (check.valid) {
        this.log(
          `✅ ${check.scriptType}: Available (using ${check.executor})`,
          true
        );
      } else {
        this.log(
          `❌ ${check.scriptType}: Not available - ${check.error}`,
          true
        );
      }
    });
    this.log("========================", true);
  }

  /**
   * Check if auto-refresh is needed and perform if necessary
   * @protected
   */
  protected async checkAutoRefresh(): Promise<void> {
    this.toolCallCount++;

    if (
      this.autoRefreshCount > 0 &&
      this.toolCallCount >= this.autoRefreshCount
    ) {
      this.log(
        `Auto-refreshing tools after ${this.toolCallCount} tool calls`,
        true
      );
      await this.refreshTools();
    }
  }

  /**
   * Ensures the adapter is initialized
   * @protected
   */
  protected async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Sets environment variables for tool execution
   * @param variables - Object containing environment variables to set
   */
  public setEnvironmentVariables(variables: Record<string, string>): void {
    this.environmentVariables = variables;
    this.log(
      `Set ${
        Object.keys(variables).length
      } environment variables for tool execution`
    );
  }

  /**
   * Adds an environment variable for tool execution
   * @param name - Name of the environment variable
   * @param value - Value of the environment variable
   */
  public addEnvironmentVariable(name: string, value: string): void {
    this.environmentVariables[name] = value;
    this.log(`Added environment variable: ${name}`);
  }

  /**
   * Gets specific tools by their names from local folder
   * @param toolNames - Array of tool names or objects with name and version
   * @returns Map of requested tools
   */
  protected async getLocalToolsByNames(
    toolNames: ToolNameParam[]
  ): Promise<ToolsMap> {
    try {
      if (!this.folderPath) {
        throw new Error("Folder path is not set");
      }

      this.log(`Loading ${toolNames.length} specific tools from folder...`);

      // Load tools.json file
      const toolsFilePath = path.join(this.folderPath, "tools.json");
      if (!fs.existsSync(toolsFilePath)) {
        throw new Error(`tools.json file not found in ${this.folderPath}`);
      }

      const toolsData = JSON.parse(fs.readFileSync(toolsFilePath, "utf8"));

      const result: ToolsMap = {};

      // Process each requested tool
      for (const nameParam of toolNames) {
        const toolName =
          typeof nameParam === "string" ? nameParam : nameParam.name;
        const versionName =
          typeof nameParam === "string" ? undefined : nameParam.version;

        // Find the tool in the tools data
        const toolData = toolsData.find(
          (t: any) => t.name.toLowerCase() === toolName.toLowerCase()
        );

        if (!toolData) {
          this.logError(`Tool not found: ${toolName}`);
          continue;
        }

        // Get the versions dictionary
        const versions = toolData.versions || {};

        // Check if versions is a dictionary
        if (typeof versions !== "object" || versions === null) {
          this.logError(`Versions for tool ${toolName} is not a dictionary`);
          continue;
        }

        // If version is specified, use that version, otherwise use production version
        let targetVersion;
        let targetVersionName;

        if (versionName) {
          if (!versions[versionName]) {
            this.logError(
              `Version ${versionName} not found for tool ${toolName}`
            );
            continue;
          }
          targetVersion = versions[versionName];
          targetVersionName = versionName;
        } else {
          // Use production version
          const productionVersionName = toolData.production_version_name || "";
          if (!productionVersionName || !versions[productionVersionName]) {
            this.logError(`Production version not found for tool ${toolName}`);
            continue;
          }

          targetVersion = versions[productionVersionName];
          targetVersionName = productionVersionName;
        }

        // Create script path
        const scriptExtension =
          targetVersion.script_type === "python" ? ".py" : ".sh";
        const scriptFilename = `${toolName}-${targetVersionName}${scriptExtension}`;
        const scriptPath = path.join(this.folderPath, scriptFilename);

        if (!fs.existsSync(scriptPath)) {
          this.logError(`Script file not found: ${scriptPath}`);
          continue;
        }

        // Create the tool object without loading script content
        result[toolName.toLowerCase()] = {
          id: toolData.id || "",
          name: toolData.name,
          description: targetVersion.description || "",
          input_schema: targetVersion.input_schema || {},
          script: "", // Empty script content
          script_type: targetVersion.script_type || "bash",
          version_name: targetVersionName,
          script_path: scriptPath, // Store the path instead
        };

        this.log(
          `Loaded tool reference: ${toolName} (version: ${targetVersionName})`
        );
      }

      return result;
    } catch (error: any) {
      this.logError(
        `Failed to load specific tools from folder: ${error.message}`
      );

      // Fall back to cached tools if loading fails
      this.log("Falling back to cached tools", true);
      const result: ToolsMap = {};
      for (const nameParam of toolNames) {
        const toolName =
          typeof nameParam === "string" ? nameParam : nameParam.name;
        const toolNameLower = toolName.toLowerCase();

        if (this.toolsMap[toolNameLower]) {
          result[toolNameLower] = this.toolsMap[toolNameLower];
          this.log(`Using cached tool: ${this.toolsMap[toolNameLower].name}`);
        }
      }

      return result;
    }
  }

  /**
   * Gets specific tools from API by their names
   * @param toolNames - Array of tool names or objects with name and version
   * @returns Map of requested tools
   */
  protected async getApiToolsByNames(
    toolNames: ToolNameParam[]
  ): Promise<ToolsMap> {
    try {
      this.log(`Fetching ${toolNames.length} specific tools from API...`);

      // Format tool names for the API request
      const toolsRequest = toolNames.map((nameParam) => {
        if (typeof nameParam === "string") {
          return { name: nameParam };
        } else {
          return {
            name: nameParam.name,
            version: nameParam.version,
          };
        }
      });

      // Call the API endpoint with all tool names in a single request
      const response = await fetch(`${this.apiUrl}/api/get-individual-tools`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey || "",
        },
        body: JSON.stringify({ tools: toolsRequest }),
      });

      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }

      const result = await response.json();

      if (!result.tools || !Array.isArray(result.tools)) {
        throw new Error("Invalid response format from API");
      }

      // Convert array to map with name as key (case insensitive)
      const toolsMap: ToolsMap = {};
      for (const tool of result.tools) {
        const version = tool.version || {};
        toolsMap[tool.name.toLowerCase()] = {
          id: tool.id || "",
          name: tool.name,
          description: version.description || "",
          input_schema: version.input_schema || {},
          script: version.script || "",
          script_type: version.script_type || "bash",
          version_name: version.version_name || "",
        };
        this.log(
          `Tool fetched: ${tool.name} (version: ${
            version.version_name || "latest"
          })`
        );
      }

      return toolsMap;
    } catch (error: any) {
      this.logError(`Failed to fetch individual tools: ${error.message}`);

      // Fall back to cached tools if API request fails
      this.log("Falling back to cached tools", true);
      const result: ToolsMap = {};
      for (const nameParam of toolNames) {
        const toolName =
          typeof nameParam === "string"
            ? nameParam.toLowerCase()
            : nameParam.name.toLowerCase();

        if (this.toolsMap[toolName]) {
          result[toolName] = this.toolsMap[toolName];
          this.log(`Using cached tool: ${this.toolsMap[toolName].name}`);
        }
      }

      return result;
    }
  }

  /**
   * Gets specific tools by their names
   * @param toolNames - Array of tool names or objects with name and version
   * @returns Map of requested tools
   */
  public async getToolsByNames(
    toolNames: ToolNameParam[] = []
  ): Promise<ToolsMap> {
    await this.ensureInitialized();

    // If no specific tools requested, return all tools
    if (toolNames.length === 0) {
      return { ...this.toolsMap };
    }

    // If we're using local mode, we need to handle the tool loading differently
    if (this.localMode) {
      return this.getLocalToolsByNames(toolNames);
    } else {
      return this.getApiToolsByNames(toolNames);
    }
  }

  /**
   * Creates an executor function for a tool
   * @param tool - Tool object
   * @returns Tool execution function
   * @protected
   */
  protected createToolExecutor(
    tool: Tool
  ): (args: Record<string, any>) => Promise<ToolExecutionResult> {
    return async (args: Record<string, any>): Promise<ToolExecutionResult> => {
      try {
        // Increment call count and check if refresh needed
        await this.checkAutoRefresh();

        this.log(`Executing tool: ${tool.name}`);
        if (this.verbose) {
          this.log(`Tool inputs: ${JSON.stringify(args)}`);
        }

        // Execute based on script type
        if (tool.script_type === "python") {
          return this.executePythonTool(tool, args);
        } else if (tool.script_type === "bash") {
          return this.executeBashTool(tool, args);
        } else {
          return { error: `Unsupported script type: ${tool.script_type}` };
        }
      } catch (error: any) {
        const errorMsg = `Error executing tool ${tool.name}: ${error.message}`;
        this.logError(errorMsg);
        return { error: errorMsg };
      }
    };
  }

  /**
   * Execute Python tool
   * @param tool - Tool object
   * @param args - Arguments for the tool
   * @returns Tool execution result
   */
  protected async executePythonTool(
    tool: Tool,
    args: Record<string, any>
  ): Promise<ToolExecutionResult> {
    try {
      // Get environment check result
      const envCheck = await this.checkEnvironment("python");
      if (!envCheck.valid) {
        const errorMsg = `Environment error: ${envCheck.error}`;
        this.logError(errorMsg);
        return { output: errorMsg };
      }

      // Add environment to args
      const enrichedArgs = {
        ...args,
        openv: this.environmentVariables,
      };

      // Check if we have script content or script path
      let scriptContent: string;
      let useScriptPath = false;

      if (tool.script_path && fs.existsSync(tool.script_path)) {
        // Use script path directly
        scriptContent = tool.script_path;
        useScriptPath = true;
        this.log(`Executing Python script from: ${tool.script_path}`);
      } else if (tool.script) {
        // Use inline script content
        scriptContent = tool.script;
      } else if (tool.script_path) {
        // Load from script path
        this.log(`Loading Python script from: ${tool.script_path}`);
        scriptContent = fs.readFileSync(tool.script_path, "utf8");
      } else {
        throw new Error("No script content or valid script path provided");
      }

      // Prepare command and args based on execution method
      const command = envCheck.executor; // python or python3
      let pythonArgs: string[];

      // Convert args to JSON string for passing as command-line argument
      const jsonArgsString = JSON.stringify(enrichedArgs);

      if (useScriptPath) {
        // Execute the script file directly with args as command-line arguments
        pythonArgs = [scriptContent, jsonArgsString];
      } else {
        // Execute the script content directly with -c and args as command-line arguments
        pythonArgs = ["-c", scriptContent, jsonArgsString];
      }

      // Create a child process with environment variables
      const child = spawn(command, pythonArgs);

      // Collect stdout and stderr
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      // Wait for the process to complete
      return new Promise<ToolExecutionResult>((resolve) => {
        child.on("close", (code) => {
          // Combine stdout and stderr
          let result = stdout.trim();

          if (stderr.trim()) {
            if (result) {
              result += "\n\n";
            }
            result += stderr.trim();
          }

          if (code !== 0) {
            const errorMsg = `Python execution failed. ${
              stderr.trim() || `Process exited with code ${code}`
            }`;
            this.logError(`Tool ${tool.name} error: ${errorMsg}`);
          }

          if (this.verbose) {
            if (stderr) {
              this.log(`Tool ${tool.name} stderr: ${stderr}`);
            }
            this.log(`Tool ${tool.name} output: ${stdout}`);
          }

          // Always return in output field, regardless of success or failure
          resolve({ output: result });
        });
      });
    } catch (error: any) {
      const errorMsg = `Error executing Python tool ${tool.name}: ${error.message}`;
      this.logError(errorMsg);
      return { output: errorMsg };
    }
  }

  /**
   * Execute Bash tool
   * @param tool - Tool object
   * @param args - Arguments for the tool
   * @returns Tool execution result
   */
  protected async executeBashTool(
    tool: Tool,
    args: Record<string, any>
  ): Promise<ToolExecutionResult> {
    try {
      // Get environment check result
      const envCheck = await this.checkEnvironment("bash");
      if (!envCheck.valid) {
        const errorMsg = `Environment error: ${envCheck.error}`;
        this.logError(errorMsg);
        return { output: errorMsg };
      }

      // Prepare environment
      const env = { ...this.environmentVariables };

      // Add environment to args
      const enrichedArgs = {
        ...args,
        openv: env,
      };

      let scriptToExecute: string;

      if (tool.script_path && fs.existsSync(tool.script_path)) {
        // Use script path directly
        scriptToExecute = tool.script_path;
        this.log(`Executing bash script from: ${tool.script_path}`);
      } else {
        // Execute the script content directly using bash -c
        scriptToExecute = tool.script;
      }

      // Create a child process - for script_path we use the file, otherwise pass script directly to bash -c
      const bashArgs = tool.script_path
        ? [scriptToExecute]
        : ["-c", scriptToExecute];
      const child = spawn("bash", bashArgs);

      // Send JSON input to the script
      const jsonArgs = JSON.stringify(enrichedArgs);
      child.stdin.write(jsonArgs);
      child.stdin.end();

      // Collect stdout and stderr
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      // Wait for the process to complete
      return new Promise<ToolExecutionResult>((resolve) => {
        child.on("close", (code) => {
          // Combine stdout and stderr
          let result = stdout.trim();

          if (stderr.trim()) {
            if (result) {
              result += "\n\n";
            }
            result += stderr.trim();
          }

          if (code !== 0) {
            const errorMsg = `Bash execution failed. ${
              stderr.trim() || `Process exited with code ${code}`
            }`;
            this.logError(`Tool ${tool.name} error: ${errorMsg}`);
          }

          if (this.verbose) {
            if (stderr) {
              this.log(`Tool ${tool.name} stderr: ${stderr}`);
            }
            this.log(`Tool ${tool.name} output: ${stdout}`);
          }

          // Always return in output field, regardless of success or failure
          resolve({ output: result });
        });
      });
    } catch (error: any) {
      const errorMsg = `Error executing Bash tool ${tool.name}: ${error.message}`;
      this.logError(errorMsg);
      return { output: errorMsg };
    }
  }

  /**
   * Get the current environment status
   * @returns Current environment check results
   */
  public getEnvironmentStatus(): Record<string, EnvironmentCheck> {
    return { ...this.environmentChecks };
  }

  /**
   * Get information about tool call counts and auto-refresh settings
   */
  public getToolCallStatus(): {
    callCount: number;
    autoRefreshCount: number;
    nextRefreshIn: number;
  } {
    return {
      callCount: this.toolCallCount,
      autoRefreshCount: this.autoRefreshCount,
      nextRefreshIn:
        this.autoRefreshCount > 0
          ? Math.max(0, this.autoRefreshCount - this.toolCallCount)
          : -1, // -1 indicates auto-refresh is disabled
    };
  }

  /**
   * Set the auto-refresh count
   * @param count - Number of tool calls before auto-refresh (0 to disable)
   */
  public setAutoRefreshCount(count: number): void {
    if (count < 0) {
      throw new Error("Auto-refresh count must be a non-negative number");
    }
    this.autoRefreshCount = count;
    this.log(
      count === 0
        ? "Tool auto-refresh disabled"
        : `Tool auto-refresh set to occur every ${count} tool calls`,
      true
    );
  }

  /**
   * Toggle verbose logging
   * @param enabled - Whether to enable verbose logging
   */
  public setVerbose(enabled: boolean): void {
    this.verbose = enabled;
    this.log(`Verbose logging ${enabled ? "enabled" : "disabled"}`, true);
  }
}
