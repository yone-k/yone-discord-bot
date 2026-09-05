import type { Snapshot } from './conversion';

export interface ReadonlySheets {
  spreadsheets: {
    get(params: { spreadsheetId: string; fields: string }): Promise<{ data: { sheets?: { properties?: { title?: string | null } }[] } }>;
    values: { get(params: { spreadsheetId: string; range: string; valueRenderOption: 'FORMATTED_VALUE' }): Promise<{ data: { values?: unknown[][] | null } }> };
  };
}

export async function captureSnapshot(api: ReadonlySheets, spreadsheetId: string, now = new Date()): Promise<Snapshot> {
  const metadata = await api.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
  if (!metadata.data.sheets) throw new Error('Spreadsheet has no sheet inventory');
  const sheets: Snapshot['sheets'] = [];
  for (const sheet of metadata.data.sheets) {
    const title = sheet.properties?.title;
    if (!title) throw new Error('Spreadsheet sheet title is missing');
    const result = await api.spreadsheets.values.get({ spreadsheetId, range: `'${title.replace(/'/g, '\'\'')}'`, valueRenderOption: 'FORMATTED_VALUE' });
    const rows = result.data.values ?? [];
    if (rows.some(row => row.some(cell => typeof cell !== 'string'))) throw new Error(`${title}: expected string cells from FORMATTED_VALUE`);
    sheets.push({ title, rows: rows as string[][] });
  }
  return { version: 1, spreadsheetId, capturedAt: now.toISOString(), sheets };
}

export async function captureFromEnvironment(env: NodeJS.ProcessEnv = process.env): Promise<Snapshot> {
  const spreadsheetId = env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = env.GOOGLE_PRIVATE_KEY;
  if (!spreadsheetId || !email || !key) throw new Error('Migration GOOGLE_* settings are required for --fetch');
  // Import only on the one-off API path; snapshot replay never loads Google clients.
  const { google } = await import('googleapis');
  const auth = new google.auth.GoogleAuth({ credentials: { client_email: email, private_key: key.replace(/\\n/g, '\n') }, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  return captureSnapshot(google.sheets({ version: 'v4', auth }), spreadsheetId);
}
