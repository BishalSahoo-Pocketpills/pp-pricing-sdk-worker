import type { SegmentDefinition } from '@/types';

// KV key prefixes
export const KV_KEYS = {
  PRICES: 'prices:',
  SEGMENTS_REGISTRY: 'segments:registry',
  PRODUCTS_CATALOG: 'products:catalog',
  META_LAST_REVALIDATION: 'meta:last-revalidation',
  META_WEBHOOK_COUNT: 'meta:webhook-count',
  CMS_COLLECTION_IDS: 'cms:collection-ids',
  META_LAST_CMS_SYNC: 'meta:last-cms-sync',
  CMS_SYNC_LOCK: 'cms:sync-lock',
  META_LAST_CMS_SYNC_RESULT: 'meta:last-cms-sync-result',
  REVALIDATION_LOCK: 'revalidation:lock',
  OFFERS: 'offers:',
  CMS_SYNC_PENDING: 'cms:sync-pending',
  CATALOG_LOCK: 'catalog:lock',
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
  FETCH_TIMEOUT_MS: 10_000,
} as const;

// Product catalog limits
export const CATALOG = {
  STALE_THRESHOLD_MS: 30 * 24 * 60 * 60 * 1000, // 30 days
  MAX_PRODUCTS: 5_000,
  MAX_PRODUCT_IDS_PER_REQUEST: 100,
  CATALOG_LOCK_TTL: 5, // seconds
} as const;

// Qualification pagination
export const QUALIFICATION = {
  PAGE_LIMIT: 50,
  MAX_PAGES: 10, // safety cap: max 500 redeemables
} as const;

// Webflow CMS configuration
export const WEBFLOW = {
  API_BASE: 'https://api.webflow.com/v2',
  BULK_LIMIT: 100,
  COLLECTIONS: {
    PRODUCTS: { displayName: 'Products', singularName: 'Product', slug: 'products' },
    CATEGORIES: { displayName: 'Categories', singularName: 'Category', slug: 'categories' },
    SEGMENTS: { displayName: 'Segments', singularName: 'Segment', slug: 'segments' },
    DISCOUNT_COUPONS: { displayName: 'Discount Coupons', singularName: 'Discount Coupon', slug: 'discount-coupons' },
    VOUCHERS: { displayName: 'Vouchers', singularName: 'Voucher', slug: 'vouchers' },
    REFERRAL_CODES: { displayName: 'Referral Codes', singularName: 'Referral Code', slug: 'referral-codes' },
    PROMOTIONS: { displayName: 'Promotions', singularName: 'Promotion', slug: 'promotions' },
    LOYALTY_PROGRAMS: { displayName: 'Loyalty Programs', singularName: 'Loyalty Program', slug: 'loyalty-programs' },
  },
} as const;

// Default categories (seed data)
export const DEFAULT_CATEGORIES = [
  { name: 'Treatment', slug: 'treatment', description: 'Prescription treatments' },
] as const;

// Default category assigned to products when no explicit category is set
export const DEFAULT_PRODUCT_CATEGORY = 'treatment' as const;

// Configurable segments: merges defaults with CUSTOM_SEGMENTS env var
export function getConfiguredSegments(env: { CUSTOM_SEGMENTS?: string }): SegmentDefinition[] {
  const segments: SegmentDefinition[] = [...DEFAULT_SEGMENTS.map(s => ({ ...s }))];
  if (env.CUSTOM_SEGMENTS) {
    try {
      const custom: Array<{ key: string; label: string; metadata: Record<string, any> }> =
        JSON.parse(env.CUSTOM_SEGMENTS);
      for (const seg of custom) {
        segments.push({
          key: seg.key,
          label: seg.label,
          customerContext: { metadata: seg.metadata },
        });
      }
    } catch {
      console.warn('[pp-pricing-worker] Failed to parse CUSTOM_SEGMENTS env var');
    }
  }
  return segments;
}

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
