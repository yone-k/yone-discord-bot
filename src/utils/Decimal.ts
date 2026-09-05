/** Inventory quantities stay decimal strings across input, storage and arithmetic. */
export function normalizeDecimal(value: string): string {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error('数量は0以上の数値で入力してください');
  const [integer, fraction = ''] = value.split('.');
  const whole = integer.replace(/^0+(?=\d)/, '');
  const decimal = fraction.replace(/0+$/, '');
  return decimal ? `${whole}.${decimal}` : whole;
}

function aligned(a: string, b: string): [bigint, bigint, number] {
  const parts = [normalizeDecimal(a).split('.'), normalizeDecimal(b).split('.')];
  const scale = Math.max(parts[0][1]?.length ?? 0, parts[1][1]?.length ?? 0);
  return [BigInt(parts[0][0] + (parts[0][1] ?? '').padEnd(scale, '0')),
    BigInt(parts[1][0] + (parts[1][1] ?? '').padEnd(scale, '0')), scale];
}

export function compareDecimal(a: string, b: string): number {
  const [left, right] = aligned(a, b);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function subtractDecimal(a: string, b: string): string {
  const [left, right, scale] = aligned(a, b);
  if (left < right) throw new Error('在庫が不足しています');
  const digits = (left - right).toString().padStart(scale + 1, '0');
  return normalizeDecimal(scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits);
}

/** Existing UI rounds half up to one decimal place; stored values are never rounded. */
export function formatDecimal(value: string): string {
  const [whole, fraction = ''] = normalizeDecimal(value).split('.');
  let tenths = BigInt(whole) * 10n + BigInt(fraction[0] ?? '0');
  if ((fraction[1] ?? '0') >= '5') tenths += 1n;
  return tenths % 10n === 0n ? (tenths / 10n).toString() : `${tenths / 10n}.${tenths % 10n}`;
}
