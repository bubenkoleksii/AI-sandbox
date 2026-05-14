import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";

// Resolve users file path relative to the build directory
const usersFilePath = path.resolve(import.meta.dirname || __dirname, "../data/users.json");

/**
 * Register all MCP server capabilities (tools, resources, prompts)
 */
export async function registerTools(server: McpServer): Promise<void> {
  // Register resources
  registerResources(server);
  
  // Register prompts
  registerPrompts(server);
  
  // Register tools
  registerMcpTools(server);
}

/**
 * Register MCP resources
 */
function registerResources(server: McpServer): void {
  // Users resource - raw JSON data
  server.registerResource(
    "users",
    "sandbox://users",
    {
      title: "Users",
      description: "Get all users data from the database",
      mimeType: "application/json",
    },
    async (uri) => {
      const raw = await readFile(usersFilePath, "utf8");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: raw,
          },
        ],
      };
    }
  );

  // User details resource template - individual user profiles
  server.registerResource(
    "user-details",
    new ResourceTemplate("users://{userId}/profile", {
      list: async () => {
        const users = await loadUsers();
        return {
          resources: users.map((u) => ({
            uri: `users://${u.id}/profile`,
            name: `user-profile-${u.id}`,
            title: u.name,
            description: "Get a user's details from the database",
            mimeType: "application/json",
          })),
        };
      },
    }),
    {
      title: "User details",
      description: "Get a user's details from the database",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const rawUserId = variables.userId;
      const userIdStr = Array.isArray(rawUserId) ? rawUserId[0] : rawUserId;

      if (userIdStr === undefined || userIdStr === "") {
        throw new Error("Missing userId in resource URI");
      }

      const id = Number(userIdStr);
      if (!Number.isInteger(id)) {
        throw new Error(`Invalid user id: ${userIdStr}`);
      }

      const users = await loadUsers();
      const user = users.find((u) => u.id === id);

      if (!user) {
        throw new Error(`User not found: ${id}`);
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: `${JSON.stringify(user, null, 2)}\n`,
          },
        ],
      };
    }
  );
}

/**
 * Register MCP prompts
 */
function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "generate-fake-user",
    {
      title: "Generate fake user",
      description: "Generate a fake user based on a given name",
      argsSchema: z.object({
        name: z.string(),
      }),
    },
    ({ name }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Generate a fake user with the name ${name}. The user should have a realistic email, address, and phone number.`,
          },
        },
      ],
    })
  );
}

/**
 * Register MCP tools
 */
function registerMcpTools(server: McpServer): void {
  // Create user tool - requires authentication and mcp:write scope
  server.registerTool(
    "create-user",
    {
      title: "Create User",
      description: "Create a new user in the database",
      inputSchema: z.object({
        name: z.string(),
        email: z.string(),
        address: z.string(),
        phone: z.string(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: { name: string; email: string; address: string; phone: string }) => {
      // Authentication is handled at the HTTP layer - no need to access extra here
      
      try {
        const id = await createUser(params);
        
        console.log(`👤 User ${id} created successfully`);
        
        return {
          content: [
            { type: "text", text: `User ${id} created successfully` },
          ],
        };
      } catch (error) {
        console.error('Failed to create user:', error);
        return {
          content: [{ type: "text", text: "Failed to save user" }],
        };
      }
    }
  );

  // Create random user tool - requires authentication and mcp:write scope
  server.registerTool(
    "create-random-user",
    {
      title: "Create Random User",
      description: "Create a random user with fake data",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async () => {
      // Authentication is handled at the HTTP layer
      
      try {
        const result = await (server.server as any).request({
          method: "sampling/createMessage",
          params: {
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: "Generate fake user data. The user should have a realistic name, email, address, and phone number. " +
                    "Return this data as a JSON object with no other text or formatting so it can be used with JSON.parse.",
                },
              },
            ],
            maxTokens: 1024,
          },
        });

        if (result.content.type !== "text") {
          return {
            content: [{ type: "text", text: "Failed to generate user data" }],
          };
        }

        const userData = JSON.parse(
          result.content.text
            .trim()
            .replace(/^```json/, "")
            .replace(/```$/, "")
            .trim()
        );

        const id = await createUser(userData);
        
        console.log(`🎲 Random user ${id} created successfully`);

        return {
          content: [
            { type: "text", text: `User ${id} created successfully` },
          ],
        };
      } catch (error) {
        console.error('Failed to create random user:', error);
        return {
          content: [{ type: "text", text: "Failed to generate user data" }],
        };
      }
    }
  );
}

// Helper functions

async function loadUsers(): Promise<StoredUser[]> {
  try {
    const raw = await readFile(usersFilePath, "utf8");
    return JSON.parse(raw) as StoredUser[];
  } catch (error) {
    console.error('Failed to load users:', error);
    return [];
  }
}

async function createUser(user: NewUser): Promise<number> {
  const users = await loadUsers();
  const id = users.length === 0 ? 1 : Math.max(...users.map((u) => u.id)) + 1;
  
  users.push({ id, ...user });
  
  await writeFile(
    usersFilePath,
    `${JSON.stringify(users, null, 2)}\n`,
    "utf8"
  );

  return id;
}

// Type definitions

type NewUser = {
  name: string;
  email: string;
  address: string;
  phone: string;
};

type StoredUser = { id: number } & NewUser;