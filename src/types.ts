// --- KV stored types ---

export interface PricingEntry {
  basePrice: number;
  discountedPrice: number;
  discountAmount: number;
  discountLabel: string;
  discountType: 'PERCENT' | 'AMOUNT' | 'FIXED' | 'UNIT' | 'NONE';
  applicableVouchers: string[];
  campaignName?: string;
}

export interface SegmentDefinition {
  key: string;
  label: string;
  customerContext: Record<string, any>;
  discoveredFrom?: string;
}

export interface ProductEntry {
  basePrice: number;
  lastSeen: number;
}

// --- API response types ---

export interface PricingResponse {
  segment: string;
  products: Record<string, PricingEntry>;
  timestamp: number;
}

// --- Voucherify types ---

export interface VoucherifyRedeemable {
  id: string;
  object: string;
  result?: { discount?: VoucherifyDiscount };
  campaign?: string;
  campaign_name?: string;
}

export interface VoucherifyDiscount {
  type: 'PERCENT' | 'AMOUNT' | 'FIXED' | 'UNIT';
  percent_off?: number;
  amount_off?: number;
  fixed_amount?: number;
  unit_off?: number;
  effect?: string;
}

// --- Worker env binding ---

export interface Env {
  PRICING_KV: KVNamespace;
  VOUCHERIFY_APP_ID: string;
  VOUCHERIFY_SECRET_KEY: string;
  VOUCHERIFY_WEBHOOK_SECRET: string;
  VOUCHERIFY_BASE_URL: string;
  ALLOWED_ORIGINS: string;
  PRICING_CURRENCY: string;
  PRICING_LOCALE: string;
  PRICING_CURRENCY_SYMBOL: string;
}
