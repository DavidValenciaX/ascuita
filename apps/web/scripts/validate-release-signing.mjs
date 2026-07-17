import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const propertiesPath = path.resolve(
  currentDir,
  '..',
  'android',
  'keystore.properties'
);

if (!fs.existsSync(propertiesPath)) {
  console.error(
    'Missing apps/web/android/keystore.properties. Copy keystore.properties.example and configure the release upload key.'
  );
  process.exit(1);
}

const properties = fs.readFileSync(propertiesPath, 'utf8');
const requiredKeys = [
  'storeFile',
  'storePassword',
  'keyAlias',
  'keyPassword',
];
const missing = requiredKeys.filter(
  key => !new RegExp(`^${key}=.+$`, 'm').test(properties)
);

if (missing.length > 0) {
  console.error(
    `Release signing is incomplete. Configure: ${missing.join(', ')} in ${propertiesPath}.`
  );
  process.exit(1);
}
