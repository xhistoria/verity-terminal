export async function bridge(req, res, pathname, app) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers || {})) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
  }
  const method = req.method || 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD' && req.body !== undefined;
  const body = hasBody ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : undefined;
  const request = new Request(`https://verity.local${pathname}`, { method, headers, body });
  const response = await app.fetch(request);
  res.status(response.status);
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.send(await response.text());
}
