// Same hosted API handlers locally; no project API keys are loaded.
import { createServer } from 'node:http';
import decision from '../api/arena/decision.js';
import session from '../api/arena/session.js';
const port = Number(process.env.ARENA_API_PORT || 4319);
createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 128000) {
      res.writeHead(413).end();
      return;
    }
    chunks.push(chunk);
  }
  const handler =
    req.url === '/api/arena/decision'
      ? decision
      : req.url === '/api/arena/session'
        ? session
        : undefined;
  if (!handler) {
    res.writeHead(404).end();
    return;
  }
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers))
    if (v) headers.set(k, Array.isArray(v) ? v.join(',') : v);
  const origin = req.headers.origin || `http://127.0.0.1:${port}`;
  const response = await handler.fetch(
    new Request(`${origin}${req.url}`, {
      method: req.method,
      headers,
      ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
    }),
  );
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, '127.0.0.1', () => console.log(`BYOK API listening on ${port}`));
