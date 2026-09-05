export function parseCsvRecords(text: string): {
    cells: string[];
    line: number;
}[] {
  if (!text.trim())
    return [];
  const result: {
        cells: string[];
        line: number;
    }[] = [];
  let line = 1, rowLine = 1;
  let row: string[] = [], value = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        }
        else {
          quoted = false;
          closed = true;
        }
      }
      else {
        value += ch;
        if (ch === '\n')
          line++;
      }
    }
    else if (ch === ',' || ch === '\n' || ch === '\r') {
      row.push(closed ? value : value.trim());
      value = '';
      closed = false;
      if (ch !== ',') {
        if (ch === '\r' && text[i + 1] === '\n')
          i++;
        result.push({ cells: row, line: rowLine });
        row = [];
        line++;
        rowLine = line;
      }
    }
    else if (ch === '"' && value === '' && !closed)
      quoted = true;
    else {
      if (closed || ch === '"')
        throw new Error(`${line}行目: CSVの引用符が不正です`);
      value += ch;
    }
  }
  if (quoted)
    throw new Error(`${rowLine}行目: CSVの引用符が閉じていません`);
  if (value !== '' || row.length || closed) {
    row.push(closed ? value : value.trim());
    result.push({ cells: row, line: rowLine });
  }
  return result;
}

export function quoteCsvCell(value: string): string {
  return /^[\s]|[\s]$|[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
