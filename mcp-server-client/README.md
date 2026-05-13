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
