type AbuseLogEvent = {
  type: string;
  ip: string;
  reason: string;
  metadata?: Record<string, unknown>;
  ts?: number;
};

export function appendAbuseLog(event: AbuseLogEvent) {
  const timestamp = event.ts || Date.now();
  const payload = {
    ...event,
    ts: timestamp,
  };

  process.stdout.write(
    `${JSON.stringify({
      severity: 'WARNING',
      loggingEvent: 'ascuita.security',
      ...payload,
    })}\n`,
  );
}
