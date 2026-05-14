# MCP OAuth Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Auth0 OAuth authentication to MCP server with `mcp_auth` tool for MCP OAuth Debugger compatibility.

**Architecture:** JWT validation service validates Auth0 tokens, in-memory auth state tracks sessions, protected tool wrapper checks authentication before execution. Simple and investigation-focused.

**Tech Stack:** TypeScript, Auth0 SDK, jsonwebtoken, jwks-client, existing MCP server

---

## File Structure

- **Modify**: `src/server.ts` - Add auth tool, middleware, and protection
- **Create**: `src/auth.ts` - JWT validation and auth state management  
- **Modify**: `.env` - Add auth bypass flag for testing

## Implementation Tasks

### Task 1: Environment Configuration

**Files:**
- Modify: `.env:8`

- [ ] **Step 1: Add auth bypass environment variable**

Add to `.env`:
```bash
# Optional auth bypass for testing (existing auth config above)
DANGEROUSLY_OMIT_AUTH=false
```

- [ ] **Step 2: Commit configuration**

```bash
git add .env
git commit -m "feat: add auth bypass configuration for OAuth testing"
```

### Task 2: Authentication Service

**Files:**
- Create: `src/auth.ts`

- [ ] **Step 1: Create auth service file with imports**

```typescript
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-client';
import { promisify } from 'util';

interface AuthState {
  authenticated: boolean;
  user?: {
    sub: string;
    email?: string;
  };
  authenticatedAt: Date;
}

interface JWTPayload {
  sub: string;
  email?: string;
  aud: string;
  exp: number;
  iat: number;
}

// In-memory auth state for investigation purposes
const authSessions = new Map<string, AuthState>();
```

- [ ] **Step 2: Add JWKS client setup**

```typescript
const client = jwksClient({
  jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`,
  requestHeaders: {},
  timeout: 30000,
  cache: true,
  rateLimit: true,
  jwksRequestsPerMinute: 5,
  jwksRequestsPerMinute: 1,
});

const getKey = promisify(client.getSigningKey);
```

- [ ] **Step 3: Add token validation function**

```typescript
export async function validateToken(token: string): Promise<{ valid: boolean; payload?: JWTPayload; error?: string }> {
  try {
    // Decode header to get kid
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === 'string' || !decoded.header.kid) {
      return { valid: false, error: 'Invalid token format' };
    }

    // Get signing key
    const key = await getKey(decoded.header.kid);
    const signingKey = key.getPublicKey();

    // Verify token
    const payload = jwt.verify(token, signingKey, {
      audience: process.env.AUTH0_AUDIENCE,
      issuer: `https://${process.env.AUTH0_DOMAIN}/`,
      algorithms: ['RS256']
    }) as JWTPayload;

    return { valid: true, payload };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return { valid: false, error: 'Token expired' };
    }
    if (error instanceof jwt.JsonWebTokenError) {
      return { valid: false, error: `Invalid token: ${error.message}` };
    }
    return { valid: false, error: 'Token validation failed' };
  }
}
```

- [ ] **Step 4: Add auth state management functions**

```typescript
export function setAuthState(sessionId: string, state: AuthState): void {
  authSessions.set(sessionId, state);
}

export function getAuthState(sessionId: string): AuthState | undefined {
  return authSessions.get(sessionId);
}

export function isAuthenticated(sessionId: string): boolean {
  const state = getAuthState(sessionId);
  return state?.authenticated === true;
}

export function clearAuthState(sessionId: string): void {
  authSessions.delete(sessionId);
}
```

- [ ] **Step 5: Add auth bypass check**

```typescript
export function isAuthBypassEnabled(): boolean {
  return process.env.DANGEROUSLY_OMIT_AUTH === 'true';
}
```

- [ ] **Step 6: Commit auth service**

```bash
git add src/auth.ts
git commit -m "feat: add JWT validation and auth state management"
```

### Task 3: MCP Auth Tool

**Files:**
- Modify: `src/server.ts:1-10` (add imports)
- Modify: `src/server.ts:151-211` (add after create-random-user tool)

- [ ] **Step 1: Add auth imports to server.ts**

Add to imports section:
```typescript
import { validateToken, setAuthState, getAuthState, isAuthenticated, isAuthBypassEnabled } from "./auth.js";
import { randomBytes } from "crypto";
```

- [ ] **Step 2: Add session ID generation**

Add after existing imports:
```typescript
// Generate session ID for auth state
const sessionId = randomBytes(16).toString('hex');
```

- [ ] **Step 3: Add mcp_auth tool**

Add after the create-random-user tool registration (around line 211):
```typescript
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
```

- [ ] **Step 4: Commit mcp_auth tool**

```bash
git add src/server.ts
git commit -m "feat: add mcp_auth tool for OAuth authentication"
```

### Task 4: Protected Tool Wrapper

**Files:**
- Modify: `src/server.ts:136-150` (modify create-user tool)
- Modify: `src/server.ts:164-210` (modify create-random-user tool)

- [ ] **Step 1: Add auth check function**

Add before the tool registrations (around line 119):
```typescript
function requireAuth(toolName: string) {
  if (isAuthBypassEnabled()) {
    return { authorized: true };
  }
  
  if (!isAuthenticated(sessionId)) {
    return {
      authorized: false,
      error: `Authentication required for ${toolName}. Please call mcp_auth tool first with a valid Auth0 JWT token.`
    };
  }
  
  return { authorized: true };
}
```

- [ ] **Step 2: Protect create-user tool**

Replace the create-user tool implementation (lines 137-149):
```typescript
async (params) => {
  const authCheck = requireAuth("create-user");
  if (!authCheck.authorized) {
    return {
      content: [{ type: "text", text: authCheck.error! }],
    };
  }

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
```

- [ ] **Step 3: Protect create-random-user tool**

Replace the create-random-user tool implementation (lines 165-210):
```typescript
async () => {
  const authCheck = requireAuth("create-random-user");
  if (!authCheck.authorized) {
    return {
      content: [{ type: "text", text: authCheck.error! }],
    };
  }

  const result = await (server.server as any).request({
    method: "sampling/createMessage",
    params: {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Generate fake user data. The user should have a realistic name, email, address, and phone number. " +
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
```

- [ ] **Step 4: Commit protected tools**

```bash
git add src/server.ts
git commit -m "feat: add authentication protection to user creation tools"
```

### Task 5: Load Environment Configuration

**Files:**
- Modify: `src/server.ts:1-10` (add dotenv)

- [ ] **Step 1: Add dotenv import and configuration**

Add to the top of `src/server.ts`:
```typescript
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();
```

- [ ] **Step 2: Commit environment loading**

```bash
git add src/server.ts
git commit -m "feat: load environment variables for OAuth configuration"
```

### Task 6: Testing and Documentation

**Files:**
- Modify: `README.md:86` (add OAuth section)

- [ ] **Step 1: Add OAuth documentation to README**

Add after the existing architecture section:
```markdown

## OAuth Authentication

The server now supports OAuth authentication via Auth0:

### Configuration

Set up your Auth0 credentials in `.env`:
```bash
AUTH0_DOMAIN=your-domain.auth0.com
AUTH0_CLIENT_ID=your-client-id
AUTH0_CLIENT_SECRET=your-client-secret  
AUTH0_AUDIENCE=https://your-api-identifier
DANGEROUSLY_OMIT_AUTH=false  # Set to true to bypass auth for testing
```

### Authentication Flow

1. **Get Auth0 Token**: Obtain a JWT token from your Auth0 application
2. **Call mcp_auth**: Use the `mcp_auth` tool with your token
3. **Access Protected Tools**: `create-user` and `create-random-user` now require authentication

### MCP OAuth Debugger

This server is compatible with the MCP OAuth Debugger:
1. Configure the debugger to point to your server
2. The debugger will automatically use the `mcp_auth` tool
3. Test the full OAuth flow step-by-step

### Protected vs Public

**Protected (require authentication):**
- `create-user` tool
- `create-random-user` tool

**Public (no authentication required):**
- `users` resource
- `user-details` resource templates
- `generate-fake-user` prompt
```

- [ ] **Step 2: Build and test the server**

```bash
npm run server:build
```

Expected: Clean build with no TypeScript errors

- [ ] **Step 3: Test server startup**

```bash
npm run server:dev
```

Expected: Server starts without errors, shows available capabilities

- [ ] **Step 4: Test with MCP Inspector**

```bash
npm run server:inspect
```

Expected: Inspector opens, shows `mcp_auth` tool in available tools

- [ ] **Step 5: Commit documentation and final changes**

```bash
git add README.md
git commit -m "docs: add OAuth authentication documentation and usage guide"
```

---

## Self-Review

**Spec coverage check:**
- ✅ `mcp_auth` tool with Auth0 JWT validation (Task 3)
- ✅ Auth0 integration using existing credentials (Task 2) 
- ✅ Protected tools (create-user, create-random-user) (Task 4)
- ✅ Public resources remain accessible (no changes needed)
- ✅ Optional auth bypass via environment (Task 1, 3)
- ✅ Clear error messages (Task 3, 4)
- ✅ MCP OAuth Debugger compatibility (Task 3 provides required tool)

**Placeholder scan:** No TBDs, TODOs, or vague instructions found.

**Type consistency:** AuthState, JWTPayload, and function signatures consistent throughout.