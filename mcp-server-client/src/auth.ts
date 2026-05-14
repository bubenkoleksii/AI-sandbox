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

const client = jwksClient({
  jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`,
  requestHeaders: {},
  timeout: 30000,
  cache: true,
  rateLimit: true,
  jwksRequestsPerMinute: 5,
  jwksRequestsPerDay: 1,
});

const getKey = promisify(client.getSigningKey);

export async function validateToken(token: string): Promise<{ valid: boolean; payload?: JWTPayload; error?: string }> {
  try {
    // Decode header to get kid
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === 'string' || !decoded.header.kid) {
      return { valid: false, error: 'Invalid token format' };
    }

    // Get signing key
    const key = await getKey(decoded.header.kid);
    if (!key) {
      return { valid: false, error: 'Unable to get signing key' };
    }
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

export function isAuthBypassEnabled(): boolean {
  return process.env.DANGEROUSLY_OMIT_AUTH === 'true';
}