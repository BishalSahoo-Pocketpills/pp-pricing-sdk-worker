import { describe, it, expect } from 'vitest';
import {
  categorizeRedeemable,
  buildOfferDiscount,
  buildOfferEntry,
  buildOffersBundle,
  extractApplicableProductIds,
} from '../src/offers';
import {
  mockEnv,
  REDEEMABLE_PERCENT,
  REDEEMABLE_AMOUNT,
  REDEEMABLE_COUPON_VOUCHER,
  REDEEMABLE_REFERRAL_VOUCHER,
  REDEEMABLE_LOYALTY_CARD,
  REDEEMABLE_GIFT_VOUCHER,
  REDEEMABLE_NO_DISCOUNT,
} from './helpers/fixtures';
import type { VoucherifyRedeemable } from '../src/types';

const env = mockEnv();

describe('categorizeRedeemable', () => {
  it('categorizes promotion_tier as promotion', () => {
    expect(categorizeRedeemable(REDEEMABLE_PERCENT)).toBe('promotion');
  });

  it('categorizes promotion_stack as promotion', () => {
    const r: VoucherifyRedeemable = {
      id: 'stack_1',
      object: 'promotion_stack',
    };
    expect(categorizeRedeemable(r)).toBe('promotion');
  });

  it('categorizes loyalty_card as loyalty', () => {
    expect(categorizeRedeemable(REDEEMABLE_LOYALTY_CARD)).toBe('loyalty');
  });

  it('categorizes voucher with REFERRAL_PROGRAM as referral', () => {
    expect(categorizeRedeemable(REDEEMABLE_REFERRAL_VOUCHER)).toBe('referral');
  });

  it('categorizes voucher with result.gift as gift', () => {
    expect(categorizeRedeemable(REDEEMABLE_GIFT_VOUCHER)).toBe('gift');
  });

  it('categorizes voucher with DISCOUNT_COUPONS as coupon', () => {
    expect(categorizeRedeemable(REDEEMABLE_COUPON_VOUCHER)).toBe('coupon');
  });

  it('categorizes plain voucher as coupon', () => {
    const r: VoucherifyRedeemable = {
      id: 'voucher_plain',
      object: 'voucher',
    };
    expect(categorizeRedeemable(r)).toBe('coupon');
  });

  it('categorizes campaign with result.loyalty_card as loyalty', () => {
    const r: VoucherifyRedeemable = {
      id: 'camp_loyalty',
      object: 'campaign',
      result: { loyalty_card: { points: 0, balance: 350 } },
    };
    expect(categorizeRedeemable(r)).toBe('loyalty');
  });

  it('categorizes campaign with result.gift as gift', () => {
    const r: VoucherifyRedeemable = {
      id: 'camp_gift',
      object: 'campaign',
      result: { gift: { amount: 5000, balance: 3500 } },
    };
    expect(categorizeRedeemable(r)).toBe('gift');
  });

  it('categorizes campaign with result.discount as promotion', () => {
    const r: VoucherifyRedeemable = {
      id: 'camp_discount',
      object: 'campaign',
      result: { discount: { type: 'AMOUNT', amount_off: 1000 } },
    };
    expect(categorizeRedeemable(r)).toBe('promotion');
  });

  it('categorizes voucher with result.loyalty_card as loyalty', () => {
    const r: VoucherifyRedeemable = {
      id: 'voucher_lc',
      object: 'voucher',
      result: { loyalty_card: { points: 100, balance: 50 } },
    };
    expect(categorizeRedeemable(r)).toBe('loyalty');
  });
});

describe('buildOfferDiscount', () => {
  it('builds PERCENT discount', () => {
    const d = buildOfferDiscount(REDEEMABLE_COUPON_VOUCHER, env);
    expect(d).toBeDefined();
    expect(d!.type).toBe('PERCENT');
    expect(d!.percentOff).toBe(25);
    expect(d!.label).toContain('25% OFF');
  });

  it('builds AMOUNT discount', () => {
    const d = buildOfferDiscount(REDEEMABLE_AMOUNT, env);
    expect(d).toBeDefined();
    expect(d!.type).toBe('AMOUNT');
    expect(d!.amountOff).toBe(10);
    expect(d!.label).toContain('OFF');
  });

  it('returns undefined when no discount', () => {
    const d = buildOfferDiscount(REDEEMABLE_NO_DISCOUNT, env);
    expect(d).toBeUndefined();
  });

  it('returns undefined for loyalty card without discount', () => {
    const d = buildOfferDiscount(REDEEMABLE_LOYALTY_CARD, env);
    expect(d).toBeUndefined();
  });

  it('builds FIXED discount with correct label', () => {
    const r: VoucherifyRedeemable = {
      id: 'fixed_1',
      object: 'promotion_tier',
      result: { discount: { type: 'FIXED', fixed_amount: 5000 } },
    };
    const d = buildOfferDiscount(r, env);
    expect(d).toBeDefined();
    expect(d!.type).toBe('FIXED');
    expect(d!.fixedAmount).toBe(50);
    expect(d!.label).toContain('Fixed price');
    expect(d!.label).toContain('50');
  });

  it('builds UNIT discount with correct label', () => {
    const r: VoucherifyRedeemable = {
      id: 'unit_1',
      object: 'promotion_tier',
      result: { discount: { type: 'UNIT', unit_off: 2 } },
    };
    const d = buildOfferDiscount(r, env);
    expect(d).toBeDefined();
    expect(d!.type).toBe('UNIT');
    expect(d!.unitOff).toBe(2);
    expect(d!.label).toBe('2 free');
  });
});

describe('extractApplicableProductIds', () => {
  it('extracts source_id from applicable_to data', () => {
    const r: VoucherifyRedeemable = {
      id: 'test',
      object: 'voucher',
      applicable_to: {
        data: [
          { object: 'product', source_id: 'prod-1' },
          { object: 'product', source_id: 'prod-2' },
        ],
      },
    };
    expect(extractApplicableProductIds(r)).toEqual(['prod-1', 'prod-2']);
  });

  it('falls back to id when source_id is missing', () => {
    const r: VoucherifyRedeemable = {
      id: 'test',
      object: 'voucher',
      applicable_to: {
        data: [{ object: 'product', id: 'prod-3' }],
      },
    };
    expect(extractApplicableProductIds(r)).toEqual(['prod-3']);
  });

  it('returns empty for missing applicable_to', () => {
    expect(extractApplicableProductIds(REDEEMABLE_PERCENT)).toEqual([]);
  });

  it('returns empty for empty data array', () => {
    const r: VoucherifyRedeemable = {
      id: 'test',
      object: 'voucher',
      applicable_to: { data: [] },
    };
    expect(extractApplicableProductIds(r)).toEqual([]);
  });
});

describe('buildOfferEntry', () => {
  it('builds coupon offer entry with code', () => {
    const entry = buildOfferEntry(REDEEMABLE_COUPON_VOUCHER, env);
    expect(entry.id).toBe('voucher_coupon_1');
    expect(entry.category).toBe('coupon');
    expect(entry.code).toBe('SAVE25');
    expect(entry.title).toBe('Summer Coupons');
    expect(entry.discount).toBeDefined();
    expect(entry.description).toContain('25%');
  });

  it('builds loyalty offer entry with balance', () => {
    const entry = buildOfferEntry(REDEEMABLE_LOYALTY_CARD, env);
    expect(entry.category).toBe('loyalty');
    expect(entry.loyalty).toBeDefined();
    expect(entry.loyalty!.balance).toBe(350);
    expect(entry.loyalty!.nextExpirationDate).toBe('2026-06-01');
    expect(entry.description).toContain('350 points');
  });

  it('builds gift offer entry', () => {
    const entry = buildOfferEntry(REDEEMABLE_GIFT_VOUCHER, env);
    expect(entry.category).toBe('gift');
    expect(entry.gift).toBeDefined();
    expect(entry.gift!.balance).toBe(3500);
    expect(entry.code).toBe('GIFT-ABC');
    expect(entry.description).toContain('$35.00');
  });

  it('builds referral offer entry', () => {
    const entry = buildOfferEntry(REDEEMABLE_REFERRAL_VOUCHER, env);
    expect(entry.category).toBe('referral');
    expect(entry.code).toBe('REF-JOHN');
    expect(entry.campaignName).toBe('Refer a Friend');
  });

  it('builds promotion entry without code', () => {
    const entry = buildOfferEntry(REDEEMABLE_PERCENT, env);
    expect(entry.category).toBe('promotion');
    expect(entry.code).toBeUndefined();
    expect(entry.campaignName).toBe('Summer Sale');
  });

  it('includes metadata when present', () => {
    const r: VoucherifyRedeemable = {
      ...REDEEMABLE_COUPON_VOUCHER,
      metadata: { tier: 'gold', priority: 1 },
    };
    const entry = buildOfferEntry(r, env);
    expect(entry.metadata).toEqual({ tier: 'gold', priority: 1 });
  });

  it('omits metadata when empty', () => {
    const r: VoucherifyRedeemable = {
      ...REDEEMABLE_COUPON_VOUCHER,
      metadata: {},
    };
    const entry = buildOfferEntry(r, env);
    expect(entry.metadata).toBeUndefined();
  });

  it('uses campaign fallback for title', () => {
    const r: VoucherifyRedeemable = {
      id: 'test',
      object: 'promotion_tier',
      campaign: 'Fallback Campaign',
    };
    const entry = buildOfferEntry(r, env);
    expect(entry.title).toBe('Fallback Campaign');
  });

  it('prefers name field for title (expand: redeemable)', () => {
    const r: VoucherifyRedeemable = {
      id: 'test',
      object: 'campaign',
      name: 'Expanded Name',
      campaign_name: 'Campaign Name',
      campaign: 'Campaign',
      result: { discount: { type: 'PERCENT', percent_off: 10 } },
    };
    const entry = buildOfferEntry(r, env);
    expect(entry.title).toBe('Expanded Name');
    expect(entry.campaignName).toBe('Campaign Name');
  });

  it('uses banner for title when name/campaign_name missing', () => {
    const r: VoucherifyRedeemable = {
      id: 'test',
      object: 'promotion_tier',
      banner: 'Save big today!',
      result: { discount: { type: 'PERCENT', percent_off: 15 } },
    };
    const entry = buildOfferEntry(r, env);
    expect(entry.title).toBe('Save big today!');
  });
});

describe('buildOffersBundle', () => {
  it('groups redeemables into correct categories', () => {
    const bundle = buildOffersBundle(
      [
        REDEEMABLE_COUPON_VOUCHER,
        REDEEMABLE_REFERRAL_VOUCHER,
        REDEEMABLE_LOYALTY_CARD,
        REDEEMABLE_GIFT_VOUCHER,
        REDEEMABLE_PERCENT, // promotion_tier
      ],
      env,
    );

    expect(bundle.coupons.length).toBe(1);
    expect(bundle.promotions.length).toBe(1);
    expect(bundle.loyalty.length).toBe(1);
    expect(bundle.referrals.length).toBe(1);
    expect(bundle.gifts.length).toBe(1);
  });

  it('returns empty bundle for empty input', () => {
    const bundle = buildOffersBundle([], env);
    expect(bundle.coupons).toEqual([]);
    expect(bundle.promotions).toEqual([]);
    expect(bundle.loyalty).toEqual([]);
    expect(bundle.referrals).toEqual([]);
    expect(bundle.gifts).toEqual([]);
  });

  it('sorts promotions by discount descending', () => {
    const small: VoucherifyRedeemable = {
      id: 'promo_small',
      object: 'promotion_tier',
      result: { discount: { type: 'PERCENT', percent_off: 5 } },
      campaign_name: 'Small',
    };
    const big: VoucherifyRedeemable = {
      id: 'promo_big',
      object: 'promotion_tier',
      result: { discount: { type: 'PERCENT', percent_off: 50 } },
      campaign_name: 'Big',
    };

    const bundle = buildOffersBundle([small, big], env);
    expect(bundle.promotions[0].id).toBe('promo_big');
    expect(bundle.promotions[1].id).toBe('promo_small');
  });

  it('sorts loyalty by balance descending', () => {
    const low: VoucherifyRedeemable = {
      id: 'lc_low',
      object: 'loyalty_card',
      campaign_name: 'Low',
      result: { loyalty_card: { points: 100, balance: 50 } },
    };
    const high: VoucherifyRedeemable = {
      id: 'lc_high',
      object: 'loyalty_card',
      campaign_name: 'High',
      result: { loyalty_card: { points: 500, balance: 400 } },
    };

    const bundle = buildOffersBundle([low, high], env);
    expect(bundle.loyalty[0].id).toBe('lc_high');
    expect(bundle.loyalty[1].id).toBe('lc_low');
  });

  it('sorts mixed discount types: PERCENT before AMOUNT', () => {
    const amount: VoucherifyRedeemable = {
      id: 'promo_amount',
      object: 'promotion_tier',
      result: { discount: { type: 'AMOUNT', amount_off: 5000 } },
      campaign_name: 'Amount',
    };
    const percent: VoucherifyRedeemable = {
      id: 'promo_percent',
      object: 'promotion_tier',
      result: { discount: { type: 'PERCENT', percent_off: 10 } },
      campaign_name: 'Percent',
    };

    const bundle = buildOffersBundle([amount, percent], env);
    // PERCENT rank (4) > AMOUNT rank (3), so percent first
    expect(bundle.promotions[0].id).toBe('promo_percent');
    expect(bundle.promotions[1].id).toBe('promo_amount');
  });

  it('handles redeemables with no discount', () => {
    const bundle = buildOffersBundle([REDEEMABLE_NO_DISCOUNT], env);
    expect(bundle.promotions.length).toBe(1);
    expect(bundle.promotions[0].discount).toBeUndefined();
  });
});
