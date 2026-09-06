import {parseInventoryAddCsvText} from '../../src/utils/InventoryParser';
describe('parseInventoryAddCsvText', () => {
  it('parses single line', () => {
    expect(parseInventoryAddCsvText('洗剤,5')).toEqual([
      { name: '洗剤', stock: '5' },
    ]);
  });

  it('parses multiple lines', () => {
    const text = '洗剤,5\nパン,3';
    expect(parseInventoryAddCsvText(text)).toHaveLength(2);
  });

  it('skips empty lines', () => {
    const text = '洗剤,5\n\n  \nパン,3';
    expect(parseInventoryAddCsvText(text)).toHaveLength(2);
  });

  it('throws on too many tokens', () => {
    expect(() => parseInventoryAddCsvText('a,1,b')).toThrow();
  });

  it('throws on empty name', () => {
    expect(() => parseInventoryAddCsvText(',5')).toThrow();
  });

  it('throws on non-numeric stock', () => {
    expect(() => parseInventoryAddCsvText('洗剤,abc')).toThrow();
  });

  it('leaves numeric range validation to the API', () => {
    expect(parseInventoryAddCsvText('洗剤,-1')[0].stock).toBe('-1');
  });

  it('preserves decimal stock without rounding API input', () => {
    expect(parseInventoryAddCsvText('洗剤,5.56789')).toEqual([
      { name: '洗剤', stock: '5.56789' },
    ]);
  });
});
