import "dotenv/config";
import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";

// Create JWKS client for Auth0 public keys
const JWKS = createRemoteJWKSet(
  new URL(`https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`)
);

/**
 * Verify Auth0 JWT bearer token using jose library
 * @param token JWT token to verify
 * @returns JWT payload if valid
 * @throws Error if token is invalid, expired, or verification fails
 */
export async function verifyBearer(token: string): Promise<JWTPayload> {
  const authDomain = process.env.AUTH0_DOMAIN;
  const audience = process.env.AUTH0_AUDIENCE;

  if (!authDomain || !audience) {
    throw new Error("AUTH0_DOMAIN and AUTH0_AUDIENCE environment variables are required");
  }

  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://${authDomain}/`,
    audience: audience,
    algorithms: ["RS256"],
  });

  return payload;
}

/**
 * Check if authentication bypass is enabled for testing
 */
export function isAuthBypassEnabled(): boolean {
  return process.env.DANGEROUSLY_OMIT_AUTH === 'true';
}