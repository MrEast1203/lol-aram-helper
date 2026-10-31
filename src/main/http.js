// Minimal JSON-over-HTTPS client for the local League endpoints (self-signed certs).
const https = require('https');

const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true, maxSockets: 4 });

function requestJson(url, { method = 'GET', auth, body, timeout = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Accept: 'application/json' };
    if (auth) headers.Authorization = 'Basic ' + Buffer.from(auth).toString('base64');
    let payload;
    if (body !== undefined) {
      payload = Buffer.from(JSON.stringify(body));
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = payload.length;
    }
    const req = https.request(url, { method, headers, agent, timeout }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {}
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
        else {
          const err = new Error(`HTTP ${res.statusCode} ${url}`);
          err.status = res.statusCode;
          err.body = json;
          reject(err);
        }
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = { requestJson };
