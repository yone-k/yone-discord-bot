import { parseCsvRecords } from './Csv';
import type { ShortageItem } from '../services/InventoryService';
import { normalizeDecimal, formatDecimal, subtractDecimal, compareDecimal } from './Decimal';
export interface InventoryInputItem {
  name: string;
  stock?: string;
  consume: string;
}

const parseInventoryNumber = (token: string, label: string): string | null => {
  const pattern = new RegExp(`^${label}\\s*[:=]?\\s*(\\d+(?:\\.\\d+)?)$`);
  const match = token.match(pattern);
  if (!match) {
    return null;
  }
  return normalizeDecimal(match[1]);
};

const parseNumericToken = (token: string): string | null => {
  if (!/^\d+(?:\.\d+)?$/.test(token)) {
    return null;
  }
  return normalizeDecimal(token);
};

const roundInventoryValue = formatDecimal;

export const parseInventoryInput = (input: string, options: { preservePrecision?: boolean } = {}): InventoryInputItem[] => {
  if (!input) {
    return [];
  }

  const records = parseCsvRecords(input).filter(record => record.cells.some(cell => cell !== ''));
  const items = records.map(({ cells }) => {
    const tokens = cells.map((cell, index) => index === 0 ? cell : cell.trim());
    if (tokens.length < 2 || tokens.length > 3) {
      throw new Error('在庫の形式が不正です');
    }

    const name = tokens[0];
    if (!name.trim()) {
      throw new Error('アイテム名が空です');
    }

    let stock: string | null = null;
    let consume: string | null = null;

    const numericTokens: string[] = [];
    for (const token of tokens.slice(1)) {
      const labeledStock = parseInventoryNumber(token, '在庫');
      const labeledConsume = parseInventoryNumber(token, '消費');
      if (labeledStock !== null) {
        if (stock !== null) throw new Error('在庫の指定が重複しています');
        stock = labeledStock;
      } else if (labeledConsume !== null) {
        if (consume !== null) throw new Error('消費の指定が重複しています');
        consume = labeledConsume;
      } else {
        const numeric = parseNumericToken(token);
        if (numeric === null) throw new Error('在庫の形式が不正です');
        numericTokens.push(numeric);
      }
    }
    for (const numeric of numericTokens) {
      if (tokens.length === 3 && stock === null) stock = numeric;
      else if (consume === null) consume = numeric;
      else throw new Error('数量の指定が重複しています');
    }

    if (consume === null) {
      throw new Error('消費が不足しています');
    }
    const roundedConsume = options.preservePrecision ? consume : roundInventoryValue(consume);
    if (compareDecimal(roundedConsume, '0') < 0) {
      throw new Error('消費は0以上の数値で入力してください');
    }
    const roundedStock = stock === null ? undefined : options.preservePrecision ? stock : roundInventoryValue(stock);
    if (roundedStock !== undefined && (compareDecimal(roundedStock, '0') < 0)) {
      throw new Error('在庫は0以上の数値で入力してください');
    }

    return { name, stock: roundedStock, consume: roundedConsume };
  });

  const seen = new Set<string>();
  for (const item of items) {
    const key = item.name;
    if (seen.has(key)) {
      throw new Error('アイテム名が重複しています');
    }
    seen.add(key);
  }

  return items;
};

export const parseCompletionInput = (input: string, options: { preservePrecision?: boolean } = {}): Array<{ name: string; consume: string | null }> => {
  if (!input) {
    return [];
  }

  const records = parseCsvRecords(input).filter(record => record.cells.some(cell => cell !== ''));
  const items = records.map(({ cells }) => {
    const tokens = cells.map((cell, index) => index === 0 ? cell : cell.trim());
    if (tokens.length < 1 || tokens.length > 2) {
      throw new Error('完了入力の形式が不正です');
    }

    const name = tokens[0];
    if (!name.trim()) {
      throw new Error('アイテム名が空です');
    }

    const consumeToken = tokens[1];
    if (consumeToken === undefined || consumeToken === '') {
      return { name, consume: null };
    }

    const consume = parseNumericToken(consumeToken);
    if (consume === null || compareDecimal(consume, '0') < 0) {
      throw new Error('消費は0以上の数値で入力してください');
    }

    return { name, consume: options.preservePrecision ? consume : formatDecimal(consume) };
  });

  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.name)) {
      throw new Error('アイテム名が重複しています');
    }
    seen.add(item.name);
  }

  return items;
};

export const formatInventoryShortageNotice = (items: ShortageItem[]): string => {
  const parts = items.map(item => `${item.name} ${formatDecimal(compareDecimal(item.required, item.available) > 0 ? subtractDecimal(item.required, item.available) : '0')}個`);
  return `不足している在庫の詳細は以下の通りです\n${parts.join('\n')}`;
};
