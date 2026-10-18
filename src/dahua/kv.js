// -----------------------------------------------------------------------------
// The text format of the Dahua CGI answers.
//
// Every read answers `key=value` lines:
//   getSystemInfo   ->  serialNumber=4X7C5A1ZAG21L3F
//   getConfig       ->  table.MotionDetect[0].Enable=true
//   getPresets      ->  presets[0].Index=1 / presets[0].Name=Gate
//   getCollect      ->  result=4
// and every write answers `OK`. A refusal is a body starting with `Error`
// (often with a 400, sometimes with a 200), which callers must not read as an
// empty table.
// -----------------------------------------------------------------------------

/**
 * Parse `key=value` lines into an object (later lines win).
 * @param {string} text - The body.
 * @returns {Record<string, string>} The values, keys as sent.
 * @example
 * parseKeyValues('table.RTSP.Port=554\r\n'); // { 'table.RTSP.Port': '554' }
 */
export function parseKeyValues(text) {
  const values = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const index = line.indexOf('=');
    if (index > 0) {
      values[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    }
  }
  return values;
}

/**
 * Tell whether a body is a refusal.
 * @param {string} text - The body.
 * @returns {boolean} True for `Error…`.
 * @example
 * isErrorBody('Error\r\nBad Request!'); // true
 */
export function isErrorBody(text) {
  return /^\s*Error\b/i.test(String(text ?? ''));
}

/**
 * Read a boolean value of a table (`true` / `false`, any case).
 * @param {string | undefined} value - The raw value.
 * @returns {boolean | null} The boolean, null when absent or unreadable.
 * @example
 * toBool('true'); // true
 */
export function toBool(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim().toLowerCase();
  if (text === 'true' || text === '1') {
    return true;
  }
  if (text === 'false' || text === '0') {
    return false;
  }
  return null;
}

/**
 * Group the entries of an indexed table: `table.X[0].A`, `table.X[0].B`,
 * `table.X[1].A` -> `[{ A, B }, { A }]`.
 *
 * Only the FIRST index is used; deeper ones stay in the key
 * (`table.VideoAnalyseRule[0][1].Type` -> entry 0, key `[1].Type`).
 * @param {Record<string, string>} values - The parsed answer.
 * @param {string} name - The table name (`MotionDetect`), with or without `table.`.
 * @returns {Array<Record<string, string>>} One object per index (holes kept as undefined).
 * @example
 * indexedTable(values, 'ChannelTitle'); // [{ Name: 'Gate' }, { Name: 'Garden' }]
 */
export function indexedTable(values, name) {
  const rows = [];
  const pattern = new RegExp(
    `^(?:table\\.)?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\[(\\d+)\\]\\.?(.*)$`,
  );
  for (const [key, value] of Object.entries(values)) {
    const match = pattern.exec(key);
    if (match) {
      const index = Number(match[1]);
      rows[index] = rows[index] ?? {};
      rows[index][match[2]] = value;
    }
  }
  return rows;
}
