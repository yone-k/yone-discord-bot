import type { RemindInventoryItem } from '../models/RemindTask';

const parseInventoryNumber = (token: string, label: string): number | null => {
  const pattern = new RegExp(`^${label}\\s*[:=]?\\s*(\\d+(?:\\.\\d+)?)$`);
  const match = token.match(pattern);
  if (!match) {
    return null;
  }
  return Number(match[1]);
};

const parseNumericToken = (token: string): number | null => {
  if (!/^\d+(?:\.\d+)?$/.test(token)) {
    return null;
  }
  return Number(token);
};

const roundInventoryValue = (value: number): number =>
  Math.round(value * 10) / 10;

const formatInventoryValue = (value: number): string => {
  const rounded = roundInventoryValue(value);
  const fixed = rounded.toFixed(1);
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
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

    const numericTokens = tokens
      .slice(1)
      .map(parseNumericToken)
      .filter((token): token is number => token !== null);

    if (consume === null && numericTokens.length > 0) {
      consume = numericTokens[0];
    }
    if (stock === null && numericTokens.length > 1) {
      stock = numericTokens[1];
    }

    if (stock === null) {
      throw new Error('在庫が不足しています');
    }
    if (consume === null) {
      throw new Error('消費が不足しています');
    }
    const roundedStock = roundInventoryValue(stock);
    const roundedConsume = roundInventoryValue(consume);
    if (!Number.isFinite(roundedStock) || roundedStock < 0) {
      throw new Error('在庫は0以上の数値で入力してください');
    }
    if (!Number.isFinite(roundedConsume) || roundedConsume <= 0) {
      throw new Error('消費は0より大きい数値で入力してください');
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

export const formatInventoryInput = (items: RemindInventoryItem[]): string => {
  if (!items || items.length === 0) {
    return '';
  }
  return items
    .map(item => `${item.name},${formatInventoryValue(item.consume)},${formatInventoryValue(item.stock)}`)
    .join('\n');
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
  const display = items
    .slice(0, maxItems)
    .map(item => `${item.name} ${formatInventoryValue(item.stock)}`)
    .join(', ');
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
    .map(item => `${item.name} 在庫${formatInventoryValue(item.stock)}/消費${formatInventoryValue(item.consume)}`)
    .join(', ');
  const suffix = items.length > maxItems ? '...' : '';
  return `在庫: ${display}${suffix}`;
};

export const formatInventoryShortage = (items: RemindInventoryItem[]): string => {
  const parts = items.map(item => item.name);
  return parts.join('、');
};

export const formatInventoryShortageNotice = (items: RemindInventoryItem[]): string => {
  const parts = items.map((item) => {
    const shortage = Math.max(0, item.consume - item.stock);
    return `${item.name} ${formatInventoryValue(shortage)}個`;
  });
  return `不足している在庫の詳細は以下の通りです\n${parts.join('\n')}`;
};

export const formatInventoryDepleted = (items: RemindInventoryItem[]): string => {
  const parts = items.map(item => `${item.name}`);
  return parts.join(', ');
};
