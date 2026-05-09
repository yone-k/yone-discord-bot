import type { InventoryItem } from '../models/InventoryItem';

const roundInventoryValue = (value: number): number => Math.round(value * 10) / 10;

export function getInventorySheetHeaders(): string[] {
  return ['id', 'name', 'stock', 'category'];
}

export function toSheetRow(item: InventoryItem): (string | number)[] {
  return [
    item.id,
    item.name,
    item.stock,
    item.category
  ];
}

export function fromSheetRow(row: string[]): InventoryItem {
  return {
    id: row[0] || '',
    name: row[1] || '',
    stock: parseStock(row[2]),
    category: row[3] || ''
  };
}

function parseStock(value: string | undefined): number {
  if (!value || value.trim() === '') {
    return 0;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : roundInventoryValue(parsed);
}
