#!/usr/bin/env node

import "dotenv/config";
import { createServer } from "node:http";
import { WebStandardStreamableHTTPServerTransport, McpServer } from "@modelcontextprotocol/server";
import { registerTools } from "./tools.js";
import { authenticate } from "./middleware.js";
import { handleWellKnown, handleOptionsRequest } from "./well-known.js";
import { toWebRequest, sendWebResponse, jsonResponse, peekJsonRpc, pickRequiredScopes } from "./http-adapter.js";

/** When false (default), use stateless HTTP transport so duplicate initialize is not rejected (MCPJam + auth bypass). Set MCP_USE_SESSION=true for session IDs. */
const useSessionTransport = process.env.MCP_USE_SESSION === "true";

async function logIfMcpErrorResponse(response: Response, context: string): Promise<void> {
  if (response.status < 400) return;
  try {
    const text = (await response.clone().text()).slice(0, 800);
    console.warn(`[mcp] ${context} HTTP ${response.status}: ${text}`);
  } catch {
    console.warn(`[mcp] ${context} HTTP ${response.status} (body unreadable)`);
  }
}

async function main() {
  // Initialize MCP server
  const mcp = new McpServer({
    name: "sandbox-server",
    version: "1.0.0",
    description: "A sandbox MCP server with OAuth authentication"
  });

  // Register all tools, resources, and prompts
  await registerTools(mcp);

  // Stateless: no mcp-session-id; SDK allows another initialize (needed for MCPJam OAuth steps with DANGEROUSLY_OMIT_AUTH).
  // Stateful: set MCP_USE_SESSION=true if you need session affinity.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: useSessionTransport ? () => crypto.randomUUID() : undefined,
    onsessioninitialized: useSessionTransport
      ? (sessionId) => { console.log(`📝 Session initialized: ${sessionId}`); }
      : undefined,
    onsessionclosed: useSessionTransport
      ? (sessionId) => { console.log(`🗑️ Session closed: ${sessionId}`); }
      : undefined,
  });

  // Connect MCP server to transport
  await mcp.connect(transport);
  console.log("✅ MCP server connected to HTTP transport");

  // Create HTTP server
  const server = createServer(async (req, res) => {
    try {
      console.log(`[http] raw ${req.method ?? "?"} ${req.url?.split("?")[0] ?? ""}`);
      const webReq = await toWebRequest(req);
      const url = new URL(webReq.url);

      console.log(`[http] web ${webReq.method} ${url.pathname}`);

      // Handle CORS preflight requests
      if (webReq.method === 'OPTIONS') {
        return sendWebResponse(res, handleOptionsRequest());
      }

      // Handle well-known OAuth protected resource metadata
      if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
        return sendWebResponse(res, handleWellKnown(webReq));
      }

      // Handle MCP endpoints
      if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
        try {
          // Peek at JSON-RPC to determine required scopes
          const { parsedBody } = await peekJsonRpc(webReq);
          const requiredScopes = pickRequiredScopes(parsedBody);

          console.log(`🔍 Method: ${parsedBody?.method}, Required scopes: [${requiredScopes.join(', ')}]`);

          // Authenticate request
          const authOutcome = await authenticate(webReq, requiredScopes);

          if (!authOutcome.ok) {
            console.log(`🚫 Authentication failed: ${authOutcome.status} ${(authOutcome.body as any).error}`);
            return sendWebResponse(res,
              new Response(JSON.stringify(authOutcome.body), {
                status: authOutcome.status,
                headers: {
                  'Content-Type': 'application/json',
                  'WWW-Authenticate': authOutcome.wwwAuthenticate
                }
              })
            );
          }

          console.log(`✅ Authenticated: ${authOutcome.authInfo.clientId} [${authOutcome.authInfo.scopes.join(', ')}]`);

          // Forward to MCP transport with auth info
          const mcpResponse = await transport.handleRequest(webReq, {
            authInfo: authOutcome.authInfo,
            parsedBody: parsedBody
          });
          await logIfMcpErrorResponse(mcpResponse, `${parsedBody?.method ?? "?"}`);

          return sendWebResponse(res, mcpResponse);
        } catch (mcpError) {
          console.error("🔥 MCP processing error:", mcpError);
          return sendWebResponse(res, jsonResponse(
            { error: "mcp_error", error_description: "Failed to process MCP request" },
            500
          ));
        }
      }

      // Handle documentation endpoint (simple placeholder)
      if (url.pathname === '/docs') {
        const docs = {
          title: "MCP Sandbox Server API",
          description: "OAuth-protected Model Context Protocol server",
          version: "1.0.0",
          oauth: {
            authorization_server: `https://${process.env.AUTH0_DOMAIN}/`,
            resource_metadata: `${process.env.MCP_RESOURCE_URI?.replace('/mcp', '')}/.well-known/oauth-protected-resource/mcp`
          },
          endpoints: {
            mcp: "/mcp",
            metadata: "/.well-known/oauth-protected-resource/mcp"
          }
        };
        return sendWebResponse(res, jsonResponse(docs));
      }

      // 404 for all other paths
      return sendWebResponse(res, jsonResponse(
        { error: "not_found", error_description: "Endpoint not found" },
        404
      ));

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      console.error("[http] unhandled outer error:", message);
      if (stack) console.error(stack);
      return sendWebResponse(res, jsonResponse(
        { error: "internal_server_error", error_description: message },
        500
      ));
    }
  });

  const port = parseInt(process.env.MCP_PORT || '3000', 10);

  server.listen(port, 'localhost', () => {
    console.log(`🚀 MCP OAuth server running on http://localhost:${port}`);
    console.log(`📋 Resource metadata: http://localhost:${port}/.well-known/oauth-protected-resource/mcp`);
    console.log(`🔧 MCP endpoint: http://localhost:${port}/mcp`);
    console.log(`📚 Documentation: http://localhost:${port}/docs`);

    if (process.env.DANGEROUSLY_OMIT_AUTH === 'true') {
      console.log("⚠️ WARNING: Authentication bypass enabled (DANGEROUSLY_OMIT_AUTH=true)");
      console.log("   MCPJam OAuth \"request_without_token\" expects HTTP 401 — use bypass off for that step, or stateless transport (default) avoids duplicate-initialize 400.");
    }
    console.log(
      useSessionTransport
        ? "📎 MCP HTTP transport: stateful (MCP_USE_SESSION=true)"
        : "📎 MCP HTTP transport: stateless (set MCP_USE_SESSION=true for sessions)"
    );
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down server...');
    server.close(() => {
      console.log('✅ Server closed');
      process.exit(0);
    });
  });
}

// Start the server
main().catch((error) => {
  console.error('💥 Failed to start server:', error);
  process.exit(1);
});
