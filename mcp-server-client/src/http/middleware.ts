import "dotenv/config";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { verifyBearer, isAuthBypassEnabled } from "../auth.js";
import type { JWTPayload } from "jose";

/**
 * Result of authentication attempt
 */
export type AuthOutcome =
  | { ok: true; authInfo: AuthInfo }
  | { ok: false; status: 401 | 403; wwwAuthenticate: string; body: object };

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.substring(7); // Remove "Bearer " prefix
}

/**
 * Build WWW-Authenticate header per RFC 9728 and RFC 6750
 */
function buildWWWAuthenticateHeader(
  error?: string,
  scope?: string,
  errorDescription?: string
): string {
  const resourceMetadataUrl = `${process.env.MCP_RESOURCE_URI?.replace('/mcp', '')}/.well-known/oauth-protected-resource/mcp`;
  
  const params: string[] = [];
  
  if (error) {
    params.push(`error="${error}"`);
  } else {
    params.push(`realm="MCP"`);
  }
  
  if (scope) {
    params.push(`scope="${scope}"`);
  }
  
  params.push(`resource_metadata="${resourceMetadataUrl}"`);
  
  if (errorDescription) {
    params.push(`error_description="${errorDescription}"`);
  }
  
  return `Bearer ${params.join(", ")}`;
}

/**
 * Convert JWT payload to AuthInfo structure
 */
function payloadToAuthInfo(token: string, payload: JWTPayload): AuthInfo {
  const clientId = (payload.azp as string) ?? (payload.sub as string) ?? "unknown";
  const scopeString = (payload.scope as string) ?? "";
  const scopes = scopeString.split(/\s+/).filter(s => s.length > 0);
  
  return {
    token,
    clientId,
    scopes,
    expiresAt: payload.exp,
    resource: new URL(process.env.MCP_RESOURCE_URI!),
    extra: payload
  };
}

/**
 * Check if the user has all required scopes
 */
function hasRequiredScopes(userScopes: string[], requiredScopes: string[]): boolean {
  if (requiredScopes.length === 0) return true;
  return requiredScopes.every(scope => userScopes.includes(scope));
}

/**
 * Create synthetic AuthInfo for bypass mode
 */
function createBypassAuthInfo(): AuthInfo {
  const scopeString = process.env.MCP_REQUIRED_SCOPES || "mcp:read mcp:write";
  const scopes = scopeString.split(/\s+/).filter(s => s.length > 0);
  
  return {
    token: "bypass-token",
    clientId: "bypass-client",
    scopes,
    expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    resource: new URL(process.env.MCP_RESOURCE_URI!),
    extra: {
      sub: "bypass-user",
      email: "bypass@test.com",
      iss: "bypass",
      aud: process.env.AUTH0_AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000)
    }
  };
}

/**
 * Authenticate HTTP request with Auth0 JWT bearer token
 * @param request HTTP request to authenticate
 * @param requiredScopes Scopes required for this operation
 * @returns Authentication outcome with AuthInfo or error response
 */
export async function authenticate(
  request: Request, 
  requiredScopes: string[] = []
): Promise<AuthOutcome> {
  try {
    // Check if auth bypass is enabled
    if (isAuthBypassEnabled()) {
      return { ok: true, authInfo: createBypassAuthInfo() };
    }

    // Extract bearer token
    const token = extractBearerToken(request);
    if (!token) {
      const defaultScopes = process.env.MCP_REQUIRED_SCOPES || "mcp:read mcp:write";
      return {
        ok: false,
        status: 401,
        wwwAuthenticate: buildWWWAuthenticateHeader(undefined, defaultScopes),
        body: {
          error: "unauthorized",
          error_description: "Bearer token required"
        }
      };
    }

    // Verify JWT token
    let payload: JWTPayload;
    try {
      payload = await verifyBearer(token);
    } catch (error) {
      const defaultScopes = process.env.MCP_REQUIRED_SCOPES || "mcp:read mcp:write";
      const errorMsg = error instanceof Error ? error.message : "Token validation failed";
      
      return {
        ok: false,
        status: 401,
        wwwAuthenticate: buildWWWAuthenticateHeader(undefined, defaultScopes, errorMsg),
        body: {
          error: "invalid_token",
          error_description: errorMsg
        }
      };
    }

    // Create AuthInfo from payload
    const authInfo = payloadToAuthInfo(token, payload);

    // Check required scopes
    if (!hasRequiredScopes(authInfo.scopes, requiredScopes)) {
      const missingScopes = requiredScopes.filter(scope => !authInfo.scopes.includes(scope));
      
      return {
        ok: false,
        status: 403,
        wwwAuthenticate: buildWWWAuthenticateHeader(
          "insufficient_scope", 
          missingScopes.join(" "),
          "Additional scopes required for this operation"
        ),
        body: {
          error: "insufficient_scope",
          error_description: `Missing required scopes: ${missingScopes.join(", ")}`
        }
      };
    }

    return { ok: true, authInfo };

  } catch (error) {
    console.error("Authentication error:", error);
    
    return {
      ok: false,
      status: 401,
      wwwAuthenticate: buildWWWAuthenticateHeader(undefined, undefined, "Internal authentication error"),
      body: {
        error: "server_error",
        error_description: "Internal authentication error"
      }
    };
  }
}