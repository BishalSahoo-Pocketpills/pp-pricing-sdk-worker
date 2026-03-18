// KV key prefixes
export const KV_KEYS = {
  PRICES: 'prices:',
  SEGMENTS_REGISTRY: 'segments:registry',
  PRODUCTS_CATALOG: 'products:catalog',
  META_LAST_REVALIDATION: 'meta:last-revalidation',
  META_WEBHOOK_COUNT: 'meta:webhook-count',
} as const;

// Default segments (always present)
export const DEFAULT_SEGMENTS = [
  { key: 'anonymous', label: 'Anonymous', customerContext: {} },
  { key: 'member', label: 'Logged-in member', customerContext: { metadata: { is_logged_in: true } } },
] as const;

// Webhook event types that trigger pricing recomputation
export const PRICING_EVENTS = [
  'campaign.created',
  'campaign.updated',
  'campaign.enabled',
  'campaign.disabled',
  'campaign.deleted',
  'campaign.promotion_tier.created',
  'campaign.promotion_tier.updated',
  'campaign.promotion_tier.enabled',
  'campaign.promotion_tier.disabled',
  'campaign.promotion_tier.deleted',
  'voucher.created',
  'voucher.updated',
  'voucher.enabled',
  'voucher.disabled',
  'voucher.deleted',
  'business_validation_rule.created',
  'business_validation_rule.updated',
  'business_validation_rule.deleted',
] as const;

// Retry config for Voucherify API calls
export const RETRY = {
  MAX_RETRIES: 3,
  BASE_DELAY_MS: 500,
} as const;

// API paths
export const PATHS = {
  WEBHOOK: '/webhook',
  PRICES: '/api/prices/',
  VALIDATE: '/api/validate',
  QUALIFY: '/api/qualify',
  SEGMENTS: '/api/segments',
  HEALTH: '/health',
} as const;
