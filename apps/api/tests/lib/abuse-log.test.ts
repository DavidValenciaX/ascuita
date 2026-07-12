import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendAbuseLog } from '../../src/lib/abuse-log.js';

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ascuita-abuse-log-'));
}

function getDailyLogPath(logDir: string, timestamp: number) {
  const isoDate = new Date(timestamp).toISOString().slice(0, 10);
  return path.join(logDir, `security-${isoDate}.ndjson`);
}

describe('appendAbuseLog', () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    vi.useRealTimers();

    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates the directory and appends the event as ndjson', () => {
    const logDir = createTempDir();
    createdDirs.push(logDir);
    const timestamp = Date.UTC(2026, 6, 11, 12, 0, 0);

    appendAbuseLog(logDir, 3, {
      type: 'http.rate_limit',
      ip: '1.2.3.4',
      reason: 'too_many_http_requests',
      metadata: { path: '/live', method: 'POST' },
      ts: timestamp,
    });

    const filePath = getDailyLogPath(logDir, timestamp);
    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      type: 'http.rate_limit',
      ip: '1.2.3.4',
      reason: 'too_many_http_requests',
      metadata: { path: '/live', method: 'POST' },
      ts: timestamp,
    });
  });

  it('removes old files outside the retention window before appending', () => {
    const logDir = createTempDir();
    createdDirs.push(logDir);
    const now = Date.UTC(2026, 6, 11, 12, 0, 0);
    const oldFile = path.join(logDir, 'security-2026-07-01.ndjson');
    const recentFile = path.join(logDir, 'security-2026-07-10.ndjson');

    fs.writeFileSync(oldFile, 'old\n', 'utf8');
    fs.writeFileSync(recentFile, 'recent\n', 'utf8');
    fs.utimesSync(oldFile, new Date(now - 10 * 24 * 60 * 60 * 1000), new Date(now - 10 * 24 * 60 * 60 * 1000));
    fs.utimesSync(recentFile, new Date(now - 1 * 24 * 60 * 60 * 1000), new Date(now - 1 * 24 * 60 * 60 * 1000));

    vi.useFakeTimers();
    vi.setSystemTime(now);

    appendAbuseLog(logDir, 3, {
      type: 'http.rate_limit',
      ip: '1.2.3.4',
      reason: 'too_many_http_requests',
    });

    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(recentFile)).toBe(true);
    expect(fs.existsSync(getDailyLogPath(logDir, now))).toBe(true);
  });

  it('uses the current timestamp when the event does not include one', () => {
    const logDir = createTempDir();
    createdDirs.push(logDir);
    const now = Date.UTC(2026, 6, 11, 18, 30, 0);

    vi.useFakeTimers();
    vi.setSystemTime(now);

    appendAbuseLog(logDir, 3, {
      type: 'http.rate_limit',
      ip: '8.8.8.8',
      reason: 'burst_detected',
    });

    const contents = fs
      .readFileSync(getDailyLogPath(logDir, now), 'utf8')
      .trim()
      .split('\n');
    expect(JSON.parse(contents[0]!).ts).toBe(now);
  });
});
