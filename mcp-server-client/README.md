# MCP Server-Client Demo

This project demonstrates the Model Context Protocol (MCP) with:
- **Server**: Exposes user data via tools, resources, and prompts
- **Interactive Client**: Connects to server with AI integration (Gemini)

## Setup

1. **Environment**: Create `.env` with your Gemini API key
```bash
GEMINI_API_KEY=your_api_key_here
```

2. **Install dependencies**:
```bash
npm install
```

3. **Build**:
```bash
npm run server:build
```

## Running

### Start the Interactive Client
```bash
npm run client:dev
```

The client will:
1. Connect to the MCP server (spawned automatically)
2. Discover available capabilities (tools, resources, prompts)
3. Present an interactive menu

### Available Features

#### 🤖 Query (AI + Tools)
- Ask natural language questions
- Gemini AI can automatically use server tools to answer
- Example: "Show me all users" → AI uses `list-users` tool

#### 🔧 Use Tool
- Manually execute server tools
- `create-user`: Add new users
- `list-users`: Get all users  
- `get-user`: Get specific user by ID

#### 📄 Read Resource  
- Access server resources
- `users` resource: Raw JSON user data
- `user-details/{userId}/profile`: Individual user profiles

#### 📝 Use Prompt
- Execute server-provided prompts with AI
- Server can provide templated prompts for common tasks

## MCP Architecture

### Core Principles

1. **Protocol Abstraction**: MCP standardizes how clients communicate with servers
2. **Capability Discovery**: Clients dynamically discover what servers can do
3. **Bidirectional**: Servers can also request services from clients (sampling)
4. **Transport Agnostic**: Works over stdio, HTTP, WebSockets, etc.

### Key Components

- **Tools**: Functions the server exposes (like API endpoints)
- **Resources**: Data the server provides (like database views)
- **Prompts**: Templates for AI interactions the server offers
- **Sampling**: Server can request AI completions from client

### Data Flow

```
[AI Client] ←→ [MCP Transport] ←→ [MCP Server] ←→ [Data/APIs]
```

1. Client connects via transport (stdio in this case)
2. Handshake negotiates protocol version and capabilities  
3. Client discovers server's tools/resources/prompts
4. Client can invoke tools, read resources, execute prompts
5. Server can request AI sampling from client

This enables AI agents to safely and standardized access external data and services through MCP servers.

## OAuth Authentication (RFC 9728 Compliance)

The server now implements the official MCP authorization specification with Auth0 OAuth 2.1 + PKCE:

### Environment Configuration

Update your `.env` file with both Auth0 and MCP server settings:

```bash
# Gemini API
GEMINI_API_KEY=your_api_key_here

# Auth0 Configuration (existing)
AUTH0_DOMAIN=dev-d4nr3bbnmvrwmcqn.us.auth0.com
AUTH0_CLIENT_ID=XpdCtxqPRvJQOo6cpH8kGad1xe1cmhPp
AUTH0_CLIENT_SECRET=sury7KDxV3oJ9VXqvJdJauo3BMMK08kz-h-wgtxhgVXR-RXxTPYySDmznwNtD15M
AUTH0_AUDIENCE=https://mcp-server-api

# MCP Server Configuration (new)
MCP_PORT=3000
MCP_RESOURCE_URI=http://localhost:3000/mcp
MCP_REQUIRED_SCOPES=mcp:read mcp:write
# Optional for testing - add a valid Auth0 JWT here
# MCP_TEST_ACCESS_TOKEN=eyJhbGc...

# Optional auth bypass for testing
DANGEROUSLY_OMIT_AUTH=false
```

### Server Architecture

The server now uses **Streamable HTTP transport** instead of STDIO:

- **HTTP Endpoint**: `http://localhost:3000/mcp`
- **OAuth Metadata**: `http://localhost:3000/.well-known/oauth-protected-resource/mcp`
- **Documentation**: `http://localhost:3000/docs`

### Authentication Flow

1. **Resource Discovery**: Clients fetch OAuth metadata from `/.well-known/oauth-protected-resource/mcp`
2. **Authorization Server**: Points to Auth0 at `https://{AUTH0_DOMAIN}/`
3. **Token Validation**: JWT tokens validated against Auth0 JWKS with audience/issuer checks
4. **Scope-based Access**: Tools require `mcp:write`, resources are `mcp:read`

### Protected vs Public Operations

**Protected (require authentication + scopes):**
- `create-user` tool → requires `mcp:write` scope
- `create-random-user` tool → requires `mcp:write` scope

**Public (after authentication, no additional scopes):**
- `users` resource
- `user-details` resource templates  
- `generate-fake-user` prompt
- `tools/list`, `resources/list`, etc.

### Testing with curl

```bash
# 1. Check OAuth metadata
curl -v http://localhost:3000/.well-known/oauth-protected-resource/mcp

# 2. Try unauthenticated request (should return 401 with WWW-Authenticate header)
curl -v http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# 3. With valid Auth0 JWT token
curl -v http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_AUTH0_JWT_HERE" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# 4. Test protected tool (requires mcp:write scope)
curl -v http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_AUTH0_JWT_HERE" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"create-user","arguments":{"name":"Test User","email":"test@example.com","address":"123 Main St","phone":"555-1234"}},"id":2}'
```

### MCP Client Usage

The client now connects over HTTP:

```bash
# Start server
npm run server:dev

# In another terminal, run client (requires MCP_TEST_ACCESS_TOKEN in .env)
npm run client:dev

# Or bypass auth for testing
npm run server:inspect
```

### MCPJam: “Pre-registered client ID is required”

Auth0 often returns **`dynamic client registration is disabled`** for `POST …/oidc/register`, so MCPJam cannot register a client automatically. Use a **pre-registered** Auth0 application and paste its **Client ID** into MCPJam’s server OAuth settings.

1. **Auth0 Dashboard** → *Applications* → *Create Application* → **Native** or **Single Page Application** (typical for PKCE / public clients).
2. **Allowed Callback URLs** — add the redirect MCPJam uses (see its OAuth logs), usually:
   - `http://127.0.0.1:6274/oauth/callback`
   - Optionally `http://localhost:6274/oauth/callback`
3. **APIs** — open the API whose identifier matches **`AUTH0_AUDIENCE`** (e.g. `https://mcp-server-api`). Add permissions or scopes aligned with **`MCP_REQUIRED_SCOPES`** (e.g. `mcp:read`, `mcp:write`), then authorize this application for that API so tokens include the correct **audience**.
4. **MCPJam** → server *Settings* / *OAuth*: **Client ID** (can match `AUTH0_CLIENT_ID` in `.env` if you use that app), **Issuer** `https://<your-tenant>.us.auth0.com/`, **Audience** = API identifier if the UI asks.

Reusing the existing `.env` client only works if that application’s **type** and **callback URLs** match MCPJam; otherwise create a dedicated app for the Inspector.

### Cursor IDE (`.cursor/mcp.json`)

The project uses a **remote** MCP entry with **static OAuth** (see [Cursor MCP: static OAuth](https://cursor.com/docs/context/mcp)) so Cursor does not depend on Auth0 DCR.

- **Client ID** is interpolated from the **`AUTH0_CLIENT_ID`** environment variable. Set that in your **OS/user** environment before starting Cursor (remote entries do not load `.env` automatically).
- On the **same** Auth0 application, add Cursor’s redirect: **`cursor://anysphere.cursor-mcp/oauth/callback`**
- For a **confidential** Auth0 app only, add `"CLIENT_SECRET": "${env:AUTH0_CLIENT_SECRET}"` to the `auth` object in `.cursor/mcp.json`.

Run `npm run server:dev`, then enable the **sandbox-server** MCP in Cursor.

### Compliance Notes

- Implements **RFC 9728** (Protected Resource Metadata) for server discovery
- Follows **OAuth 2.1** + **PKCE** security requirements  
- Returns spec-compliant `WWW-Authenticate` challenges on 401/403
- Supports **scope-based authorization** with `insufficient_scope` errors
- Compatible with MCP Inspector and other compliant clients
