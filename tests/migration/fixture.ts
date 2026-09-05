import { HEADERS, type Snapshot } from '../../src/migration/conversion';

export function fixture(): Snapshot {
  return { version: 1, spreadsheetId: 'synthetic', capturedAt: '2026-09-05T00:00:00.000Z', sheets: [
    { title: 'metadata', rows: [HEADERS.metadata, ['1', '', '一覧', '', '', 'unparsed timestamp']] },
    { title: 'inventory_metadata', rows: [HEADERS.inventory_metadata, ['2', '', '在庫', '', '', '']] },
    { title: 'remind_metadata', rows: [HEADERS.remind_metadata, ['3', '', '通知', '', '', '', '2', '']] },
    { title: 'list_1', rows: [HEADERS.list, ['牛乳', '', '2026/09/05', '0', '2026-09-05T09:00:00.001+09:00'], []] },
    { title: 'inventory_2', rows: [HEADERS.inventory, ['item-A', '牛乳', '12345678901234567890.123456789', '']] },
    { title: 'remind_list_3', rows: [HEADERS.remind, ['task-A', '', '購入', '', '1', '9:5', '0', '[{"inventoryId":"item-A","consume":0.1234567890123456789}]', '2026-09-05T00:00:00Z', '2026-09-06T00:00:00Z', '', '', '0', '0', '', '0', '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z']] },
    { title: 'remind_list_3_backup_20260905', rows: [['old']] }
  ] };
}

