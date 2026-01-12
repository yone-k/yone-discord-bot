import type { RemindInventoryItem } from '../models/RemindTask';

const parseInventoryNumber = (token: string, label: string): number | null => {
  const pattern = new RegExp(`^${label}\\s*[:=]?\\s*(\\d+)$`);
  const match = token.match(pattern);
  if (!match) {
    return null;
  }
  return Number(match[1]);
};

const normalizeLineTokens = (line: string): string[] =>
  line
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');

export const parseInventoryInput = (input: string): RemindInventoryItem[] => {
  if (!input) {
    return [];
  }

  const lines = input
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter((line) => line !== '');

  if (lines.length === 0) {
    return [];
  }

  const items = lines.map((line) => {
    const tokens = normalizeLineTokens(line);
    if (tokens.length < 2) {
      throw new Error('在庫の形式が不正です');
    }

    const name = tokens[0];
    if (!name) {
      throw new Error('アイテム名が空です');
    }

    let stock: number | null = null;
    let consume: number | null = null;

    for (const token of tokens.slice(1)) {
      if (stock === null) {
        const parsed = parseInventoryNumber(token, '在庫');
        if (parsed !== null) {
          stock = parsed;
          continue;
        }
      }
      if (consume === null) {
        const parsed = parseInventoryNumber(token, '消費');
        if (parsed !== null) {
          consume = parsed;
          continue;
        }
      }
    }

    if (stock === null) {
      throw new Error('在庫が不足しています');
    }
    if (consume === null) {
      throw new Error('消費が不足しています');
    }
    if (!Number.isInteger(stock) || stock < 0) {
      throw new Error('在庫は0以上の整数で入力してください');
    }
    if (!Number.isInteger(consume) || consume < 1) {
      throw new Error('消費は1以上の整数で入力してください');
    }

    return { name, stock, consume };
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

export const formatInventoryInput = (items: RemindInventoryItem[]): string => {
  if (!items || items.length === 0) {
    return '';
  }
  return items.map(item => `${item.name},在庫${item.stock},消費${item.consume}`).join('\n');
};

export const getInsufficientInventoryItems = (
  items: RemindInventoryItem[]
): RemindInventoryItem[] => {
  if (!items || items.length === 0) {
    return [];
  }
  return items.filter(item => item.stock < item.consume);
};

export const consumeInventory = (items: RemindInventoryItem[]): RemindInventoryItem[] => {
  if (!items || items.length === 0) {
    return [];
  }
  return items.map(item => ({
    ...item,
    stock: item.stock - item.consume
  }));
};

export const formatInventorySummary = (
  items: RemindInventoryItem[],
  maxItems: number = 3
): string | null => {
  if (!items || items.length === 0) {
    return null;
  }
  const display = items.slice(0, maxItems).map(item => `${item.name} ${item.stock}`).join(', ');
  const suffix = items.length > maxItems ? '...' : '';
  return `在庫: ${display}${suffix}`;
};

export const formatInventoryDetail = (
  items: RemindInventoryItem[],
  maxItems: number = 5
): string | null => {
  if (!items || items.length === 0) {
    return null;
  }
  const display = items
    .slice(0, maxItems)
    .map(item => `${item.name} 在庫${item.stock}/消費${item.consume}`)
    .join(', ');
  const suffix = items.length > maxItems ? '...' : '';
  return `在庫: ${display}${suffix}`;
};

export const formatInventoryShortage = (items: RemindInventoryItem[]): string => {
  const parts = items.map(item => `${item.name}(在庫${item.stock}/消費${item.consume})`);
  return parts.join(', ');
};

export const formatInventoryDepleted = (items: RemindInventoryItem[]): string => {
  const parts = items.map(item => `${item.name}`);
  return parts.join(', ');
};
