import { IncomingMessage, ServerResponse } from "node:http";

/**
 * Read full body from Node.js IncomingMessage (avoid Request + ReadableStream + duplex on Node).
 */
async function readIncomingBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * Convert Node.js IncomingMessage to Web Standard Request.
 * Buffers the body so we do not use a streaming body with `Request` (avoids undici `duplex` requirement and race conditions).
 */
export async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      if (Array.isArray(value)) {
        for (const v of value) {
          headers.append(key, v);
        }
      } else {
        headers.set(key, value);
      }
    }
  }

  const method = req.method || 'GET';
  const canHaveBody = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  const buffer = canHaveBody ? await readIncomingBody(req) : Buffer.alloc(0);
  const body: BodyInit | null =
    canHaveBody && buffer.length > 0 ? new Uint8Array(buffer) : null;

  return new Request(url.toString(), {
    method,
    headers,
    body,
  });
}

/**
 * Send Web Standard Response to Node.js ServerResponse
 */
export async function sendWebResponse(res: ServerResponse, webResponse: Response): Promise<void> {
  res.statusCode = webResponse.status;

  // Set headers
  webResponse.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  // Send body
  if (webResponse.body) {
    const reader = webResponse.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
  }

  res.end();
}

/**
 * Create a JSON Response
 */
export function jsonResponse(data: any, status: number = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}

/**
 * Parse JSON-RPC from request body by cloning the request
 * Returns both the parsed body and original request is preserved
 */
export async function peekJsonRpc(request: Request): Promise<{ jsonRpc: any; parsedBody: any }> {
  if (!request.body) {
    return { jsonRpc: null, parsedBody: null };
  }

  try {
    // Clone the request to avoid consuming the body stream
    const clonedRequest = request.clone();
    const bodyText = await clonedRequest.text();
    const parsedBody = JSON.parse(bodyText);
    return { jsonRpc: parsedBody, parsedBody };
  } catch (error) {
    console.error('Failed to parse JSON-RPC:', error);
    return { jsonRpc: null, parsedBody: null };
  }
}

/**
 * Determine required scopes based on JSON-RPC method and params
 */
export function pickRequiredScopes(jsonRpc: any): string[] {
  if (!jsonRpc || typeof jsonRpc !== 'object') {
    return [];
  }

  const method = jsonRpc.method;
  if (!method) {
    return [];
  }

  // Map JSON-RPC methods to required scopes
  switch (method) {
    case 'tools/call':
      const toolName = jsonRpc.params?.name;
      if (toolName === 'create-user' || toolName === 'create-random-user') {
        return ['mcp:write'];
      }
      return [];

    case 'tools/list':
    case 'resources/list':
    case 'resources/read':
    case 'prompts/list':
    case 'prompts/get':
      return []; // Public read operations after authentication

    case 'initialize':
      return []; // Initialization doesn't require scopes

    default:
      // Unknown methods require read access by default
      return [];
  }
}
