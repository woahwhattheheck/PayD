export interface CSVRow {
  rowNumber: number;
  data: Record<string, string>;
  errors: string[];
  isValid: boolean;
}

// Read records rather than physical lines: quoted cells can contain delimiters
// and newlines. Leave field whitespace intact, as the backend does by default.
function parseRecords(content: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let value = '';
  let quoted = false;
  let quoteClosed = false;
  const input = content.replace(/^\uFEFF/, '');

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char !== '"') {
        value += char;
      } else if (input[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = false;
        quoteClosed = true;
      }
    } else if (char === ',' || char === '\r' || char === '\n') {
      record.push(value);
      value = '';
      quoteClosed = false;
      if (char !== ',') {
        records.push(record);
        record = [];
        if (char === '\r' && input[i + 1] === '\n') i++;
      }
    } else if (quoteClosed) {
      if (!/\s/.test(char)) {
        throw new Error(
          `Invalid CSV: unexpected character after closing quote in row ${records.length + 1}`
        );
      }
    } else if (char === '"') {
      if (value.trim() !== '') {
        throw new Error(`Invalid CSV: unexpected quote in row ${records.length + 1}`);
      }
      value = '';
      quoted = true;
    } else {
      value += char;
    }
  }

  if (quoted) {
    throw new Error(`Invalid CSV: unclosed quoted field in row ${records.length + 1}`);
  }
  // A terminating record separator does not create another empty employee.
  if (record.length > 0 || value !== '' || quoteClosed) {
    record.push(value);
    records.push(record);
  }
  return records;
}

export function parseCSVPreview(
  content: string,
  requiredColumns: string[],
  validators: Record<string, (value: string) => string | null> = {}
): CSVRow[] {
  const records = parseRecords(content);
  if (records.length === 0) return [];
  const [headers, ...data] = records;
  const missingColumns = requiredColumns.filter((col) => !headers.includes(col));
  if (missingColumns.length > 0) {
    throw new Error(`Missing required columns: ${missingColumns.join(', ')}`);
  }
  if (new Set(headers).size !== headers.length) {
    throw new Error('Invalid CSV: duplicate column headers');
  }

  return data.map((values, index) => {
    // The backend rejects excess columns; do not preview a silently truncated row.
    if (values.length > headers.length) {
      throw new Error(`Invalid CSV: too many columns in row ${index + 2}`);
    }
    const row: Record<string, string> = Object.fromEntries(
      headers.map((header, column) => [header, values[column] ?? ''])
    );
    const errors: string[] = [];
    requiredColumns.forEach((col) => {
      if (!row[col]) errors.push(`Missing required field: ${col}`);
    });
    Object.entries(validators).forEach(([field, validator]) => {
      if (row[field]) {
        const error = validator(row[field]);
        if (error) errors.push(error);
      }
    });
    return {
      // Match backend result rows, including when a quoted cell spans lines.
      rowNumber: index + 2,
      data: row,
      errors,
      isValid: errors.length === 0,
    };
  });
}
