import { createApp } from '../src/worker.js';
import { bridge } from './_adapter.js';

export default function handler(req, res) {
  return bridge(req, res, '/api/config', createApp({}, process.env));
}
