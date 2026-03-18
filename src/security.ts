const encoder = new TextEncoder();

export async function verifyWebhookSignature(
  request: Request,
  secret: string,
): Promise<boolean> {
  const signature = request.headers.get('x-voucherify-signature');
  if (!signature) return false;

  const body = await request.clone().text();
  if (!body) return false;

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
  return timingSafeEqual(signature, expected);
}

function hexEncode(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  let result = 0;
  for (let i = 0; i < aBytes.length; i++) {
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
    headers.set('Vary', 'Origin');
  }

  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
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
