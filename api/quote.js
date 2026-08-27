import { createApp } from '../src/worker.js';
import { bridge } from './_adapter.js';

const app = createApp({}, process.env);

export default function handler(req, res) {
  return bridge(req, res, '/api/quote', app);
}
