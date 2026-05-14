import "dotenv/config";

/**
 * RFC 9728 Protected Resource Metadata for MCP OAuth compliance
 */
export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported?: string[];
  bearer_methods_supported?: string[];
  resource_documentation?: string;
}

/**
 * Generate RFC 9728 Protected Resource Metadata document
 */
function generateMetadata(): ProtectedResourceMetadata {
  const resourceUri = process.env.MCP_RESOURCE_URI || "http://localhost:3000/mcp";
  const authDomain = process.env.AUTH0_DOMAIN;
  
  if (!authDomain) {
    throw new Error("AUTH0_DOMAIN environment variable is required");
  }

  const scopesString = process.env.MCP_REQUIRED_SCOPES || "mcp:read mcp:write";
  const scopes = scopesString.split(/\s+/).filter(s => s.length > 0);

  return {
    resource: resourceUri,
    authorization_servers: [`https://${authDomain}/`],
    scopes_supported: scopes,
    bearer_methods_supported: ["header"],
    resource_documentation: `${resourceUri.replace('/mcp', '')}/docs`
  };
}

/**
 * Handle well-known OAuth protected resource metadata requests
 * Supports both /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/mcp
 */
export function handleWellKnown(request: Request): Response {
  try {
    const metadata = generateMetadata();
    
    return new Response(JSON.stringify(metadata, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  } catch (error) {
    console.error("Error generating well-known metadata:", error);
    
    return new Response(JSON.stringify({
      error: "internal_server_error",
      error_description: "Failed to generate resource metadata"
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
}

/**
 * Handle OPTIONS preflight requests for CORS
 */
export function handleOptionsRequest(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400"
    }
  });
}