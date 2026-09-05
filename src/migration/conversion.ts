import { randomUUID } from 'node:crypto';

export interface Snapshot { version: 1; spreadsheetId: string; capturedAt: string; sheets: { title: string; rows: string[][] }[] }
export interface MigrationPlan { snapshot_sha256: string; list_ids: Record<string, string> }
export type Row = Record<string, string | number | boolean | null>;
export const TABLES = ['list_channels', 'inventory_channels', 'remind_channels', 'list_items', 'inventory_items', 'remind_tasks', 'remind_task_inventory_items'] as const;
export type Table = typeof TABLES[number];
const common = ['channel_id', 'message_id', 'list_title', 'default_category', 'operation_log_thread_id', 'last_sync_time'];
export const HEADERS = {
  metadata: common, inventory_metadata: common,
  remind_metadata: ['channel_id', 'message_id', 'list_title', 'operation_log_thread_id', 'remind_notice_thread_id', 'remind_notice_message_id', 'linked_inventory_channel_id', 'last_sync_time'],
  list: ['name', 'category', 'until', 'check', 'last_notified_at'],
  inventory: ['id', 'name', 'stock', 'category'],
  remind: ['id', 'message_id', 'title', 'description', 'interval_days', 'time_of_day', 'remind_before_minutes', 'inventory_items', 'start_at', 'next_due_at', 'last_done_at', 'last_remind_due_at', 'overdue_notify_count', 'overdue_notify_limit', 'last_overdue_notified_at', 'is_paused', 'created_at', 'updated_at']
};
export interface Conversion {
  tables: Record<Table, Row[]>;
  input_sheets: string[]; target_sheets: string[]; excluded_sheets: string[];
  excluded_columns: { sheet: string; row: number; column: string; value: string }[];
  empty_rows: { sheet: string; row: number }[];
}
export class SnapshotValidationError extends Error {
  constructor(message: string, readonly partial: Conversion) { super(message); }
}

export function assertSnapshot(value: unknown): asserts value is Snapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid snapshot');
  const s = value as Snapshot;
  if (s.version !== 1 || typeof s.spreadsheetId !== 'string' || !s.spreadsheetId || typeof s.capturedAt !== 'string' || !Array.isArray(s.sheets)) throw new Error('Invalid snapshot metadata');
  timestamp(s.capturedAt);
  const seen = new Set<string>();
  for (const sheet of s.sheets) {
    if (!sheet || typeof sheet.title !== 'string' || seen.has(sheet.title) || !Array.isArray(sheet.rows) || sheet.rows.some(row => !Array.isArray(row) || row.some(cell => typeof cell !== 'string'))) throw new Error('Invalid or duplicate snapshot sheet');
    seen.add(sheet.title);
  }
}

export function makePlan(snapshot: Snapshot, sha: string): MigrationPlan {
  assertSnapshot(snapshot);
  const list_ids: Record<string, string> = {};
  for (const sheet of snapshot.sheets.filter(s => /^list_[0-9]+$/.test(s.title))) {
    sheet.rows.slice(1).forEach((row, i) => { if (row.some(v => v !== '')) list_ids[`${sheet.title}:${i + 2}`] = randomUUID(); });
  }
  return { snapshot_sha256: sha, list_ids };
}

function required(value: string): string { if (!value.trim()) throw new Error('Required nonempty value'); return value; }
function nullable(value: string): string | null { return value === '' ? null : required(value); }
function discord(value: string, optional = true): string | null {
  if (optional && value === '') return null;
  if (!/^[0-9]+$/.test(value)) throw new Error('Invalid Discord ID');
  return value;
}
export function decimal(value: string): string {
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) throw new Error('Invalid nonnegative finite decimal');
  // PostgreSQL numeric supports at most 131072 integer and 16383 fractional digits.
  const [coefficient, exponent = '0'] = value.toLowerCase().split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  const shift = Number(exponent);
  if (!Number.isSafeInteger(shift) || whole.length + shift > 131072 || fraction.length - shift > 16383) throw new Error('Decimal exceeds PostgreSQL numeric range');
  return value;
}
function integer(value: string, min = 0, max = 2147483647): number {
  if (!/^\d+$/.test(value)) throw new Error('Invalid integer');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error('Integer out of range');
  return number;
}
function bool(value: string): boolean { if (value !== '0' && value !== '1') throw new Error('Invalid boolean'); return value === '1'; }
function date(value: string): string {
  if (!/^\d{4}([-/])\d{2}\1\d{2}$/.test(value)) throw new Error('Invalid date');
  const normalized = value.replace(/\//g, '-');
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (normalized.startsWith('0000') || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) throw new Error('Invalid calendar date');
  return normalized;
}
export function timestamp(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new Error('Datetime requires explicit ISO offset');
  date(match[1]);
  if (+match[2] > 23 || +match[3] > 59 || +match[4] > 59 || /[1-9]/.test((match[5] ?? '').slice(3))) throw new Error('Invalid datetime or submillisecond precision');
  if (match[6] !== 'Z' && (+match[6].slice(1, 3) > 23 || +match[6].slice(4) > 59)) throw new Error('Invalid offset');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error('Invalid datetime');
  return parsed.toISOString();
}
function time(value: string): string {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(value);
  if (!m || +m[1] > 23 || +m[2] > 59) throw new Error('Invalid minute time');
  return `${m[1].padStart(2, '0')}:${m[2].padStart(2, '0')}:00`;
}
class NumericToken { constructor(readonly source: string) {} }
function references(value: string): { inventoryId: string; consume: string }[] {
  if (value === '') return [];
  const parsed: unknown = JSON.parse(value, (_key: string, v: unknown, context?: { source?: string }) => {
    if (typeof v === 'number') {
      if (!context?.source) throw new Error('Node.js 24 JSON source support required');
      return new NumericToken(context.source);
    }
    return v;
  });
  if (!Array.isArray(parsed)) throw new Error('Inventory settings must be array');
  const seen = new Set<string>();
  return parsed.map((v: unknown) => {
    if (!v || typeof v !== 'object') throw new Error('Invalid inventory setting');
    const item = v as Record<string, unknown>;
    if (Object.keys(item).sort().join(',') !== 'consume,inventoryId' || typeof item.inventoryId !== 'string' || !item.inventoryId.trim()) throw new Error('Legacy or invalid inventory setting');
    const consume = item.consume;
    if (!(consume instanceof NumericToken)) throw new Error('Consume must be numeric JSON token');
    if (seen.has(item.inventoryId)) throw new Error('Duplicate inventory reference');
    seen.add(item.inventoryId);
    return { inventoryId: item.inventoryId, consume: decimal(consume.source) };
  });
}

export function convertSnapshot(snapshot: Snapshot, plan: MigrationPlan): Conversion {
  assertSnapshot(snapshot);
  const result: Conversion = { tables: Object.fromEntries(TABLES.map(t => [t, [] as Row[]])) as Record<Table, Row[]>, input_sheets: snapshot.sheets.map(s => s.title), target_sheets: [], excluded_sheets: snapshot.sheets.filter(s => /^remind_list_[0-9]+_backup_[0-9]+$/.test(s.title)).map(s => s.title), excluded_columns: [], empty_rows: [] };
  try { return convertInto(snapshot, plan, result); }
  catch (error) { throw new SnapshotValidationError((error as Error).message, result); }
}

function convertInto(snapshot: Snapshot, plan: MigrationPlan, result: Conversion): Conversion {
  const used = new Set<string>();
  function read(title: string, headers: string[], handle: (row: Record<string, string>, position: number, sourceRow: number) => void): void {
    const sheet = snapshot.sheets.find(s => s.title === title);
    if (!sheet) throw new Error(`未処理: missing sheet ${title}`);
    used.add(title); result.target_sheets.push(title);
    const actual = sheet.rows[0] ?? [];
    if (new Set(actual).size !== actual.length || actual.some(h => !headers.includes(h)) || headers.filter(h => h !== 'last_sync_time').some(h => !actual.includes(h))) throw new Error(`${title}:1 invalid headers`);
    let position = 0;
    sheet.rows.slice(1).forEach((cells, i) => {
      const sourceRow = i + 2;
      if (cells.length > actual.length) throw new Error(`${title}:${sourceRow} cells beyond headers`);
      if (actual.includes('last_sync_time')) result.excluded_columns.push({ sheet: title, row: sourceRow, column: 'last_sync_time', value: cells[actual.indexOf('last_sync_time')] ?? '' });
      if (cells.every(v => v === '')) { result.empty_rows.push({ sheet: title, row: sourceRow }); return; }
      const row = Object.fromEntries(actual.map((h, index) => [h, cells[index] ?? '']));
      try { handle(row, position++, sourceRow); } catch (error) { throw new Error(`${title}:${sourceRow}: ${(error as Error).message}`); }
    });
  }
  for (const [metadata, table, prefix, headers] of [
    ['metadata', 'list_channels', 'list_', HEADERS.list],
    ['inventory_metadata', 'inventory_channels', 'inventory_', HEADERS.inventory],
    ['remind_metadata', 'remind_channels', 'remind_list_', HEADERS.remind]
  ] as const) {
    read(metadata, HEADERS[metadata], row => {
      const channel = discord(row.channel_id, false)!;
      const settings: Row = { channel_id: channel, message_id: discord(row.message_id), list_title: required(row.list_title), operation_log_thread_id: discord(row.operation_log_thread_id) };
      if (metadata === 'remind_metadata') {
        for (const key of ['remind_notice_thread_id', 'remind_notice_message_id', 'linked_inventory_channel_id']) settings[key] = discord(row[key]);
      } else settings.default_category = row.default_category === '' ? 'その他' : required(row.default_category);
      if (metadata === 'metadata') settings.edit_version = '0';
      result.tables[table].push(settings);
      read(`${prefix}${channel}`, [...headers], (item, position, sourceRow) => {
        const base: Row = { channel_id: channel, position };
        if (metadata === 'metadata') {
          const id = plan.list_ids[`${prefix}${channel}:${sourceRow}`];
          if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('Missing or invalid planned UUID');
          result.tables.list_items.push({ ...base, id, name: required(item.name), category: nullable(item.category), until: item.until === '' ? null : date(item.until), is_completed: bool(item.check), last_notified_at: item.last_notified_at === '' ? null : timestamp(item.last_notified_at) });
        } else if (metadata === 'inventory_metadata') {
          result.tables.inventory_items.push({ ...base, id: required(item.id), name: required(item.name), stock: decimal(item.stock), category: nullable(item.category) });
        } else {
          const task: Row = { ...base, id: required(item.id), message_id: discord(item.message_id), title: required(item.title), description: item.description === '' ? null : item.description, interval_days: integer(item.interval_days, 1), time_of_day: time(item.time_of_day), remind_before_minutes: integer(item.remind_before_minutes, 0, 10080), overdue_notify_count: integer(item.overdue_notify_count), overdue_notify_limit: item.overdue_notify_limit === '' ? null : integer(item.overdue_notify_limit), is_paused: bool(item.is_paused), revision: '0' };
          for (const key of ['start_at', 'next_due_at', 'created_at', 'updated_at']) task[key] = timestamp(item[key]);
          for (const key of ['last_done_at', 'last_remind_due_at', 'last_overdue_notified_at']) task[key] = item[key] === '' ? null : timestamp(item[key]);
          result.tables.remind_tasks.push(task);
          references(item.inventory_items).forEach((ref, index) => {
            if (!settings.linked_inventory_channel_id || !result.tables.inventory_items.some(i => i.channel_id === settings.linked_inventory_channel_id && i.id === ref.inventoryId)) throw new Error('Missing inventory reference or channel link');
            result.tables.remind_task_inventory_items.push({ task_channel_id: channel, task_id: task.id, inventory_channel_id: settings.linked_inventory_channel_id, inventory_id: ref.inventoryId, consume: ref.consume, position: index });
          });
        }
      });
    });
  }
  for (const sheet of snapshot.sheets) {
    if (used.has(sheet.title)) continue;
    if (!result.excluded_sheets.includes(sheet.title)) throw new Error(`未処理: ${sheet.title}`);
  }
  const unique = (table: Table, keys: string[], nullableKey = false): void => {
    const seen = new Set<string>();
    for (const row of result.tables[table]) {
      if (nullableKey && keys.some(k => row[k] === null)) continue;
      const key = JSON.stringify(keys.map(k => row[k]));
      if (seen.has(key)) throw new Error(`${table}: duplicate ${keys.join(',')}: ${key}`);
      seen.add(key);
    }
  };
  for (const table of ['list_channels', 'inventory_channels', 'remind_channels'] as const) unique(table, ['channel_id']);
  unique('list_items', ['id']); unique('list_items', ['channel_id', 'name']);
  unique('inventory_items', ['channel_id', 'id']); unique('inventory_items', ['channel_id', 'name']);
  unique('remind_tasks', ['channel_id', 'id']); unique('remind_tasks', ['channel_id', 'message_id'], true);
  for (const channel of result.tables.remind_channels) if (channel.linked_inventory_channel_id !== null && !result.tables.inventory_channels.some(i => i.channel_id === channel.linked_inventory_channel_id)) throw new Error('Missing linked inventory channel');
  return result;
}
