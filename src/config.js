import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const defaults = {
  target: 'http://127.0.0.1:3000', allowNonLocal: false, destructive: false,
  seed: 1, scenarioRate: 2, concurrency: 10, requestTimeoutMs: 3000,
  durationSeconds: 5, warmupSeconds: 0, drainTimeoutMs: 5000,
  namespace: 'loadtest', cleanup: true,
  slo: { p95LatencyMs: 1000, maxErrorRatePercent: 5, maxTimeoutRatePercent: 2,
    minScenariosPerSecond: 0, maxDroppedArrivalPercent: 10, minSamples: 1 }
};

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) throw new Error(`Unexpected argument: ${k}`);
    const name = k.slice(2);
    if (name === 'help') { out.help = true; continue; }
    if (['allow-non-local', 'destructive', 'no-cleanup'].includes(name)) out[name] = true;
    else { if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value for ${k}`); out[name] = argv[++i]; }
  }
  return out;
}

export function loadConfig(args = {}) {
  const file = args.config || 'config/example.config.json';
  const fromFile = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const cfg = { ...defaults, ...fromFile, slo: { ...defaults.slo, ...fromFile.slo } };
  const fields = { target: 'target', seed: 'seed', rps: 'scenarioRate', concurrency: 'concurrency',
    duration: 'durationSeconds', 'request-timeout': 'requestTimeoutMs', 'warmup': 'warmupSeconds',
    'drain-timeout': 'drainTimeoutMs', namespace: 'namespace' };
  for (const [arg, prop] of Object.entries(fields)) if (args[arg] !== undefined) cfg[prop] = ['seed','scenarioRate','concurrency','durationSeconds','requestTimeoutMs','warmupSeconds','drainTimeoutMs'].includes(prop) ? Number(args[arg]) : args[arg];
  if (args['allow-non-local']) cfg.allowNonLocal = true;
  if (args.destructive) cfg.destructive = true;
  if (args['no-cleanup']) cfg.cleanup = false;
  cfg.headers = { ...(cfg.headers || {}) };
  if (process.env.API_TOKEN) cfg.headers.authorization = `Bearer ${process.env.API_TOKEN}`;
  validateConfig(cfg);
  return cfg;
}

export function validateConfig(c) {
  let u;
  try { u = new URL(c.target); } catch { throw new Error('target must be a valid URL'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('target URL scheme must be http or https');
  const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
  if (!local && !c.allowNonLocal) throw new Error('Non-local target requires --allow-non-local or allowNonLocal=true');
  if (c.scenarioRate < 0 || c.scenarioRate > 1000) throw new Error('scenarioRate must be between 0 and 1000 scenarios/sec');
  if (c.concurrency < 1 || c.concurrency > 500) throw new Error('concurrency must be between 1 and 500');
  if (c.durationSeconds < 0.1 || c.durationSeconds > 3600) throw new Error('durationSeconds must be between 0.1 and 3600');
  if (c.requestTimeoutMs < 1 || c.requestTimeoutMs > 120000) throw new Error('requestTimeoutMs must be between 1 and 120000');
  if (c.destructive && !c.allowNonLocal && !local) throw new Error('Destructive scenarios against remote targets are prohibited by default');
  return true;
}

export function redactConfig(c) {
  const copy = JSON.parse(JSON.stringify(c));
  const u = new URL(copy.target); u.username = ''; u.password = ''; u.search = ''; u.hash = '';
  copy.target = `${u.origin}${u.pathname}`;
  for (const [k,v] of Object.entries(copy.headers || {})) if (/authorization|token|secret|password|api-key/i.test(k)) copy.headers[k] = v ? '[REDACTED]' : v;
  return copy;
}

export const moduleUrl = pathToFileURL(path.resolve('.')).href;
