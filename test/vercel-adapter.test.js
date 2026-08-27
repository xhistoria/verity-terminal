import test from 'node:test';
import assert from 'node:assert/strict';
import { bridge } from '../api/_adapter.js';

function mockResponse() {
  return {
    statusCode: 200, headers: {}, body: '',
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    send(value) { this.body = value; return this; },
  };
}

test('Vercel adapter preserves status, no-store, and JSON body', async () => {
  const req = { method: 'POST', headers: { 'content-type': 'application/json' }, body: { hello: 'world' } };
  const res = mockResponse();
  const app = { fetch: async (request) => {
    assert.equal(await request.text(), JSON.stringify(req.body));
    return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'cache-control': 'no-store', 'content-type': 'application/json' } });
  } };
  await bridge(req, res, '/api/test', app);
  assert.equal(res.statusCode, 201);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.body, JSON.stringify({ ok: true }));
});
