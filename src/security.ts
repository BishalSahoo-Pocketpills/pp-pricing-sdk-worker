const encoder = new TextEncoder();

export async function verifyWebhookSignature(
  request: Request,
  secret: string,
): Promise<{ valid: boolean; body: string }> {
  const signature = request.headers.get('x-voucherify-signature');
  if (!signature) return { valid: false, body: '' };

  const body = await request.text();
  if (!body) return { valid: false, body: '' };

  // Voucherify signs JSON with whitespace removed
  let signingBody = body;
  try {
    signingBody = JSON.stringify(JSON.parse(body));
  } catch {
    // Not JSON — sign raw body
  }

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(signingBody));
  const expected = hexEncode(mac);
  return { valid: timingSafeEqual(signature, expected), body };
}

function hexEncode(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function timingSafeEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  const aBytes = encoder.encode(a.padEnd(maxLen, '\0'));
  const bBytes = encoder.encode(b.padEnd(maxLen, '\0'));
  let result = a.length ^ b.length; // non-zero if lengths differ
  for (let i = 0; i < maxLen; i++) {
    result |= aBytes[i] ^ bBytes[i];
  }
  return result === 0;
}

export function corsHeaders(
  request: Request,
  allowedOrigins: string,
): Headers {
  const origin = request.headers.get('Origin') || '';
  const allowed = allowedOrigins.split(',').map((o) => o.trim());
  const headers = new Headers();

  if (allowed.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }

  headers.set('Vary', 'Origin');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  headers.set('Access-Control-Max-Age', '86400');
  return headers;
}

export function handleCorsPreflight(
  request: Request,
  allowedOrigins: string,
): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request, allowedOrigins),
  });
}

export function verifyAdminToken(request: Request, expectedToken: string): boolean {
  if (!expectedToken) return false;
  const auth = request.headers.get('Authorization');
  if (!auth) return false;
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return false;
  return timingSafeEqual(token, expectedToken);
}

const MAX_BODY_SIZE = 512 * 1024; // 512 KB

export async function readBodyWithLimit(request: Request): Promise<{ body: string; error?: string }> {
  // Check Content-Length header first (fast reject for honest clients)
  const contentLength = request.headers.get('Content-Length');
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    return { body: '', error: 'Request body too large' };
  }

  // Read the actual body and enforce size limit (handles chunked/spoofed headers)
  const text = await request.text();
  if (text.length > MAX_BODY_SIZE) {
    return { body: '', error: 'Request body too large' };
  }

  return { body: text };
}

export function sanitizeString(input: string, maxLength = 256): string {
  return input
    .replace(/[<>'"]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .slice(0, maxLength);
}

export function sanitizeProductIds(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((id) => sanitizeString(id.trim(), 128))
    .filter((id) => id.length > 0);
}
