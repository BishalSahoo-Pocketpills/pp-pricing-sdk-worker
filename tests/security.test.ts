import { describe, it, expect } from 'vitest';
import {
  verifyWebhookSignature,
  corsHeaders,
  handleCorsPreflight,
  sanitizeString,
  sanitizeProductIds,
} from '@/security';

const encoder = new TextEncoder();

async function sign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function makeRequest(
  body: string,
  signature?: string,
  origin?: string,
): Request {
  const headers: Record<string, string> = {};
  if (signature) headers['x-voucherify-signature'] = signature;
  if (origin) headers['Origin'] = origin;
  return new Request('https://worker.test/webhook', {
    method: 'POST',
    body,
    headers,
  });
}

describe('verifyWebhookSignature', () => {
  const secret = 'test-secret';
  const body = '{"type":"campaign.updated"}';

  it('returns true for valid signature', async () => {
    const sig = await sign(body, secret);
    const req = makeRequest(body, sig);
    const result = await verifyWebhookSignature(req, secret);
    expect(result.valid).toBe(true);
    expect(result.body).toBe(body);
  });

  it('returns false for invalid signature', async () => {
    const req = makeRequest(body, 'invalid-signature');
    const result = await verifyWebhookSignature(req, secret);
    expect(result.valid).toBe(false);
  });

  it('returns false when signature header is missing', async () => {
    const req = makeRequest(body);
    const result = await verifyWebhookSignature(req, secret);
    expect(result.valid).toBe(false);
    expect(result.body).toBe('');
  });

  it('returns false for empty body', async () => {
    const sig = await sign('', secret);
    const req = makeRequest('', sig);
    const result = await verifyWebhookSignature(req, secret);
    expect(result.valid).toBe(false);
  });

  it('returns false for wrong secret', async () => {
    const sig = await sign(body, 'wrong-secret');
    const req = makeRequest(body, sig);
    const result = await verifyWebhookSignature(req, secret);
    expect(result.valid).toBe(false);
  });

  it('returns false for signature length mismatch', async () => {
    const req = makeRequest(body, 'short');
    const result = await verifyWebhookSignature(req, secret);
    expect(result.valid).toBe(false);
  });
});

describe('corsHeaders', () => {
  const allowed = 'https://example.com,https://www.example.com';

  it('sets Access-Control-Allow-Origin for allowed origin', () => {
    const req = makeRequest('', undefined, 'https://example.com');
    const headers = corsHeaders(req, allowed);
    expect(headers.get('Access-Control-Allow-Origin')).toBe(
      'https://example.com',
    );
    expect(headers.get('Vary')).toBe('Origin');
  });

  it('does not set Access-Control-Allow-Origin for disallowed origin', () => {
    const req = makeRequest('', undefined, 'https://evil.com');
    const headers = corsHeaders(req, allowed);
    expect(headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('handles missing Origin header', () => {
    const req = makeRequest('');
    const headers = corsHeaders(req, allowed);
    expect(headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('always includes methods and headers', () => {
    const req = makeRequest('', undefined, 'https://example.com');
    const headers = corsHeaders(req, allowed);
    expect(headers.get('Access-Control-Allow-Methods')).toBe(
      'GET, POST, OPTIONS',
    );
    expect(headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Authorization');
    expect(headers.get('Access-Control-Max-Age')).toBe('86400');
  });
});

describe('handleCorsPreflight', () => {
  it('returns 204 with CORS headers', () => {
    const req = new Request('https://worker.test', {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.com' },
    });
    const res = handleCorsPreflight(
      req,
      'https://example.com,https://www.example.com',
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://example.com',
    );
  });
});

describe('sanitizeString', () => {
  it('strips HTML characters', () => {
    expect(sanitizeString('<script>alert("xss")</script>')).toBe(
      'scriptalert(xss)/script',
    );
  });

  it('strips control characters', () => {
    expect(sanitizeString('hello\x00world\x1f')).toBe('helloworld');
  });

  it('truncates to maxLength', () => {
    expect(sanitizeString('abcdefghij', 5)).toBe('abcde');
  });

  it('uses default maxLength of 256', () => {
    const long = 'a'.repeat(300);
    expect(sanitizeString(long)).toHaveLength(256);
  });

  it('handles clean strings', () => {
    expect(sanitizeString('product-123')).toBe('product-123');
  });
});

describe('sanitizeProductIds', () => {
  it('parses comma-separated IDs', () => {
    expect(sanitizeProductIds('prod-1,prod-2,prod-3')).toEqual([
      'prod-1',
      'prod-2',
      'prod-3',
    ]);
  });

  it('trims whitespace', () => {
    expect(sanitizeProductIds(' prod-1 , prod-2 ')).toEqual([
      'prod-1',
      'prod-2',
    ]);
  });

  it('filters empty strings', () => {
    expect(sanitizeProductIds('prod-1,,prod-2,')).toEqual([
      'prod-1',
      'prod-2',
    ]);
  });

  it('sanitizes each ID', () => {
    expect(sanitizeProductIds('<script>,prod-1')).toEqual([
      'script',
      'prod-1',
    ]);
  });

  it('returns empty array for empty string', () => {
    expect(sanitizeProductIds('')).toEqual([]);
  });
});
