import { describe, expect, it } from 'vitest';
import { convertSnapshot, makePlan, HEADERS, type Snapshot } from '../../src/migration/conversion';

import { fixture } from './fixture';

describe('snapshot conversion', () => {
  it('preserves exact quantities, notification milliseconds, nulls, order and exclusions', () => {
    const input = fixture();
    const result = convertSnapshot(input, makePlan(input, 'a'.repeat(64)));
    expect(result.tables.inventory_items[0].stock).toBe('12345678901234567890.123456789');
    expect(result.tables.remind_task_inventory_items[0].consume).toBe('0.1234567890123456789');
    expect(result.tables.list_items[0]).toMatchObject({ category: null, until: '2026-09-05', last_notified_at: '2026-09-05T00:00:00.001Z', position: 0 });
    expect(result.tables.remind_tasks[0]).toMatchObject({ time_of_day: '09:05:00', overdue_notify_limit: 0, revision: '0' });
    expect(result.excluded_sheets).toEqual(['remind_list_3_backup_20260905']);
    expect(result.empty_rows).toEqual([{ sheet: 'list_1', row: 3 }]);
    expect(result.excluded_columns[0]).toMatchObject({ value: 'unparsed timestamp' });
  });
  it.each([
    ['unknown sheet', (s: Snapshot): void => { s.sheets.push({ title: 'unknown', rows: [] }); }],
    ['orphan sheet', (s: Snapshot): void => { s.sheets.push({ title: 'list_999', rows: [HEADERS.list] }); }],
    ['missing sheet', (s: Snapshot): void => { s.sheets.splice(3, 1); }],
    ['unknown column', (s: Snapshot): void => { s.sheets[3].rows[0] = [...HEADERS.list, 'unknown']; }],
    ['duplicate header', (s: Snapshot): void => { s.sheets[3].rows[0] = [...HEADERS.list, 'name']; }],
    ['fractional days', (s: Snapshot): void => { s.sheets[5].rows[1][4] = '1.5'; }],
    ['submillisecond', (s: Snapshot): void => { s.sheets[3].rows[1][4] = '2026-09-05T00:00:00.0001Z'; }],
    ['invalid calendar', (s: Snapshot): void => { s.sheets[3].rows[1][2] = '2026-02-30'; }],
    ['invalid boolean', (s: Snapshot): void => { s.sheets[3].rows[1][3] = ''; }],
    ['legacy inventory', (s: Snapshot): void => { s.sheets[5].rows[1][7] = '[{"name":"牛乳","stock":2,"consume":1}]'; }],
    ['forged numeric wrapper', (s: Snapshot): void => { s.sheets[5].rows[1][7] = '[{"inventoryId":"item-A","consume":{"numericSource":"2"}}]'; }],
    ['missing reference', (s: Snapshot): void => { s.sheets[5].rows[1][7] = '[{"inventoryId":"missing","consume":0}]'; }],
    ['duplicate name', (s: Snapshot): void => { s.sheets[3].rows.push([...s.sheets[3].rows[1]]); }]
  ])('rejects %s before import', (_name, mutate) => {
    const input = fixture(); mutate(input);
    expect(() => convertSnapshot(input, makePlan(input, 'a'.repeat(64)))).toThrow();
  });
  it.each(['-1', 'NaN', 'Infinity', '', '1,000', '0x10'])('rejects invalid stock %s', value => {
    const input = fixture(); input.sheets[4].rows[1][2] = value;
    expect(() => convertSnapshot(input, makePlan(input, 'a'.repeat(64)))).toThrow('inventory_2:2');
  });
  it.each(['2026-09-05T00:00:00', '2026-02-30T00:00:00Z', '2026-09-05T24:00:00Z', '2026-09-05T00:00:00+24:00'])('rejects invalid timestamp %s', value => {
    const input = fixture(); input.sheets[5].rows[1][8] = value;
    expect(() => convertSnapshot(input, makePlan(input, 'a'.repeat(64)))).toThrow('remind_list_3:2');
  });
  it('accepts reordered headers, missing excluded column and omitted optional trailing cells', () => {
    const input = fixture();
    input.sheets[0].rows = [['list_title', 'channel_id', 'default_category', 'message_id', 'operation_log_thread_id'], ['一覧', '1', '']];
    const result = convertSnapshot(input, makePlan(input, 'a'.repeat(64)));
    expect(result.tables.list_channels[0]).toMatchObject({ channel_id: '1', default_category: 'その他', message_id: null });
  });
  it('retains zero consume and trailing zero precision without converting numeric to number', () => {
    const input = fixture(); input.sheets[5].rows[1][7] = '[{"inventoryId":"item-A","consume":0.0000}]';
    const result = convertSnapshot(input, makePlan(input, 'a'.repeat(64)));
    expect(result.tables.remind_task_inventory_items[0].consume).toBe('0.0000');
  });
});
