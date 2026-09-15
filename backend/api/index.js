import { createRequestHandler } from '../dist/server.js';

const handleRequest = createRequestHandler({ corsOrigin: '*' });

export default function handler(req, res) {
  const routeValue = req.query?.__path;
  const routePath = Array.isArray(routeValue) ? routeValue.join('/') : routeValue;

  if (routePath) {
    const incoming = new URL(req.url || '/', 'http://localhost');
    incoming.searchParams.delete('__path');
    req.url = `${routePath.startsWith('/') ? routePath : `/${routePath}`}${incoming.search}`;
  }

  return handleRequest(req, res);
}

