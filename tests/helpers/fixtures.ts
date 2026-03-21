import type { Env, VoucherifyRedeemable } from '@/types';
import { MockKV } from './mock-kv';

export function mockEnv(overrides: Partial<Env> = {}): Env {
  return {
    PRICING_KV: new MockKV() as unknown as KVNamespace,
    VOUCHERIFY_APP_ID: 'test-app-id',
    VOUCHERIFY_SECRET_KEY: 'test-secret-key',
    VOUCHERIFY_WEBHOOK_SECRET: 'test-webhook-secret',
    VOUCHERIFY_BASE_URL: 'https://api.voucherify.test',
    ALLOWED_ORIGINS: 'https://example.com,https://www.example.com',
    PRICING_CURRENCY: 'CAD',
    PRICING_LOCALE: 'en-CA',
    PRICING_CURRENCY_SYMBOL: '$',
    WEBFLOW_API_TOKEN: 'test-webflow-token',
    WEBFLOW_SITE_ID: 'test-site-id',
    CMS_SYNC_ENABLED: 'false',
    ADMIN_API_TOKEN: 'test-admin-token',
    ...overrides,
  };
}

export const REDEEMABLE_PERCENT: VoucherifyRedeemable = {
  id: 'promo_percent_25',
  object: 'promotion_tier',
  result: {
    discount: {
      type: 'PERCENT',
      percent_off: 25,
    },
  },
  campaign_name: 'Summer Sale',
};

export const REDEEMABLE_AMOUNT: VoucherifyRedeemable = {
  id: 'promo_amount_10',
  object: 'promotion_tier',
  result: {
    discount: {
      type: 'AMOUNT',
      amount_off: 1000, // $10.00 in cents
    },
  },
  campaign_name: 'Flat Discount',
};

export const REDEEMABLE_FIXED: VoucherifyRedeemable = {
  id: 'promo_fixed_50',
  object: 'promotion_tier',
  result: {
    discount: {
      type: 'FIXED',
      fixed_amount: 5000, // $50.00 final price
    },
  },
  campaign_name: 'Fixed Price',
};

export const REDEEMABLE_UNIT: VoucherifyRedeemable = {
  id: 'promo_unit_2',
  object: 'promotion_tier',
  result: {
    discount: {
      type: 'UNIT',
      unit_off: 2,
    },
  },
  campaign_name: 'BOGO',
};

export const REDEEMABLE_ADD_MISSING: VoucherifyRedeemable = {
  id: 'promo_add_missing',
  object: 'promotion_tier',
  result: {
    discount: {
      type: 'UNIT',
      unit_off: 1,
      effect: 'ADD_MISSING_ITEMS',
    },
  },
  campaign_name: 'Free Gift',
};

export const REDEEMABLE_NO_DISCOUNT: VoucherifyRedeemable = {
  id: 'promo_no_discount',
  object: 'promotion_tier',
};

export const QUALIFICATION_RESPONSE = {
  qualifications: {
    redeemables: {
      data: [REDEEMABLE_PERCENT, REDEEMABLE_AMOUNT],
    },
  },
};

export const QUALIFICATION_RESPONSE_ALT = {
  redeemables: {
    data: [REDEEMABLE_FIXED],
  },
};

export const QUALIFICATION_RESPONSE_ARRAY = {
  data: [REDEEMABLE_UNIT],
};

export const WEBHOOK_PAYLOAD_CAMPAIGN = {
  type: 'campaign.updated',
  data: {
    id: 'camp_123',
    name: 'Summer Sale',
  },
};

export const WEBHOOK_PAYLOAD_VOUCHER = {
  type: 'voucher.created',
  data: {
    id: 'voucher_abc',
    code: 'SUMMER2025',
  },
};

export const WEBHOOK_PAYLOAD_IRRELEVANT = {
  type: 'customer.created',
  data: {
    id: 'cust_123',
  },
};

export const REDEEMABLE_COUPON_VOUCHER: VoucherifyRedeemable = {
  id: 'voucher_coupon_1',
  object: 'voucher',
  campaign_type: 'DISCOUNT_COUPONS',
  voucher: { code: 'SAVE25' },
  result: {
    discount: {
      type: 'PERCENT',
      percent_off: 25,
    },
  },
  campaign_name: 'Summer Coupons',
};

export const REDEEMABLE_REFERRAL_VOUCHER: VoucherifyRedeemable = {
  id: 'voucher_referral_1',
  object: 'voucher',
  campaign_type: 'REFERRAL_PROGRAM',
  voucher: { code: 'REF-JOHN' },
  result: {
    discount: {
      type: 'AMOUNT',
      amount_off: 1500, // $15.00
    },
  },
  campaign_name: 'Refer a Friend',
};

export const REDEEMABLE_LOYALTY_CARD: VoucherifyRedeemable = {
  id: 'loyalty_card_1',
  object: 'loyalty_card',
  campaign_name: 'Rewards Program',
  result: {
    loyalty_card: {
      points: 500,
      balance: 350,
      next_expiration_date: '2026-06-01',
      next_expiration_points: 100,
    },
  },
};

export const REDEEMABLE_GIFT_VOUCHER: VoucherifyRedeemable = {
  id: 'voucher_gift_1',
  object: 'voucher',
  voucher: { code: 'GIFT-ABC' },
  campaign_name: 'Gift Cards',
  result: {
    gift: {
      amount: 5000, // $50.00
      balance: 3500, // $35.00
    },
  },
};

export const CAMPAIGNS_RESPONSE = {
  campaigns: [
    {
      id: 'camp_promo_1',
      name: 'Summer Promo',
      campaign_type: 'PROMOTION',
    },
  ],
};

export const TIERS_RESPONSE = {
  tiers: [
    {
      id: 'tier_1',
      name: 'Members Only',
      validation_rule_assignments: {
        data: [{ rule_id: 'rule_1' }],
      },
    },
  ],
};

export const VALIDATION_RULE_WITH_METADATA = {
  id: 'rule_1',
  rules: {
    rules: [
      {
        property: 'customer.metadata.is_member',
        comparator: 'is',
        value: true,
      },
    ],
  },
};

export const VALIDATION_RULE_NO_METADATA = {
  id: 'rule_2',
  rules: {
    rules: [
      {
        property: 'order.amount',
        comparator: 'more_than',
        value: 5000,
      },
    ],
  },
};
