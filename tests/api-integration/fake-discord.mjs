import { createServer } from 'node:http';
import { once } from 'node:events';

// Only the integration test binary redirects Discord requests to this server.
export async function startDiscordBoundary(hasCommittedDispatch) {
  const messages = new Map();
  const creations = [];
  const edits = [];
  const errors = [];
  const server = createServer(async (request, response) => {
    const reply = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    try {
      if (request.method === 'GET' && request.url === '/__test/state') return reply(200, { creations, edits, errors });
      if (request.headers.authorization !== 'Bot integration-output-token') return reply(401, {});
      if (request.method === 'GET' && request.url === '/api/v10/users/@me') return reply(200, { id: '999', bot: true });
      let raw = '';
      for await (const chunk of request) raw += chunk;
      const payload = raw ? JSON.parse(raw) : null;
      if (request.method === 'POST' && request.url === '/api/v10/channels/920/messages') {
        if (!/^[A-Za-z0-9_-]{22}$/.test(payload?.nonce) || payload.enforce_nonce !== true || !hasCommittedDispatch(payload.nonce)) {
          throw new Error('creation requires a committed unknown dispatch and enforced nonce');
        }
        const message = { id: String(92001 + creations.length), channel_id: '920', author: { id: '999', bot: true }, nonce: payload.nonce };
        messages.set(message.id, message);
        creations.push({ ...message, payload });
        return reply(200, message);
      }
      const match = /^\/api\/v10\/channels\/920\/messages\/(\d+)$/.exec(request.url);
      if (match && ['GET', 'PATCH', 'DELETE'].includes(request.method)) {
        const message = messages.get(match[1]);
        if (!message) return reply(404, { code: 10008, message: 'Unknown Message' });
        if (request.method === 'DELETE') {
          messages.delete(message.id);
          response.writeHead(204);
          return response.end();
        }
        if (request.method === 'PATCH') edits.push({ id: message.id, payload });
        return reply(200, message);
      }
      throw new Error(`unexpected Discord request: ${request.method} ${request.url}`);
    } catch (error) {
      errors.push(error.message);
      reply(500, { message: error.message });
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}
