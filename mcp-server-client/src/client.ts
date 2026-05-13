import "dotenv/config";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, jsonSchema, ToolSet } from "ai";

import { confirm, input, select } from "@inquirer/prompts";

import { Client, StdioClientTransport } from "@modelcontextprotocol/client";
import type { Tool, Prompt, PromptMessage } from "@modelcontextprotocol/client";

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const mcp = new Client(
  {
    name: "interactive-gemini-client",
    version: "1.0.0",
  },
  { capabilities: { sampling: {} } }
);

const transport = new StdioClientTransport({
  command: "node",
  args: ["build/server.js"],
  stderr: "ignore",
});

async function main() {
  console.log("🔌 Connecting to MCP server...");

  await mcp.connect(transport);

  const [{ tools }, { prompts }, { resources }, { resourceTemplates }] =
    await Promise.all([
      mcp.listTools(),
      mcp.listPrompts(),
      mcp.listResources(),
      mcp.listResourceTemplates(),
    ]);

  console.log("✅ Connected! Available capabilities:");
  console.log(`  📋 Tools: ${tools.length}`);
  console.log(`  📝 Prompts: ${prompts.length}`);
  console.log(`  📄 Resources: ${resources.length}`);
  console.log(`  🔗 Resource Templates: ${resourceTemplates.length}\n`);

  while (true) {
    const option = await select({
      message: "What would you like to do?",
      choices: [
        { name: "🤖 Query (AI + Tools)", value: "Query" },
        { name: "🔧 Use Tool", value: "Tools" },
        { name: "📄 Read Resource", value: "Resources" },
        { name: "📝 Use Prompt", value: "Prompts" },
        { name: "❌ Exit", value: "Exit" }
      ],
    });

    if (option === "Exit") {
      console.log("👋 Goodbye!");
      break;
    }

    try {
      switch (option) {
        case "Tools":
          await handleToolSelection(tools);
          break;
        case "Resources":
          await handleResourceSelection(resources, resourceTemplates);
          break;
        case "Prompts":
          await handlePromptSelection(prompts);
          break;
        case "Query":
          await handleAIQuery(tools);
          break;
      }
    } catch (error) {
      console.error("❌ Error:", error instanceof Error ? error.message : error);
    }

    console.log("\n" + "─".repeat(50) + "\n");
  }

  await transport.close();
}

async function handleAIQuery(tools: Tool[]) {
  const query = await input({ message: "💭 Enter your query:" });
  console.log("🤖 Processing with Gemini...");

  const toolSet: ToolSet = tools.reduce((obj, tool) => ({
    ...obj,
    [tool.name]: {
      description: tool.description,
      parameters: jsonSchema(tool.inputSchema),
      execute: async (args: Record<string, any>) => {
        console.log(`🔧 Executing tool: ${tool.name}`);
        const result = await mcp.callTool({
          name: tool.name,
          arguments: args,
        });
        return result.content;
      },
    },
  }), {});

  const { text, toolResults } = await generateText({
    model: google("gemini-2.0-flash"),
    prompt: query,
    tools: toolSet,
  });

  console.log("\n📝 Response:");
  if (text) {
    console.log(text);
  }

  if (toolResults && toolResults.length > 0) {
    console.log("\n🔧 Tool Results:");
    for (const result of toolResults) {
      console.log(`${result.toolName}: Tool executed successfully`);
    }
  }
}

async function handleToolSelection(tools: Tool[]) {
  if (tools.length === 0) {
    console.log("No tools available.");
    return;
  }

  const toolName = await select({
    message: "Select a tool:",
    choices: tools.map(tool => ({
      name: `${tool.name} - ${tool.description}`,
      value: tool.name,
    })),
  });

  const tool = tools.find(t => t.name === toolName);
  if (!tool) {
    console.error("Tool not found.");
    return;
  }

  await executeTool(tool);
}

async function executeTool(tool: Tool) {
  console.log(`\n🔧 Using tool: ${tool.name}`);
  console.log(`📝 Description: ${tool.description}`);

  const args: Record<string, any> = {};

  const properties = tool.inputSchema.properties ?? {};
  for (const [key, schema] of Object.entries(properties)) {
    const schemaObj = schema as any;
    const prompt = `Enter ${key} (${schemaObj.type || 'string'})${schemaObj.description ? ': ' + schemaObj.description : ''}`;

    const value = await input({ message: prompt });

    if (schemaObj.type === 'number') {
      args[key] = Number(value);
    } else if (schemaObj.type === 'boolean') {
      args[key] = value.toLowerCase() === 'true';
    } else {
      args[key] = value;
    }
  }

  console.log("⚡ Executing...");

  const result = await mcp.callTool({
    name: tool.name,
    arguments: args,
  });

  console.log("\n✅ Result:");

  if (Array.isArray(result.content)) {
    for (const content of result.content) {
      if (content.type === "text") {
        console.log(content.text);
      } else {
        console.log(JSON.stringify(content, null, 2));
      }
    }
  } else {
    console.log(JSON.stringify(result.content, null, 2));
  }
}

async function handleResourceSelection(resources: any[], resourceTemplates: any[]) {
  const allChoices = [
    ...resources.map(resource => ({
      name: `📄 ${resource.name} - ${resource.description}`,
      value: { type: 'resource', uri: resource.uri },
    })),
    ...resourceTemplates.map(template => ({
      name: `🔗 ${template.name} - ${template.description}`,
      value: { type: 'template', uri: template.uriTemplate },
    })),
  ];

  if (allChoices.length === 0) {
    console.log("No resources available.");
    return;
  }

  const selection = await select({
    message: "Select a resource:",
    choices: allChoices,
  });

  await readResource(selection.uri);
}

async function readResource(uri: string) {
  let finalUri = uri;

  const paramMatches = uri.match(/{([^}]+)}/g);
  if (paramMatches) {
    console.log("📋 This resource requires parameters:");

    for (const paramMatch of paramMatches) {
      const paramName = paramMatch.slice(1, -1);
      const paramValue = await input({
        message: `Enter value for ${paramName}:`,
      });
      finalUri = finalUri.replace(paramMatch, paramValue);
    }
  }

  console.log("📖 Reading resource...");

  const result = await mcp.readResource({ uri: finalUri });

  console.log("\n📄 Resource Content:");
  for (const content of result.contents) {
    if (content.mimeType === "application/json") {
      try {
        if ('text' in content) {
          const json = JSON.parse(content.text);
          console.log(JSON.stringify(json, null, 2));
        } else {
          console.log("Binary content (blob)");
        }
      } catch {
        if ('text' in content) {
          console.log(content.text);
        }
      }
    } else {
      if ('text' in content) {
        console.log(content.text);
      } else {
        console.log("Binary content (blob)");
      }
    }
  }
}

async function handlePromptSelection(prompts: Prompt[]) {
  if (prompts.length === 0) {
    console.log("No prompts available.");
    return;
  }

  const promptName = await select({
    message: "Select a prompt:",
    choices: prompts.map(prompt => ({
      name: `${prompt.name} - ${prompt.description || 'No description'}`,
      value: prompt.name,
    })),
  });

  const prompt = prompts.find(p => p.name === promptName);
  if (!prompt) {
    console.error("Prompt not found.");
    return;
  }

  await executePrompt(prompt);
}

async function executePrompt(prompt: Prompt) {
  console.log(`\n📝 Using prompt: ${prompt.name}`);

  const args: Record<string, string> = {};

  for (const arg of prompt.arguments ?? []) {
    args[arg.name] = await input({
      message: `Enter ${arg.name}${arg.description ? ': ' + arg.description : ''}:`,
    });
  }

  console.log("📋 Getting prompt...");

  const response = await mcp.getPrompt({
    name: prompt.name,
    arguments: args,
  });

  console.log("\n📝 Prompt Messages:");
  for (const message of response.messages) {
    const text = await handleServerMessagePrompt(message);
    
    if (text) {
      console.log("🤖 AI Response:", text);
    }
  }
}

async function handleServerMessagePrompt(message: PromptMessage): Promise<string | null> {
  if (message.content.type !== "text") {
    console.log("Non-text message content:", message.content);
    return null;
  }

  console.log("📋 Prompt:", message.content.text);

  const shouldRun = await confirm({
    message: "Would you like to send this prompt to Gemini?",
    default: false,
  });

  if (!shouldRun) return null;

  console.log("🤖 Generating response...");

  const { text } = await generateText({
    model: google("gemini-2.0-flash"),
    prompt: message.content.text,
  });

  return text;
}

main().catch(console.error);
