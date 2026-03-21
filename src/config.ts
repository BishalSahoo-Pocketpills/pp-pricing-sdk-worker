// KV key prefixes
export const KV_KEYS = {
  PRICES: 'prices:',
  SEGMENTS_REGISTRY: 'segments:registry',
  PRODUCTS_CATALOG: 'products:catalog',
  META_LAST_REVALIDATION: 'meta:last-revalidation',
  META_WEBHOOK_COUNT: 'meta:webhook-count',
  CMS_COLLECTION_IDS: 'cms:collection-ids',
  META_LAST_CMS_SYNC: 'meta:last-cms-sync',
  OFFERS: 'offers:',
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

// Webflow CMS configuration
export const WEBFLOW = {
  API_BASE: 'https://api.webflow.com/v2',
  BULK_LIMIT: 100,
  COLLECTIONS: {
    TREATMENTS: { displayName: 'Treatments', singularName: 'Treatment', slug: 'treatments' },
    PRICING: { displayName: 'Pricing', singularName: 'Pricing', slug: 'pricing' },
    SEGMENTS: { displayName: 'Segments', singularName: 'Segment', slug: 'segments' },
  },
} as const;

// API paths
export const PATHS = {
  WEBHOOK: '/webhook/v1/voucherify',
  PRICES: '/api/prices/',
  VALIDATE: '/api/validate',
  QUALIFY: '/api/qualify',
  SEGMENTS: '/api/segments',
  HEALTH: '/health',
  CMS_SETUP: '/api/cms/setup',
  CMS_STATUS: '/api/cms/status',
  CMS_SYNC: '/api/cms/sync',
  OFFERS: '/api/offers/',
} as const;
