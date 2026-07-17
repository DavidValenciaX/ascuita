import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(currentDir, '..', '.env.mobile');

if (!fs.existsSync(envPath)) {
  console.error(
    'Missing apps/web/.env.mobile. Copy .env.mobile.example and configure Firebase before building Android.'
  );
  process.exit(1);
}

const values = new Map();
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const separator = line.indexOf('=');
  if (separator <= 0) continue;
  values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
}

const apiBaseUrl = values.get('VITE_API_BASE_URL');
const firebaseConfig = values.get('VITE_FIREBASE_CONFIG');
const missing = [
  !apiBaseUrl || !/^https?:\/\//.test(apiBaseUrl) ? 'VITE_API_BASE_URL' : null,
  !firebaseConfig || firebaseConfig.includes('replace_me')
    ? 'VITE_FIREBASE_CONFIG'
    : null,
].filter(Boolean);

if (missing.length > 0) {
  console.error(
    `Invalid mobile environment. Configure: ${missing.join(', ')} in apps/web/.env.mobile.`
  );
  process.exit(1);
}

try {
  JSON.parse(firebaseConfig);
} catch {
  console.error(
    'VITE_FIREBASE_CONFIG must contain valid JSON in apps/web/.env.mobile.'
  );
  process.exit(1);
}
