import 'dotenv/config';
import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';

import { initSocket } from './socket/index.js';
import { rateLimitConfig } from './middleware/rateLimit.js';

import authRoutes from './routes/auth.js';
import memberRoutes from './routes/members.js';
import expenseRoutes from './routes/expenses.js';
import notificationRoutes from './routes/notifications.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
    },
    trustProxy: true,
  });

  // ── Plugins ──────────────────────────────────────────────────────────────
  await fastify.register(fastifyCors, {
    origin: [FRONTEND_URL, 'http://localhost:5173', 'http://localhost:4173'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  await fastify.register(fastifyCookie, {
    secret: process.env.JWT_SECRET || 'cookie-secret-change-me',
  });

  await fastify.register(fastifyJwt, {
    secret: process.env.JWT_SECRET || 'jwt-secret-change-me',
    cookie: {
      cookieName: 'token',
      signed: false,
    },
  });

  await fastify.register(fastifyRateLimit, rateLimitConfig);

  // ── Auth decorator ────────────────────────────────────────────────────────
  fastify.decorate('authenticate', async function (request, reply) {
    try {
      const cookieToken = request.cookies?.token;
      const headerToken = request.headers.authorization?.replace('Bearer ', '');
      const token = cookieToken || headerToken;

      if (!token) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      request.user = fastify.jwt.verify(token);
    } catch (err) {
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }
  });

  // ── Health check ──────────────────────────────────────────────────────────
  fastify.get('/health', async (request, reply) => {
    return reply.send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      db: 'sqlite',
    });
  });

  // ── API Routes ────────────────────────────────────────────────────────────
  await fastify.register(authRoutes, { prefix: '/api' });
  await fastify.register(memberRoutes, { prefix: '/api' });
  await fastify.register(expenseRoutes, { prefix: '/api' });
  await fastify.register(notificationRoutes, { prefix: '/api' });

  // ── 404 handler (skip socket.io paths) ───────────────────────────────────
  fastify.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/socket.io')) return; // let Socket.io handle it
    reply.code(404).send({ error: `Route ${request.method} ${request.url} not found` });
  });

  // ── Error handler ─────────────────────────────────────────────────────────
  fastify.setErrorHandler((error, request, reply) => {
    fastify.log.error(error);
    const statusCode = error.statusCode || 500;
    reply.code(statusCode).send({
      error: error.message || 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
    });
  });

  return fastify;
}

async function start() {
  try {
    const fastify = await buildApp();

    // Attach Socket.io to Fastify's underlying Node.js HTTP server
    // Must be done BEFORE fastify.listen()
    initSocket(fastify.server, FRONTEND_URL);

    // Start listening
    await fastify.listen({ port: PORT, host: '0.0.0.0' });

    console.log(`\n🚀 Roomie Split server running!`);
    console.log(`   API:      http://localhost:${PORT}/api`);
    console.log(`   Health:   http://localhost:${PORT}/health`);
    console.log(`   Frontend: ${FRONTEND_URL}`);
    console.log(`   DB:       SQLite (local dev)`);
    console.log(`   Cache:    In-memory (Redis optional)\n`);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
