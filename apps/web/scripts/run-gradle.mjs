import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const androidDir = path.resolve(currentDir, '..', 'android');
const executable = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const result = spawnSync(executable, process.argv.slice(2), {
  cwd: androidDir,
  shell: process.platform === 'win32',
  stdio: 'inherit',
});

if (result.error) {
  console.error(`Could not run Gradle wrapper: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
