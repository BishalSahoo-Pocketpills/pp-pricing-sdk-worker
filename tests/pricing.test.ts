import { describe, it, expect } from 'vitest';
import {
  calculateDiscount,
  selectBestDiscount,
  buildPricingEntry,
  buildDiscountLabel,
  formatPrice,
  parseQualificationResponse,
  buildPricingMatrix,
} from '../src/pricing';
import {
  mockEnv,
  REDEEMABLE_PERCENT,
  REDEEMABLE_AMOUNT,
  REDEEMABLE_FIXED,
  REDEEMABLE_UNIT,
  REDEEMABLE_ADD_MISSING,
  REDEEMABLE_NO_DISCOUNT,
  QUALIFICATION_RESPONSE,
  QUALIFICATION_RESPONSE_ALT,
  QUALIFICATION_RESPONSE_ARRAY,
} from './helpers/fixtures';

const env = mockEnv();

describe('calculateDiscount', () => {
  it('calculates PERCENT discount', () => {
    const result = calculateDiscount({ type: 'PERCENT', percent_off: 25 }, 100);
    expect(result).toEqual({ amount: 25, type: 'PERCENT' });
  });

  it('calculates AMOUNT discount (cents to dollars)', () => {
    const result = calculateDiscount({ type: 'AMOUNT', amount_off: 1000 }, 100);
    expect(result).toEqual({ amount: 10, type: 'AMOUNT' });
  });

  it('calculates FIXED discount (final price)', () => {
    const result = calculateDiscount({ type: 'FIXED', fixed_amount: 5000 }, 100);
    expect(result).toEqual({ amount: 50, type: 'FIXED' });
  });

  it('calculates UNIT discount', () => {
    const result = calculateDiscount({ type: 'UNIT', unit_off: 2 }, 100);
    expect(result).toEqual({ amount: 200, type: 'UNIT' });
  });

  it('handles missing values gracefully', () => {
    expect(calculateDiscount({ type: 'PERCENT' }, 100)).toEqual({
      amount: 0,
      type: 'PERCENT',
    });
    expect(calculateDiscount({ type: 'AMOUNT' }, 100)).toEqual({
      amount: 0,
      type: 'AMOUNT',
    });
  });

  it('returns NONE for unknown type', () => {
    const result = calculateDiscount({ type: 'UNKNOWN' as any }, 100);
    expect(result).toEqual({ amount: 0, type: 'NONE' });
  });
});

describe('selectBestDiscount', () => {
  it('selects highest discount', () => {
    const result = selectBestDiscount(
      [REDEEMABLE_PERCENT, REDEEMABLE_AMOUNT],
      100,
    );
    // 25% of 100 = 25, $10 off = 10. Best is 25
    expect(result.amount).toBe(25);
    expect(result.type).toBe('PERCENT');
    expect(result.campaign).toBe('Summer Sale');
  });

  it('skips ADD_MISSING_ITEMS redeemables', () => {
    const result = selectBestDiscount(
      [REDEEMABLE_ADD_MISSING, REDEEMABLE_AMOUNT],
      100,
    );
    expect(result.amount).toBe(10);
    expect(result.type).toBe('AMOUNT');
  });

  it('skips redeemables without discount', () => {
    const result = selectBestDiscount(
      [REDEEMABLE_NO_DISCOUNT, REDEEMABLE_PERCENT],
      100,
    );
    expect(result.amount).toBe(25);
  });

  it('returns NONE when no valid discounts', () => {
    const result = selectBestDiscount([REDEEMABLE_NO_DISCOUNT], 100);
    expect(result.amount).toBe(0);
    expect(result.type).toBe('NONE');
    expect(result.vouchers).toEqual([]);
  });

  it('collects all applicable voucher IDs', () => {
    const result = selectBestDiscount(
      [REDEEMABLE_PERCENT, REDEEMABLE_AMOUNT],
      100,
    );
    expect(result.vouchers).toContain('promo_percent_25');
    expect(result.vouchers).toContain('promo_amount_10');
  });

  it('handles empty redeemables array', () => {
    const result = selectBestDiscount([], 100);
    expect(result.amount).toBe(0);
    expect(result.type).toBe('NONE');
  });
});

describe('buildDiscountLabel', () => {
  it('builds percent label', () => {
    expect(buildDiscountLabel('PERCENT', 25, 100, env)).toBe('25% OFF');
  });

  it('builds amount label', () => {
    const label = buildDiscountLabel('AMOUNT', 10, 100, env);
    expect(label).toContain('OFF');
    expect(label).toContain('10');
  });

  it('builds fixed label', () => {
    const label = buildDiscountLabel('FIXED', 50, 100, env);
    expect(label).toContain('OFF');
  });

  it('returns empty for NONE', () => {
    expect(buildDiscountLabel('NONE', 0, 100, env)).toBe('');
  });

  it('returns empty for zero amount', () => {
    expect(buildDiscountLabel('PERCENT', 0, 100, env)).toBe('');
  });
});

describe('formatPrice', () => {
  it('formats in CAD locale', () => {
    const result = formatPrice(10, env);
    // Intl may format as "$10.00" or "CA$10.00" depending on runtime
    expect(result).toContain('10');
  });

  it('handles zero', () => {
    const result = formatPrice(0, env);
    expect(result).toContain('0');
  });
});

describe('buildPricingEntry', () => {
  it('builds entry with discount', () => {
    const entry = buildPricingEntry(
      100,
      { amount: 25, type: 'PERCENT', vouchers: ['v1'], campaign: 'Sale' },
      env,
    );
    expect(entry.basePrice).toBe(100);
    expect(entry.discountedPrice).toBe(75);
    expect(entry.discountAmount).toBe(25);
    expect(entry.discountType).toBe('PERCENT');
    expect(entry.applicableVouchers).toEqual(['v1']);
    expect(entry.campaignName).toBe('Sale');
  });

  it('floors discounted price at 0', () => {
    const entry = buildPricingEntry(
      10,
      { amount: 20, type: 'AMOUNT', vouchers: [], campaign: undefined },
      env,
    );
    expect(entry.discountedPrice).toBe(0);
  });

  it('builds entry with no discount', () => {
    const entry = buildPricingEntry(
      100,
      { amount: 0, type: 'NONE', vouchers: [] },
      env,
    );
    expect(entry.basePrice).toBe(100);
    expect(entry.discountedPrice).toBe(100);
    expect(entry.discountLabel).toBe('');
  });
});

describe('parseQualificationResponse', () => {
  it('parses qualifications.redeemables.data format', () => {
    const result = parseQualificationResponse(QUALIFICATION_RESPONSE);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('promo_percent_25');
  });

  it('parses redeemables.data format', () => {
    const result = parseQualificationResponse(QUALIFICATION_RESPONSE_ALT);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('promo_fixed_50');
  });

  it('parses data array format', () => {
    const result = parseQualificationResponse(QUALIFICATION_RESPONSE_ARRAY);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('promo_unit_2');
  });

  it('returns empty array for null/undefined', () => {
    expect(parseQualificationResponse(null)).toEqual([]);
    expect(parseQualificationResponse(undefined)).toEqual([]);
    expect(parseQualificationResponse({})).toEqual([]);
  });
});

describe('buildPricingMatrix', () => {
  it('builds matrix for all products', () => {
    const products = {
      'prod-1': { basePrice: 100, lastSeen: 1000 },
      'prod-2': { basePrice: 60, lastSeen: 1000 },
    };
    const matrix = buildPricingMatrix(
      products,
      [REDEEMABLE_PERCENT],
      env,
    );
    expect(matrix['prod-1'].discountedPrice).toBe(75);
    expect(matrix['prod-2'].discountedPrice).toBe(45);
  });

  it('handles empty redeemables', () => {
    const products = { 'prod-1': { basePrice: 100, lastSeen: 1000 } };
    const matrix = buildPricingMatrix(products, [], env);
    expect(matrix['prod-1'].discountedPrice).toBe(100);
    expect(matrix['prod-1'].discountType).toBe('NONE');
  });

  it('handles empty products', () => {
    const matrix = buildPricingMatrix({}, [REDEEMABLE_PERCENT], env);
    expect(Object.keys(matrix)).toHaveLength(0);
  });
});
