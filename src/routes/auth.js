import { query } from '../db/index.js';
import { getMembersByRoom } from '../db/queries/members.js';
import { authRateLimitConfig } from '../middleware/rateLimit.js';
import { v4 as uuidv4 } from 'uuid';

function generateInviteCode() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

export default async function authRoutes(fastify, options) {
  // ── Create a new room ────────────────────────────────────────────────────
  fastify.post('/rooms', {
    config: { rateLimit: authRateLimitConfig },
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          rentAmount: { type: 'integer', minimum: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const { name, rentAmount = 450000 } = request.body;
    const id = uuidv4();
    const inviteCode = generateInviteCode();

    await query(
      `INSERT INTO rooms (id, name, invite_code, rent_amount) VALUES (?, ?, ?, ?)`,
      [id, name.trim(), inviteCode, rentAmount]
    );
    const res = await query(`SELECT * FROM rooms WHERE id = ?`, [id]);
    const room = res.rows[0];
    return reply.code(201).send({ room });
  });

  // ── Get room by ID ────────────────────────────────────────────────────────
  fastify.get('/rooms/:id', async (request, reply) => {
    const { id } = request.params;
    const res = await query(`SELECT * FROM rooms WHERE id = ?`, [id]);
    if (!res.rows[0]) return reply.code(404).send({ error: 'Room not found' });
    const members = await getMembersByRoom(id);
    return reply.send({ room: res.rows[0], members });
  });

  // ── Get room by invite code (public — used during setup) ─────────────────
  fastify.get('/rooms/by-code/:code', async (request, reply) => {
    const { code } = request.params;
    const res = await query(
      `SELECT id, name, invite_code, rent_amount FROM rooms WHERE invite_code = ?`,
      [code.toUpperCase()]
    );
    if (!res.rows[0]) return reply.code(404).send({ error: 'Room not found' });
    return reply.send({ room: res.rows[0] });
  });

  // ── Public member setup — create member + return JWT in one step ──────────
  fastify.post('/members/setup', {
    config: { rateLimit: authRateLimitConfig },
    schema: {
      body: {
        type: 'object',
        required: ['inviteCode', 'name', 'upiId'],
        properties: {
          inviteCode: { type: 'string' },
          name: { type: 'string', minLength: 1, maxLength: 100 },
          upiId: { type: 'string', minLength: 3, maxLength: 100 },
          qrCodeBase64: { type: 'string' },
          color: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { inviteCode, name, upiId, qrCodeBase64, color } = request.body;

    // Find room
    const roomRes = await query(
      `SELECT * FROM rooms WHERE invite_code = ?`,
      [inviteCode.toUpperCase()]
    );
    if (!roomRes.rows[0]) {
      return reply.code(404).send({ error: 'Invalid invite code' });
    }
    const room = roomRes.rows[0];

    // Generate avatar initials and color
    const avatarInitials = name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 3);

    const COLORS = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ef4444','#14b8a6'];
    const existingRes = await query(`SELECT COUNT(*) as count FROM members WHERE room_id = ?`, [room.id]);
    const count = parseInt(existingRes.rows[0].count, 10);
    const assignedColor = color || COLORS[count % COLORS.length];

    // Create member
    const memberId = uuidv4();
    await query(
      `INSERT INTO members (id, room_id, name, upi_id, qr_code_base64, color, avatar_initials)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [memberId, room.id, name.trim(), upiId.trim().toLowerCase(), qrCodeBase64 || null, assignedColor, avatarInitials]
    );
    const memberRes = await query(`SELECT * FROM members WHERE id = ?`, [memberId]);
    const member = memberRes.rows[0];

    // Sign JWT
    const token = fastify.jwt.sign(
      { roomId: room.id, memberId: member.id, memberName: member.name, roomName: room.name },
      { expiresIn: '30d' }
    );

    reply.setCookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });

    return reply.code(201).send({
      token,
      member: {
        id: member.id,
        name: member.name,
        upiId: member.upi_id,
        color: member.color,
        avatarInitials: member.avatar_initials,
      },
      room: {
        id: room.id,
        name: room.name,
        inviteCode: room.invite_code,
      },
    });
  });

  // ── Join room with invite code → get JWT ──────────────────────────────────
  fastify.post('/auth/join', {
    config: { rateLimit: authRateLimitConfig },
    schema: {
      body: {
        type: 'object',
        required: ['inviteCode', 'memberId'],
        properties: {
          inviteCode: { type: 'string' },
          memberId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { inviteCode, memberId } = request.body;

    const roomRes = await query(
      `SELECT * FROM rooms WHERE invite_code = ?`,
      [inviteCode.toUpperCase()]
    );
    if (!roomRes.rows[0]) {
      return reply.code(404).send({ error: 'Invalid invite code' });
    }
    const room = roomRes.rows[0];

    const memberRes = await query(
      `SELECT * FROM members WHERE id = ? AND room_id = ?`,
      [memberId, room.id]
    );
    if (!memberRes.rows[0]) {
      return reply.code(403).send({ error: 'Member not found in this room' });
    }
    const member = memberRes.rows[0];

    const token = fastify.jwt.sign(
      { roomId: room.id, memberId: member.id, memberName: member.name, roomName: room.name },
      { expiresIn: '30d' }
    );

    reply.setCookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });

    return reply.send({
      token,
      member: {
        id: member.id,
        name: member.name,
        upiId: member.upi_id,
        color: member.color,
        avatarInitials: member.avatar_initials,
      },
      room: {
        id: room.id,
        name: room.name,
        inviteCode: room.invite_code,
      },
    });
  });

  // ── Logout ────────────────────────────────────────────────────────────────
  fastify.post('/auth/logout', async (request, reply) => {
    reply.clearCookie('token', { path: '/' });
    return reply.send({ success: true });
  });

  // ── Get current session info ──────────────────────────────────────────────
  fastify.get('/auth/me', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { roomId, memberId } = request.user;
    const [roomRes, memberRes] = await Promise.all([
      query(`SELECT id, name, invite_code, rent_amount FROM rooms WHERE id = ?`, [roomId]),
      query(`SELECT id, name, upi_id, color, avatar_initials FROM members WHERE id = ?`, [memberId]),
    ]);
    return reply.send({
      room: roomRes.rows[0],
      member: memberRes.rows[0],
    });
  });
}
