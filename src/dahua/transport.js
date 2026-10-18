// -----------------------------------------------------------------------------
// The HTTP transport to a camera (node:http / node:https).
//
// Not `fetch`: a camera served over HTTPS carries a self-signed certificate
// that `fetch` refuses without a custom dispatcher, and the challenge of a
// camera may come in several `WWW-Authenticate` headers that `fetch` merges.
// The client (client.js) takes the transport as a parameter: the tests and the
// lab replace it with the fake camera (test/helpers/fake-camera.js).
//
// Contract: send(request) resolves `{ status, headers, challenges, body }`
// (`body` a Buffer) or, with `stream: true`, `{ status, headers, challenges,
// chunks, close }` (`chunks` an async iterable of Buffers). It rejects with an
// error whose `code` is a network code (ECONNREFUSED, ETIMEDOUT…).
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';

/** The largest answer read in memory: a 4K snapshot stays far below. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * Collect the `WWW-Authenticate` headers one by one (Node joins duplicates).
 * @param {string[]} rawHeaders - `res.rawHeaders`.
 * @returns {string[]} The challenges.
 * @example
 * challengesOf(res.rawHeaders);
 */
function challengesOf(rawHeaders) {
  const list = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index].toLowerCase() === 'www-authenticate') {
      list.push(rawHeaders[index + 1]);
    }
  }
  return list;
}

/**
 * Send one request to a camera.
 * @param {object} request - What to send.
 * @param {string} request.scheme - `http` or `https`.
 * @param {string} request.host - The address.
 * @param {number} request.port - The port.
 * @param {string} request.method - The method.
 * @param {string} request.path - The path and query.
 * @param {Record<string, string>} [request.headers] - The headers.
 * @param {number} request.timeoutMs - Connection and idle timeout.
 * @param {boolean} [request.stream] - Hand the body over as it comes.
 * @returns {Promise<object>} The answer (see the contract above).
 * @example
 * await send({ scheme: 'http', host: '192.168.1.108', port: 80, method: 'GET', path: '/cgi-bin/magicBox.cgi?action=getSystemInfo', timeoutMs: 8000 });
 */
export function send({
  scheme,
  host,
  port,
  method,
  path,
  headers = {},
  timeoutMs,
  stream = false,
}) {
  const lib = scheme === 'https' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        host,
        port,
        method,
        path,
        headers: {
          'User-Agent': 'gladys-amcrest-dahua',
          Connection: stream ? 'keep-alive' : 'close',
          ...headers,
        },
        // Cameras serve HTTPS with a self-signed certificate they generated
        // themselves; there is no authority to check it against on a LAN.
        rejectUnauthorized: false,
        timeout: timeoutMs,
      },
      (res) => {
        const answer = {
          status: res.statusCode,
          headers: res.headers,
          challenges: challengesOf(res.rawHeaders),
        };
        if (stream && res.statusCode === 200) {
          resolve({
            ...answer,
            chunks: res,
            close: () => req.destroy(),
          });
          return;
        }
        const parts = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            req.destroy(Object.assign(new Error('answer too large'), { code: 'E2BIG' }));
            return;
          }
          parts.push(chunk);
        });
        res.on('end', () => resolve({ ...answer, body: Buffer.concat(parts) }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => {
      req.destroy(
        Object.assign(new Error(`no answer within ${timeoutMs} ms`), { code: 'ETIMEDOUT' }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}
