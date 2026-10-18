// -----------------------------------------------------------------------------
// The configuration of the integration, normalized: defaults, bounds, and the
// two free-text fields (addresses, accounts per camera) parsed once.
// -----------------------------------------------------------------------------

export const STREAMS = { MAIN: 'main', SUB: 'sub' };
export const DEFAULTS = {
  username: 'admin',
  password: '',
  camera_addresses: '',
  camera_accounts: '',
  stream: STREAMS.MAIN,
  image_refresh_interval: 60,
  snapshot_on_detection: true,
};
const REFRESH = { min: 10, max: 3600 };

/**
 * Parse one address: `192.168.1.108`, `192.168.1.108:8080`, `https://cam.lan`.
 * @param {string} text - The address as typed.
 * @returns {{ host: string, port: number | null, scheme: string } | null} The target, null when unreadable.
 * @example
 * parseAddress('https://192.168.1.30:8443'); // { host: '192.168.1.30', port: 8443, scheme: 'https' }
 */
export function parseAddress(text) {
  let value = String(text ?? '').trim();
  if (!value) {
    return null;
  }
  let scheme = 'http';
  const prefix = /^(https?):\/\//i.exec(value);
  if (prefix) {
    scheme = prefix[1].toLowerCase();
    value = value.slice(prefix[0].length);
  }
  value = value.replace(/\/.*$/, '');
  const match = /^(\[[0-9a-f:]+\]|[A-Za-z0-9.-]+)(?::(\d{1,5}))?$/i.exec(value);
  if (!match) {
    return null;
  }
  const port = match[2] ? Number(match[2]) : null;
  if (port !== null && (port < 1 || port > 65535)) {
    return null;
  }
  return { host: match[1].replace(/^\[|\]$/g, ''), port, scheme };
}

/**
 * Parse the list of addresses.
 * @param {string} text - Comma, semicolon, space or line separated.
 * @returns {{ targets: object[], invalid: string[] }} The readable ones and the others.
 * @example
 * parseAddresses('192.168.1.108, 192.168.1.20:8080');
 */
export function parseAddresses(text) {
  const targets = [];
  const invalid = [];
  for (const entry of String(text ?? '').split(/[\s,;]+/)) {
    if (!entry) {
      continue;
    }
    const target = parseAddress(entry);
    if (target) {
      targets.push(target);
    } else {
      invalid.push(entry);
    }
  }
  return { targets, invalid };
}

/**
 * Parse the accounts per camera: `address|username|password`, comma separated.
 * The password may contain `|`: only the first two separate.
 * @param {string} text - The field.
 * @returns {Map<string, { username: string, password: string }>} By host.
 * @example
 * parseAccounts('192.168.1.42|gladys|secret');
 */
export function parseAccounts(text) {
  const accounts = new Map();
  for (const entry of String(text ?? '').split(/[,\n]+/)) {
    const first = entry.indexOf('|');
    const second = first >= 0 ? entry.indexOf('|', first + 1) : -1;
    if (first < 0 || second < 0) {
      continue;
    }
    const target = parseAddress(entry.slice(0, first));
    const username = entry.slice(first + 1, second).trim();
    if (target && username) {
      accounts.set(target.host.toLowerCase(), {
        username,
        password: entry.slice(second + 1).trim(),
      });
    }
  }
  return accounts;
}

/**
 * Normalize the values received from Gladys.
 * @param {object} [raw] - `gladys.config`.
 * @returns {object} The configuration, with `targets`, `invalidAddresses` and `accounts`.
 * @example
 * normalizeConfig({ username: 'admin', password: 'x' });
 */
export function normalizeConfig(raw = {}) {
  const value = (key) =>
    raw[key] === undefined || raw[key] === null || raw[key] === '' ? DEFAULTS[key] : raw[key];
  const refresh = Number(value('image_refresh_interval'));
  const { targets, invalid } = parseAddresses(value('camera_addresses'));
  const snapshotOnDetection = value('snapshot_on_detection');
  return {
    username: String(value('username')).trim() || DEFAULTS.username,
    password: String(value('password') ?? ''),
    stream: value('stream') === STREAMS.SUB ? STREAMS.SUB : STREAMS.MAIN,
    imageRefreshSeconds:
      Number.isFinite(refresh) && refresh > 0
        ? Math.min(REFRESH.max, Math.max(REFRESH.min, Math.round(refresh)))
        : 0,
    snapshotOnDetection: snapshotOnDetection !== false && snapshotOnDetection !== 'false',
    targets,
    invalidAddresses: invalid,
    accounts: parseAccounts(value('camera_accounts')),
  };
}

/**
 * The account to use for an address.
 * @param {object} config - The normalized configuration.
 * @param {string} host - The address.
 * @returns {{ username: string, password: string }} The account.
 * @example
 * accountFor(config, '192.168.1.42');
 */
export function accountFor(config, host) {
  return (
    config.accounts.get(String(host).toLowerCase()) ?? {
      username: config.username,
      password: config.password,
    }
  );
}

/**
 * Tell whether the integration can talk to a camera at all.
 * @param {object} config - The normalized configuration.
 * @returns {boolean} True when a password is set (globally or per camera).
 * @example
 * isConfigured(config);
 */
export function isConfigured(config) {
  return Boolean(config.password) || config.accounts.size > 0;
}
