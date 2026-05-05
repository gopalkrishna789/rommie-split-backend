import 'dotenv/config';
import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';

import { initSocket } from './socket/index.js';
import { rateLimitConfig } from './middleware/rateLimit.js';
import { startScheduler } from './services/schedulerService.js';

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

  // ── UPI Pay redirect (used in emails — Gmail blocks custom schemes) ──────
  // This HTTPS endpoint redirects to the UPI deep link on the device.
  // Gmail allows HTTPS links, so this is the only reliable way.
  fastify.get('/pay', async (request, reply) => {
    const { pa, pn, am, tn, app } = request.query;

    if (!pa || !am) {
      return reply.code(400).send('Missing payment parameters');
    }

    const upiParams = `pa=${pa}&pn=${pn || ''}&am=${am}&cu=INR&tn=${tn || ''}`;

    // Build app-specific deep link
    let deepLink;
    switch (app) {
      case 'phonepe':
        deepLink = `phonepe://pay?${upiParams}`;
        break;
      case 'gpay':
        deepLink = `gpay://upi/pay?${upiParams}`;
        break;
      case 'paytm':
        deepLink = `paytmmp://pay?${upiParams}`;
        break;
      default:
        deepLink = `upi://pay?${upiParams}`;
    }

    const amountDisplay = `\u20B9${parseFloat(am).toLocaleString('en-IN')}`;
    const payerName = decodeURIComponent(pn || pa);
    const purposeText = tn ? decodeURIComponent(tn).replace('RoomieSplit: ', '') : 'expense';

    // Return an HTML page that auto-redirects to the UPI app
    // Works in Android Chrome/Gmail app — tapping opens the UPI app
    return reply.type('text/html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Pay ${amountDisplay} via Roomie Split</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      background: linear-gradient(135deg, #4f46e5, #7c3aed);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #fff;
      border-radius: 24px;
      padding: 36px 28px;
      max-width: 380px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.2);
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 28px; font-weight: 800; color: #111827; margin-bottom: 6px; }
    .sub { font-size: 14px; color: #6b7280; margin-bottom: 28px; }
    .upi-id {
      background: #f3f4f6;
      border-radius: 10px;
      padding: 10px 16px;
      font-family: monospace;
      font-size: 14px;
      color: #374151;
      margin-bottom: 28px;
      word-break: break-all;
    }
    .btn {
      display: block;
      width: 100%;
      padding: 16px;
      border-radius: 14px;
      font-size: 16px;
      font-weight: 700;
      text-decoration: none;
      color: #fff;
      margin-bottom: 12px;
      cursor: pointer;
      border: none;
    }
    .btn-phonepe { background: #5f259f; }
    .btn-gpay    { background: #1a73e8; }
    .btn-upi     { background: #4f46e5; }
    .note {
      font-size: 12px;
      color: #9ca3af;
      margin-top: 16px;
      line-height: 1.5;
    }
    .redirecting {
      font-size: 13px;
      color: #6366f1;
      margin-top: 12px;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">💸</div>
    <h1>${amountDisplay}</h1>
    <p class="sub">Pay <strong>${payerName}</strong> for <strong>${purposeText}</strong></p>
    <div class="upi-id">UPI: ${decodeURIComponent(pa)}</div>

    <a href="phonepe://pay?${upiParams}" class="btn btn-phonepe">
      💜 Pay with PhonePe
    </a>
    <a href="gpay://upi/pay?${upiParams}" class="btn btn-gpay">
      🔵 Pay with Google Pay
    </a>
    <a href="upi://pay?${upiParams}" class="btn btn-upi">
      📱 Pay with Any UPI App
    </a>

    <p class="note">
      Tap a button above to open your UPI app.<br/>
      Amount <strong>${amountDisplay}</strong> will be pre-filled.
    </p>
  </div>

  <script>
    // Auto-launch the preferred app after a short delay
    setTimeout(() => {
      window.location.href = "${deepLink}";
    }, 800);
  </script>
</body>
</html>`);
  });
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

    // Start background scheduler
    startScheduler();

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
