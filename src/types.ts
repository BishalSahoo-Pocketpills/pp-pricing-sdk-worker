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
  name?: string;
  campaign_type?: string;
  voucher?: { code?: string };
  metadata?: Record<string, any>;
  result?: {
    discount?: VoucherifyDiscount;
    gift?: { amount: number; balance: number };
    loyalty_card?: {
      points: number;
      balance: number;
      next_expiration_date?: string;
      next_expiration_points?: number;
    };
  };
  campaign?: string;
  campaign_name?: string;
  campaign_id?: string;
  banner?: string;
  applicable_to?: {
    data?: Array<{
      object: string;
      id?: string;
      source_id?: string;
    }>;
    total?: number;
  };
}

export interface VoucherifyDiscount {
  type: 'PERCENT' | 'AMOUNT' | 'FIXED' | 'UNIT';
  percent_off?: number;
  amount_off?: number;
  fixed_amount?: number;
  unit_off?: number;
  effect?: string;
}

// --- Offer types ---

export type OfferCategory = 'coupon' | 'promotion' | 'loyalty' | 'referral' | 'gift';

export interface OfferDiscount {
  type: 'PERCENT' | 'AMOUNT' | 'FIXED' | 'UNIT' | 'NONE';
  percentOff?: number;
  amountOff?: number;
  fixedAmount?: number;
  unitOff?: number;
  label: string;
}

export interface OfferEntry {
  id: string;
  category: OfferCategory;
  title: string;
  description: string;
  code?: string;
  discount?: OfferDiscount;
  loyalty?: {
    points: number;
    balance: number;
    nextExpirationDate?: string;
    nextExpirationPoints?: number;
  };
  gift?: { amount: number; balance: number };
  campaignName?: string;
  applicableProductIds: string[];
  metadata?: Record<string, any>;
}

export interface OffersBundle {
  coupons: OfferEntry[];
  promotions: OfferEntry[];
  loyalty: OfferEntry[];
  referrals: OfferEntry[];
  gifts: OfferEntry[];
}

export interface OffersResponse {
  segment: string;
  offers: OffersBundle;
  timestamp: number;
}

// --- Webflow CMS types ---

export interface WebflowCollection {
  id: string;
  displayName: string;
  singularName: string;
  slug: string;
  fields: WebflowField[];
}

export interface WebflowField {
  id: string;
  type: string;
  slug: string;
  displayName: string;
  isRequired?: boolean;
}

export interface WebflowItem {
  id: string;
  fieldData: Record<string, any>;
  isDraft: boolean;
  isArchived: boolean;
  createdOn: string;
  lastUpdated: string;
}

export interface CMSCollectionIds {
  products: string;
  categories: string;
  segments: string;
  discountCoupons: string;
  vouchers: string;
  referralCodes: string;
  promotions: string;
  loyaltyPrograms: string;
}

export interface CMSSyncResult {
  created: number;
  updated: number;
  published: number;
  errors: string[];
  collections?: Record<string, { created: number; updated: number; errors: string[] }>;
}

export interface CMSStatus {
  enabled: boolean;
  collections: CMSCollectionIds | null;
  lastSync: string | null;
  itemCounts: {
    products: number;
    categories: number;
    segments: number;
    discountCoupons: number;
    vouchers: number;
    referralCodes: number;
    promotions: number;
    loyaltyPrograms: number;
  } | null;
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
  WEBFLOW_API_TOKEN: string;
  WEBFLOW_SITE_ID: string;
  CMS_SYNC_ENABLED: string;
  ADMIN_API_TOKEN: string;
  CUSTOM_SEGMENTS?: string;
}
