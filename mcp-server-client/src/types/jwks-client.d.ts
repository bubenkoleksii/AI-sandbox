declare module 'jwks-client' {
  export interface SigningKey {
    getPublicKey(): string;
    getPublicKeyPem(): string;
  }
  
  export interface JwksClientOptions {
    jwksUri: string;
    requestHeaders?: any;
    timeout?: number;
    cache?: boolean;
    rateLimit?: boolean;
    jwksRequestsPerMinute?: number;
    jwksRequestsPerDay?: number;
  }
  
  export interface JwksClient {
    getSigningKey(kid: string, callback: (err: Error | null, key?: SigningKey) => void): void;
  }
  
  export default function jwksClient(options: JwksClientOptions): JwksClient;
}