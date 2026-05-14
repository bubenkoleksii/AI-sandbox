# MCP OAuth Integration Design

**Date:** 2026-05-14  
**Purpose:** Add OAuth authentication to MCP server for investigation and testing with MCP OAuth Debugger

## Overview

Integrate Auth0 OAuth authentication into the existing MCP server to enable secure access control while maintaining simplicity for investigation purposes. The implementation will add an `mcp_auth` tool and protect specific server capabilities without breaking existing functionality.

## Requirements

- **Simple implementation** suitable for MCP investigation/jam purposes
- **Auth0 integration** using existing credentials from `.env`
- **MCP OAuth Debugger compatibility** via `mcp_auth` tool
- **Optional authentication** that can be disabled for testing
- **Minimal code changes** to existing server structure

## Architecture

### Core Components

1. **Authentication Tool (`mcp_auth`)**
   - Required by MCP OAuth Debugger
   - Validates JWT tokens from Auth0
   - Manages session-based authentication state
   - Input: `{ token: string }`
   - Output: Authentication success/failure status

2. **JWT Validation Service**
   - Uses `jwks-client` to fetch Auth0 public keys
   - Validates token signature, expiration, audience
   - Extracts user claims (sub, email) from token
   - Caches JWKS for performance

3. **Authentication Middleware**
   - In-memory session state management
   - Tool wrapper for protected operations
   - Clear error messages for auth failures

### Authentication Flow

```
1. Client calls `mcp_auth` with JWT token
2. Server validates token with Auth0 JWKS
3. Server stores auth state in memory
4. Protected tools check auth state before execution
5. Unauthenticated calls return clear error messages
```

### Protected vs Public Resources

**Protected (require authentication):**
- `create-user` tool
- `create-random-user` tool

**Public (no authentication required):**
- `users` resource
- `user-details` resource templates  
- `generate-fake-user` prompt

This design allows testing both authenticated and unauthenticated scenarios.

## Configuration

### Environment Variables

```bash
# Existing Auth0 config (reused)
AUTH0_DOMAIN=dev-d4nr3bbnmvrwmcqn.us.auth0.com
AUTH0_CLIENT_ID=XpdCtxqPRvJQOo6cpH8kGad1xe1cmhPp
AUTH0_CLIENT_SECRET=sury7KDxV3oJ9VXqvJdJauo3BMMK08kz-h-wgtxhgVXR-RXxTPYySDmznwNtD15M
AUTH0_AUDIENCE=https://mcp-server-api

# Optional auth bypass for testing
DANGEROUSLY_OMIT_AUTH=true
```

### Dependencies

Already available in `package.json`:
- `auth0` - Auth0 SDK
- `jsonwebtoken` - JWT handling
- `jwks-client` - Public key fetching

## Implementation Details

### Authentication State

```typescript
interface AuthState {
  authenticated: boolean;
  user?: {
    sub: string;
    email?: string;
  };
  authenticatedAt: Date;
}
```

### Error Handling

- **Invalid token**: Clear error message with token validation details
- **Expired token**: Specific expiration error with timestamp
- **Missing auth**: Instructions to call `mcp_auth` first
- **Auth0 unreachable**: Graceful fallback with debug information

### Tool Protection Pattern

```typescript
// Before tool execution
if (isProtectedTool(toolName) && !isAuthenticated()) {
  return {
    content: [{
      type: "text",
      text: "Authentication required. Please call mcp_auth tool first."
    }]
  };
}
```

## Testing Scenarios

1. **OAuth Debugger Integration**: Test full OAuth flow with MCP Inspector
2. **Token validation**: Valid/invalid/expired tokens
3. **Protected tool access**: With and without authentication
4. **Auth bypass mode**: `DANGEROUSLY_OMIT_AUTH=true` for development
5. **Error scenarios**: Network issues, malformed tokens

## Security Considerations

- **In-memory auth state**: Suitable for investigation, not production
- **Token validation**: Full JWT signature verification with Auth0
- **No token storage**: Tokens not persisted or logged
- **Audience validation**: Ensures tokens are intended for this API

## Success Criteria

- MCP OAuth Debugger successfully authenticates
- Protected tools require valid Auth0 JWT tokens
- Public resources remain accessible without auth
- Clear error messages guide troubleshooting
- Optional auth bypass enables easy testing