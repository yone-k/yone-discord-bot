// Disposable HTTPS boundary on an internal Docker network; never real Discord.
const https = require('node:https');
const fs = require('node:fs');
let posts = 0;
let created = false;
const server = https.createServer({ cert: fs.readFileSync('/test/cert.pem'), key: fs.readFileSync('/test/key.pem') }, async (request, response) => {
  const reply = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
  if (request.url === '/__test/status') return reply(200, { posts });
  if (request.headers.authorization !== 'Bot synthetic-discord-token') return reply(401, {});
  if (request.method === 'GET' && request.url === '/api/v10/users/@me') return reply(200, { id: '999', bot: true });
  if (request.method === 'POST' && request.url === '/api/v10/channels/100/messages') {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    let body;
    try { body = JSON.parse(raw); } catch { return reply(400, {}); }
    if (typeof body.nonce !== 'string' || body.nonce.length !== 22 || body.enforce_nonce !== true) return reply(400, {});
    posts++;
    created = true;
    return reply(200, { id: '300', channel_id: '100', author: { id: '999', bot: true }, nonce: body.nonce });
  }
  if (created && request.url === '/api/v10/channels/100/messages/300' && ['GET', 'PATCH'].includes(request.method)) {
    return reply(200, { id: '300', channel_id: '100', author: { id: '999', bot: true } });
  }
  if (created && request.method === 'PUT' && request.url === '/api/v10/channels/100/pins/300') return reply(200, {});
  return reply(404, { code: 10008 });
});
server.listen(443, '0.0.0.0');
