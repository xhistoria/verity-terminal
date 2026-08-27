import { createApp } from '../src/worker.js';
import { bridge } from './_adapter.js';

const app = createApp({}, process.env);

export default function handler(req, res) {
  const hash = typeof req.query?.hash === 'string' ? req.query.hash : '';
  return bridge(req, res, `/api/receipt?hash=${encodeURIComponent(hash)}`, app);
}
