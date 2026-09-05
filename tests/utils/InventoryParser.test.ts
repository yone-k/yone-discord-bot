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

  it('throws on negative stock', () => {
    expect(() => parseInventoryAddCsvText('洗剤,-1')).toThrow();
  });

  it('accepts decimal stock and rounds to 1 decimal', () => {
    expect(parseInventoryAddCsvText('洗剤,5.5')).toEqual([
      { name: '洗剤', stock: '5.5' },
    ]);
  });
});
