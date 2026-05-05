/**
 * Redis caching service — gracefully degrades when Redis is unavailable.
 * Uses an in-memory Map as fallback so the app works without Redis.
 */
import dotenv from 'dotenv';
dotenv.config();

const BALANCE_TTL = 60; // seconds

// ── In-memory fallback cache ──────────────────────────────────────────────
const memCache = new Map(); // key → { value, expiresAt }

function memGet(key) {
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memCache.delete(key);
    return null;
  }
  return entry.value;
}

function memSet(key, value, ttlSeconds) {
  memCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

function memDel(key) {
  memCache.delete(key);
}

// ── Redis client (optional) ───────────────────────────────────────────────
let redisClient = null;
let redisAvailable = false;
let redisAttempted = false;

async function tryConnectRedis() {
  if (redisAttempted) return;
  redisAttempted = true;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.log('ℹ️  Redis URL not set — using in-memory cache');
    return;
  }

  try {
    const { createClient } = await import('redis');
    const client = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 3000,
        reconnectStrategy: (retries) => {
          if (retries >= 3) {
            console.warn('⚠️  Redis unavailable after 3 attempts — using in-memory cache');
            redisAvailable = false;
            return false; // stop retrying
          }
          return Math.min(retries * 500, 2000);
        },
      },
    });

    client.on('error', () => { redisAvailable = false; });
    client.on('connect', () => { redisAvailable = true; console.log('✅ Redis connected'); });
    client.on('end', () => { redisAvailable = false; });

    await Promise.race([
      client.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);

    redisClient = client;
    redisAvailable = true;
  } catch {
    console.log('ℹ️  Redis not available — using in-memory cache (app works fine without it)');
    redisAvailable = false;
  }
}

// Try to connect once at startup (non-blocking)
tryConnectRedis().catch(() => {});

// ── Public API ────────────────────────────────────────────────────────────

export async function getCachedBalances(roomId) {
  const key = `balance:${roomId}`;
  if (redisAvailable && redisClient) {
    try {
      const val = await redisClient.get(key);
      return val ? JSON.parse(val) : null;
    } catch { /* fall through */ }
  }
  return memGet(key);
}

export async function setCachedBalances(roomId, balances) {
  const key = `balance:${roomId}`;
  if (redisAvailable && redisClient) {
    try {
      await redisClient.setEx(key, BALANCE_TTL, JSON.stringify(balances));
      return;
    } catch { /* fall through */ }
  }
  memSet(key, balances, BALANCE_TTL);
}

export async function invalidateBalanceCache(roomId) {
  const key = `balance:${roomId}`;
  if (redisAvailable && redisClient) {
    try { await redisClient.del(key); return; } catch { /* fall through */ }
  }
  memDel(key);
}

export async function cacheGet(key) {
  if (redisAvailable && redisClient) {
    try {
      const val = await redisClient.get(key);
      return val ? JSON.parse(val) : null;
    } catch { /* fall through */ }
  }
  return memGet(key);
}

export async function cacheSet(key, value, ttl = 300) {
  if (redisAvailable && redisClient) {
    try {
      await redisClient.setEx(key, ttl, JSON.stringify(value));
      return;
    } catch { /* fall through */ }
  }
  memSet(key, value, ttl);
}

export async function getRedisClient() {
  return redisClient;
}
