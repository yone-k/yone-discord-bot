import { describe, expect, it } from 'vitest';
import { compareDecimal, formatDecimal, subtractDecimal } from '../../src/utils/Decimal';
import { parseInventoryAddCsvText } from '../../src/utils/InventoryParser';
import { parseCompletionInput } from '../../src/utils/RemindInventory';

describe('exact inventory decimals', () => {
  it('preserves quantities beyond the Number precision boundary through CSV input', () => {
    expect(parseInventoryAddCsvText('米,9007199254740993.25')[0].stock).toBe('9007199254740993.25');
  });
  it('compares and subtracts decimal fractions without binary rounding', () => {
    expect(compareDecimal('9007199254740993.2', '9007199254740993.1')).toBe(1);
    expect(subtractDecimal('0.3', '0.2')).toBe('0.1');
    expect(formatDecimal('1.25')).toBe('1.3');
  });
  it('preserves numeric input for backend range validation', () => {
    expect(parseInventoryAddCsvText('米,-0.01')[0].stock).toBe('-0.01');
  });
  it('preserves exact completion input for the API', () => {
    expect(parseCompletionInput('米,9007199254740993.25')[0].consume).toBe('9007199254740993.25');
  });
});
