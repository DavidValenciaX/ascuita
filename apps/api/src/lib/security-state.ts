import { createHash, randomUUID } from 'node:crypto';
import { createClient } from 'redis';

type RedisClient = ReturnType<typeof createClient>;

type CounterState = {
  count: number;
  resetAt: number;
};

export type CounterBatchEntry = {
  scope: string;
  clientKey: string;
  windowMs: number;
  amount: number;
};
type BlockState = {
  reason: string;
  expiresAt: number;
};

export type ConnectionLease = {
  clientKey: string;
  id: string;
};

const RATE_COUNTER_SCRIPT = [
  'local count = redis.call("INCRBY", KEYS[1], ARGV[2])',
  'if redis.call("PTTL", KEYS[1]) < 0 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end',
  'return { count, redis.call("PTTL", KEYS[1]) }',
].join('\n');

const BATCH_RATE_COUNTER_SCRIPT = [
  'local result = {}',
  'for index = 1, #KEYS do',
  '  local argIndex = (index - 1) * 2 + 1',
  '  local count = redis.call("INCRBY", KEYS[index], ARGV[argIndex + 1])',
  '  if redis.call("PTTL", KEYS[index]) < 0 then',
  '    redis.call("PEXPIRE", KEYS[index], ARGV[argIndex])',
  '  end',
  '  result[#result + 1] = count',
  '  result[#result + 1] = redis.call("PTTL", KEYS[index])',
  'end',
  'return result',
].join('\n');
const GUEST_TRIAL_SCRIPT = [
  'local value = redis.call("GET", KEYS[1])',
  'if not value then',
  '  redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2])',
  '  return ARGV[1]',
  'end',
  'return value',
].join('\n');

const ACQUIRE_LEASE_SCRIPT = [
  'redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", ARGV[1])',
  'local count = redis.call("ZCARD", KEYS[1])',
  'if count >= tonumber(ARGV[3]) then return { 0, count } end',
  'redis.call("ZADD", KEYS[1], ARGV[2], ARGV[4])',
  'redis.call("PEXPIRE", KEYS[1], ARGV[5])',
  'return { 1, count + 1 }',
].join('\n');

const RELEASE_LEASE_SCRIPT = [
  'redis.call("ZREM", KEYS[1], ARGV[1])',
  'if redis.call("ZCARD", KEYS[1]) == 0 then redis.call("DEL", KEYS[1]) end',
  'return 1',
].join('\n');

const AUDIO_COUNTER_SCOPE = 'ws-audio';
const RELEASE_CLEANUP_LOCK_TTL_SECONDS = 300;
const RELEASE_CLEANUP_MARKER_TTL_SECONDS = 86_400;

export class RedisUnavailableError extends Error {
  constructor() {
    super('Redis state store is unavailable');
    this.name = 'RedisUnavailableError';
  }
}

function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asRedisArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export class SecurityStateStore {
  private readonly explicitRedisUrl: string | undefined;
  private readonly explicitRedisKeyPrefix: string | undefined;
  private readonly explicitRedisRequired: boolean | undefined;
  private client: RedisClient | null = null;
  private connectPromise: Promise<void> | null = null;

  private readonly memoryCounters = new Map<string, CounterState>();
  private readonly memoryBlocks = new Map<string, BlockState>();
  private readonly memoryGuestTrials = new Map<string, number>();
  private readonly memoryLeases = new Map<string, Map<string, number>>();

  constructor(options?: {
    redisUrl?: string;
    redisKeyPrefix?: string;
    redisRequired?: boolean;
  }) {
    this.explicitRedisUrl = options?.redisUrl;
    this.explicitRedisKeyPrefix = options?.redisKeyPrefix;
    this.explicitRedisRequired = options?.redisRequired;
  }

  private get redisUrl() {
    return this.explicitRedisUrl ?? process.env.REDIS_URL?.trim() ?? '';
  }

  private get redisKeyPrefix() {
    return this.explicitRedisKeyPrefix ?? process.env.REDIS_KEY_PREFIX ?? 'ascuita';
  }

  private get redisRequired() {
    return (
      this.explicitRedisRequired ??
      (process.env.REDIS_REQUIRED === 'true' || Boolean(process.env.K_SERVICE))
    );
  }

  get backend(): 'redis' | 'memory' {
    return this.redisUrl ? 'redis' : 'memory';
  }

  async checkReadiness() {
    if (!this.redisUrl) {
      return !this.redisRequired;
    }

    if (!this.client?.isReady) {
      return false;
    }

    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  async connect() {
    if (!this.redisUrl) {
      if (this.redisRequired) {
        throw new Error(
          'REDIS_URL is required in Cloud Run or when REDIS_REQUIRED=true'
        );
      }
      return;
    }

    if (this.client?.isReady) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    const client = createClient({ url: this.redisUrl });
    client.on('error', error => {
      process.stderr.write(
        `${JSON.stringify({
          severity: 'ERROR',
          message: 'Redis client error',
          error: error instanceof Error ? error.message : String(error),
        })}\n`
      );
    });
    this.client = client;

    this.connectPromise = client
      .connect()
      .then(() => undefined)
      .catch(async error => {
        this.client = null;
        try {
          await client.disconnect();
        } catch {
          // Ignore cleanup errors after a failed connection attempt.
        }
        throw error;
      })
      .finally(() => {
        this.connectPromise = null;
      });

    return this.connectPromise;
  }

  async close() {
    if (!this.client) {
      return;
    }

    const client = this.client;
    this.client = null;
    if (client.isOpen) {
      await client.quit();
    }
  }

  private getClient() {
    if (!this.client?.isReady) {
      throw new RedisUnavailableError();
    }
    return this.client;
  }

  private key(scope: string, clientKey: string) {
    const digest = createHash('sha256').update(clientKey).digest('hex');
    return `${this.redisKeyPrefix}:${scope}:${digest}`;
  }

  private memoryCounterKey(scope: string, clientKey: string) {
    return `${scope}:${clientKey}`;
  }

  async incrementCounter(
    scope: string,
    clientKey: string,
    windowMs: number,
    amount = 1
  ): Promise<CounterState> {
    if (!this.redisUrl) {
      const key = this.memoryCounterKey(scope, clientKey);
      const now = Date.now();
      const current = this.memoryCounters.get(key);
      if (!current || current.resetAt <= now) {
        const next = { count: amount, resetAt: now + windowMs };
        this.memoryCounters.set(key, next);
        return next;
      }
      current.count += amount;
      return current;
    }

    const result = await this.getClient().sendCommand([
      'EVAL',
      RATE_COUNTER_SCRIPT,
      '1',
      this.key(`counter:${scope}`, clientKey),
      String(windowMs),
      String(amount),
    ]);
    const values = asRedisArray(result);
    const count = asNumber(values[0]);
    const ttl = Math.max(asNumber(values[1]), 0);
    return {
      count,
      resetAt: Date.now() + ttl,
    };
  }

  async incrementCounterBatch(entries: CounterBatchEntry[]): Promise<CounterState[]> {
    const validEntries = entries.filter(
      entry => entry.amount > 0 && entry.windowMs > 0
    );

    if (validEntries.length === 0) {
      return [];
    }

    if (!this.redisUrl) {
      return Promise.all(
        validEntries.map(entry =>
          this.incrementCounter(
            entry.scope,
            entry.clientKey,
            entry.windowMs,
            entry.amount
          )
        )
      );
    }

    const args = validEntries.flatMap(entry => [
      String(entry.windowMs),
      String(entry.amount),
    ]);
    const result = asRedisArray(
      await this.getClient().sendCommand([
        'EVAL',
        BATCH_RATE_COUNTER_SCRIPT,
        String(validEntries.length),
        ...validEntries.map(entry => this.key(entry.scope, entry.clientKey)),
        ...args,
      ])
    );

    return validEntries.map((_, index) => {
      const count = asNumber(result[index * 2]);
      const ttl = Math.max(asNumber(result[index * 2 + 1]), 0);
      return {
        count,
        resetAt: Date.now() + ttl,
      };
    });
  }
  async cleanupStaleAudioCounters(releaseToken?: string) {
    if (!this.redisUrl || !releaseToken) {
      return {
        deleted: 0,
        skipped: true,
        reason: !this.redisUrl ? 'memory-backend' : 'release-token-missing',
      };
    }

    const client = this.getClient();
    const lockKey = this.key('release-cleanup-lock', releaseToken);
    const markerKey = this.key('release-cleanup-done', releaseToken);
    const lockResult = await client.sendCommand([
      'SET',
      lockKey,
      releaseToken,
      'NX',
      'EX',
      String(RELEASE_CLEANUP_LOCK_TTL_SECONDS),
    ]);

    if (String(lockResult) !== 'OK') {
      return { deleted: 0, skipped: true, reason: 'cleanup-in-progress' };
    }

    try {
      if (asNumber(await client.exists(markerKey)) > 0) {
        return { deleted: 0, skipped: true, reason: 'release-already-cleaned' };
      }

      const pattern = `${this.redisKeyPrefix}:counter:${AUDIO_COUNTER_SCOPE}:*`;
      let cursor = '0';
      let deleted = 0;

      do {
        const scanResult = asRedisArray(
          await client.sendCommand([
            'SCAN',
            cursor,
            'MATCH',
            pattern,
            'COUNT',
            '100',
          ])
        );
        cursor = String(scanResult[0] ?? '0');
        const keys = asRedisArray(scanResult[1]).map(String);

        if (keys.length > 0) {
          await client.sendCommand(['UNLINK', ...keys]);
          deleted += keys.length;
        }
      } while (cursor !== '0');

      await client.sendCommand([
        'SET',
        markerKey,
        releaseToken,
        'EX',
        String(RELEASE_CLEANUP_MARKER_TTL_SECONDS),
      ]);

      return { deleted, skipped: false, reason: 'cleaned' };
    } finally {
      await client.sendCommand(['DEL', lockKey]);
    }
  }

  async getBlock(clientKey: string): Promise<BlockState | null> {
    if (!this.redisUrl) {
      const block = this.memoryBlocks.get(clientKey);
      if (!block) {
        return null;
      }
      if (block.expiresAt <= Date.now()) {
        this.memoryBlocks.delete(clientKey);
        return null;
      }
      return block;
    }

    const key = this.key('block', clientKey);
    const value = await this.getClient().get(key);
    if (!value) {
      return null;
    }
    const ttl = await this.getClient().pTTL(key);
    if (ttl <= 0) {
      return null;
    }

    try {
      const parsed = JSON.parse(value) as { reason?: unknown };
      return {
        reason: typeof parsed.reason === 'string' ? parsed.reason : 'blocked',
        expiresAt: Date.now() + ttl,
      };
    } catch {
      return {
        reason: 'blocked',
        expiresAt: Date.now() + ttl,
      };
    }
  }

  async block(clientKey: string, reason: string, durationMs: number) {
    const block = {
      reason,
      expiresAt: Date.now() + durationMs,
    };

    if (!this.redisUrl) {
      this.memoryBlocks.set(clientKey, block);
      return block;
    }

    await this.getClient().set(
      this.key('block', clientKey),
      JSON.stringify({ reason }),
      { PX: durationMs }
    );
    return block;
  }

  async getOrStartGuestTrial(
    clientKey: string,
    retentionMs: number
  ): Promise<number> {
    if (!this.redisUrl) {
      const existing = this.memoryGuestTrials.get(clientKey);
      const now = Date.now();
      if (existing && now - existing <= retentionMs) {
        return existing;
      }
      this.memoryGuestTrials.set(clientKey, now);
      return now;
    }

    const now = Date.now();
    const value = await this.getClient().sendCommand([
      'EVAL',
      GUEST_TRIAL_SCRIPT,
      '1',
      this.key('guest-trial', clientKey),
      String(now),
      String(retentionMs),
    ]);
    return asNumber(value);
  }

  async acquireConnectionLease(
    clientKey: string,
    maxConnections: number,
    leaseDurationMs: number
  ): Promise<ConnectionLease | null> {
    const id = randomUUID();
    const now = Date.now();
    const expiresAt = now + leaseDurationMs;

    if (!this.redisUrl) {
      const key = this.memoryCounterKey('lease', clientKey);
      const leases = this.memoryLeases.get(key) || new Map<string, number>();
      for (const [leaseId, expiry] of leases) {
        if (expiry <= now) {
          leases.delete(leaseId);
        }
      }
      if (leases.size >= maxConnections) {
        return null;
      }
      leases.set(id, expiresAt);
      this.memoryLeases.set(key, leases);
      return { clientKey, id };
    }

    const result = await this.getClient().sendCommand([
      'EVAL',
      ACQUIRE_LEASE_SCRIPT,
      '1',
      this.key('leases', clientKey),
      String(now),
      String(expiresAt),
      String(maxConnections),
      id,
      String(leaseDurationMs * 2),
    ]);
    const values = asRedisArray(result);
    return asNumber(values[0]) === 1 ? { clientKey, id } : null;
  }

  async refreshConnectionLease(lease: ConnectionLease, leaseDurationMs: number) {
    const now = Date.now();
    const expiresAt = now + leaseDurationMs;

    if (!this.redisUrl) {
      const key = this.memoryCounterKey('lease', lease.clientKey);
      const leases = this.memoryLeases.get(key);
      if (!leases?.has(lease.id)) {
        return false;
      }
      leases.set(lease.id, expiresAt);
      return true;
    }

    const key = this.key('leases', lease.clientKey);
    const client = this.getClient();
    await client.zAdd(key, [{ score: expiresAt, value: lease.id }]);
    await client.pExpire(key, leaseDurationMs * 2);
    return true;
  }

  async releaseConnectionLease(lease: ConnectionLease) {
    if (!this.redisUrl) {
      const key = this.memoryCounterKey('lease', lease.clientKey);
      const leases = this.memoryLeases.get(key);
      if (!leases) {
        return;
      }
      leases.delete(lease.id);
      if (leases.size === 0) {
        this.memoryLeases.delete(key);
      }
      return;
    }

    await this.getClient().sendCommand([
      'EVAL',
      RELEASE_LEASE_SCRIPT,
      '1',
      this.key('leases', lease.clientKey),
      lease.id,
    ]);
  }
}

export const securityState = new SecurityStateStore();
