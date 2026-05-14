import {
  McpServer,
  ResourceTemplate,
  StdioServerTransport,
} from "@modelcontextprotocol/server";

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { validateToken, setAuthState, getAuthState, isAuthenticated, isAuthBypassEnabled } from "./auth.js";
import { randomBytes } from "crypto";

// Generate session ID for auth state
const sessionId = randomBytes(16).toString('hex');

const server = new McpServer({
  name: "sandbox-server",
  version: "1.0.0",
  description: "A sandbox MCP server for the client",
});

const usersFilePath = "C:/Development/__Ai_Squad/AI-sandbox/mcp-server-client/src/data/users.json";

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
  },
);

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
  },
);

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
  }),
);

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
  async (params) => {
    try {
      const id = await createUser(params);
      return {
        content: [
          { type: "text", text: `User ${id} created successfully` },
        ],
      };
    } catch {
      return {
        content: [{ type: "text", text: "Failed to save user" }],
      };
    }
  },
);

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
    const result = await (server.server as any).request({
      method: "sampling/createMessage",
      params: {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: "Gene  rate fake user data. The user should have a realistic name, email, address, and phone number. " +
                + "Return this data as a JSON object with no other text or formatter so it can be used with JSON.parse.",
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

    try {
      const userData = JSON.parse(
        result.content.text
          .trim()
          .replace(/^```json/, "")
          .replace(/```$/, "")
          .trim(),
      );

      const id = await createUser(userData);

      return {
        content: [
          { type: "text", text: `User ${id} created successfully` },
        ],
      };
    } catch {
      return {
        content: [{ type: "text", text: "Failed to generate user data" }],
      };
    }
  }
);

server.registerTool(
  "mcp_auth", 
  {
    title: "MCP Authentication",
    description: "Authenticate using Auth0 JWT token",
    inputSchema: z.object({
      token: z.string().describe("JWT token from Auth0"),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    // Check auth bypass
    if (isAuthBypassEnabled()) {
      setAuthState(sessionId, {
        authenticated: true,
        user: { sub: "bypass-user", email: "bypass@test.com" },
        authenticatedAt: new Date(),
      });
      return {
        content: [
          { type: "text", text: "Authentication bypassed (DANGEROUSLY_OMIT_AUTH=true)" },
        ],
      };
    }

    // Validate token
    const result = await validateToken(params.token);
    
    if (!result.valid) {
      return {
        content: [
          { type: "text", text: `Authentication failed: ${result.error}` },
        ],
      };
    }

    // Set auth state
    setAuthState(sessionId, {
      authenticated: true,
      user: {
        sub: result.payload!.sub,
        email: result.payload!.email,
      },
      authenticatedAt: new Date(),
    });

    return {
      content: [
        { 
          type: "text", 
          text: `Authentication successful. User: ${result.payload!.sub}${result.payload!.email ? ` (${result.payload!.email})` : ''}` 
        },
      ],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main()
  .catch(console.error);

async function loadUsers(): Promise<StoredUser[]> {
  const raw = await readFile(usersFilePath, "utf8");

  return JSON.parse(raw) as StoredUser[];
}

async function createUser(user: NewUser): Promise<number> {
  const users = await loadUsers();

  const id = users.length === 0 ? 1 : Math.max(...users.map((u) => u.id)) + 1;

  users.push({ id, ...user });

  await writeFile(
    usersFilePath,
    `${JSON.stringify(users, null, 2)}\n`,
    "utf8",
  );

  return id;
}

type NewUser = {
  name: string;
  email: string;
  address: string;
  phone: string;
};

type StoredUser = { id: number } & NewUser;
