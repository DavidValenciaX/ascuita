import fs from 'node:fs';
import path from 'node:path';

type AbuseLogEvent = {
  type: string;
  ip: string;
  reason: string;
  metadata?: Record<string, unknown>;
  ts?: number;
};

function ensureDirectory(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function pruneOldLogs(logDir: string, retentionDays: number) {
  ensureDirectory(logDir);
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  for (const entry of fs.readdirSync(logDir)) {
    const filePath = path.join(logDir, entry);
    const stat = fs.statSync(filePath);
    if (stat.isFile() && stat.mtimeMs < cutoff) {
      fs.unlinkSync(filePath);
    }
  }
}

function getDailyLogPath(logDir: string, timestamp: number) {
  const isoDate = new Date(timestamp).toISOString().slice(0, 10);
  return path.join(logDir, `security-${isoDate}.ndjson`);
}

export function appendAbuseLog(
  logDir: string,
  retentionDays: number,
  event: AbuseLogEvent
) {
  const timestamp = event.ts || Date.now();
  pruneOldLogs(logDir, retentionDays);
  ensureDirectory(logDir);

  const payload = {
    ...event,
    ts: timestamp,
  };

  fs.appendFileSync(
    getDailyLogPath(logDir, timestamp),
    `${JSON.stringify(payload)}\n`,
    'utf8'
  );
}
