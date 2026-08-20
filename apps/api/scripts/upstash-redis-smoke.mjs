import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';

const redisUrl = process.env.REDIS_URL?.trim();

if (!redisUrl) {
  console.error('REDIS_URL is required for the Redis compatibility smoke test.');
  process.exitCode = 1;
} else {
  const prefix = process.env.REDIS_KEY_PREFIX?.trim() || 'ascuita-smoke';
  const runId = randomUUID();
  const keyPrefix = `${prefix}:migration-smoke:${runId}`;
  const valueKey = `${keyPrefix}:value`;
  const evalKey = `${keyPrefix}:eval`;
  const sortedSetKey = `${keyPrefix}:zset`;
  const client = createClient({ url: redisUrl });

  client.on('error', error => {
    console.error(`Redis client error: ${error instanceof Error ? error.message : String(error)}`);
  });

  const scanKeys = async () => {
    const keys = [];
    let cursor = '0';

    do {
      const reply = await client.scan(cursor, {
        MATCH: `${keyPrefix}:*`,
        COUNT: 100,
      });
      cursor = reply.cursor;
      keys.push(...reply.keys);
    } while (cursor !== '0');

    return keys;
  };

  try {
    await client.connect();

    if ((await client.ping()) !== 'PONG') {
      throw new Error('Redis PING did not return PONG.');
    }

    await client.set(valueKey, 'ready');
    await client.pExpire(valueKey, 60_000);
    if ((await client.pTTL(valueKey)) <= 0) {
      throw new Error('Redis PEXPIRE/PTTL compatibility check failed.');
    }

    const evalResult = await client.sendCommand([
      'EVAL',
      [
        'local count = redis.call("INCRBY", KEYS[1], ARGV[2])',
        'if redis.call("PTTL", KEYS[1]) < 0 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end',
        'return { count, redis.call("PTTL", KEYS[1]) }',
      ].join('\n'),
      '1',
      evalKey,
      '60000',
      '2',
    ]);
    if (!Array.isArray(evalResult) || Number(evalResult[0]) !== 2) {
      throw new Error('Redis EVAL compatibility check failed.');
    }

    await client.zAdd(sortedSetKey, [{ score: Date.now(), value: 'member' }]);
    if ((await client.zRem(sortedSetKey, 'member')) !== 1) {
      throw new Error('Redis ZADD/ZREM compatibility check failed.');
    }

    const keysBeforeCleanup = await scanKeys();
    if (!keysBeforeCleanup.includes(valueKey) || !keysBeforeCleanup.includes(evalKey)) {
      throw new Error('Redis SCAN compatibility check failed.');
    }

    if (keysBeforeCleanup.length > 0) {
      await client.unlink(keysBeforeCleanup);
    }

    if ((await scanKeys()).length !== 0) {
      throw new Error('Redis UNLINK cleanup check failed.');
    }

    console.log('Redis compatibility smoke test passed.');
  } catch (error) {
    console.error(
      `Redis compatibility smoke test failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exitCode = 1;
  } finally {
    await client.quit().catch(() => undefined);
  }
}
