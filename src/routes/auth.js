import { query } from '../db/index.js';
import { getMembersByRoom } from '../db/queries/members.js';
import { authRateLimitConfig } from '../middleware/rateLimit.js';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

function generateInviteCode() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

const COLORS = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ef4444','#14b8a6'];

export default async function authRoutes(fastify, options) {

  // ── Create room ───────────────────────────────────────────────────────────
  fastify.post('/rooms', {
    config: { rateLimit: authRateLimitConfig },
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name:       { type: 'string', minLength: 1, maxLength: 100 },
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
    return reply.code(201).send({ room: res.rows[0] });
  });

  // ── Get room by ID ────────────────────────────────────────────────────────
  fastify.get('/rooms/:id', async (request, reply) => {
    const { id } = request.params;
    const res = await query(`SELECT * FROM rooms WHERE id = ?`, [id]);
    if (!res.rows[0]) return reply.code(404).send({ error: 'Room not found' });
    const members = await getMembersByRoom(id);
    return reply.send({ room: res.rows[0], members });
  });

  // ── Get room by invite code ───────────────────────────────────────────────
  fastify.get('/rooms/by-code/:code', async (request, reply) => {
    const { code } = request.params;
    const res = await query(
      `SELECT id, name, invite_code, rent_amount FROM rooms WHERE invite_code = ?`,
      [code.toUpperCase()]
    );
    if (!res.rows[0]) return reply.code(404).send({ error: 'Room not found' });
    return reply.send({ room: res.rows[0] });
  });

  // ── Register (setup profile) — email+password optional for backward compat ──
  fastify.post('/members/setup', {
    config: { rateLimit: authRateLimitConfig },
    schema: {
      body: {
        type: 'object',
        required: ['name', 'upiId'],
        properties: {
          inviteCode:   { type: 'string' },
          name:         { type: 'string', minLength: 1, maxLength: 100 },
          upiId:        { type: 'string', minLength: 3, maxLength: 100 },
          email:        { type: 'string', format: 'email' },
          password:     { type: 'string', minLength: 6 },
          qrCodeBase64: { type: 'string' },
          color:        { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { inviteCode, name, upiId, email, password, qrCodeBase64, color } = request.body;

    // Check email not already used (only if email provided)
    if (email) {
      const emailCheck = await query(`SELECT id FROM members WHERE email = ?`, [email.toLowerCase()]);
      if (emailCheck.rows[0]) {
        return reply.code(400).send({ error: 'An account with this email already exists. Please sign in.' });
      }
    }

    // Find room — required
    if (!inviteCode) {
      return reply.code(400).send({ error: 'Invite code is required to join a room' });
    }
    const roomRes = await query(
      `SELECT * FROM rooms WHERE invite_code = ?`,
      [inviteCode.toUpperCase()]
    );
    if (!roomRes.rows[0]) {
      return reply.code(404).send({ error: 'Invalid invite code' });
    }
    const room = roomRes.rows[0];

    // Check if room is locked
    if (room.is_locked) {
      return reply.code(403).send({ error: 'This room is locked. Ask a roommate to unlock it before joining.' });
    }

    // Hash password (only if provided)
    const passwordHash = password ? await bcrypt.hash(password, 10) : null;

    // Avatar initials + color
    const avatarInitials = name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 3);
    const existingRes = await query(`SELECT COUNT(*) as count FROM members WHERE room_id = ?`, [room.id]);
    const count = parseInt(existingRes.rows[0].count, 10);
    const assignedColor = color || COLORS[count % COLORS.length];

    // Create member
    const memberId = uuidv4();
    await query(
      `INSERT INTO members (id, room_id, name, upi_id, email, password_hash, qr_code_base64, color, avatar_initials)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [memberId, room.id, name.trim(), upiId.trim().toLowerCase(),
       email ? email.toLowerCase() : null, passwordHash, qrCodeBase64 || null, assignedColor, avatarInitials]
    );
    const memberRes = await query(`SELECT * FROM members WHERE id = ?`, [memberId]);
    const member = memberRes.rows[0];

    const token = fastify.jwt.sign(
      { roomId: room.id, memberId: member.id, memberName: member.name, roomName: room.name },
      { expiresIn: '30d' }
    );
    reply.setCookie('token', token, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30,
    });

    return reply.code(201).send({
      token,
      member: { id: member.id, name: member.name, upiId: member.upi_id, email: member.email, color: member.color, avatarInitials: member.avatar_initials },
      room:   { id: room.id, name: room.name, inviteCode: room.invite_code },
    });
  });

  // ── Login with email + password (room code optional) ─────────────────────
  fastify.post('/auth/login', {
    config: { rateLimit: authRateLimitConfig },
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email:      { type: 'string', format: 'email' },
          password:   { type: 'string', minLength: 1 },
          inviteCode: { type: 'string' }, // optional — narrows to specific room
        },
      },
    },
  }, async (request, reply) => {
    const { email, password, inviteCode } = request.body;

    // Find member by email (+ optional room code filter)
    let memberRes;
    if (inviteCode) {
      const roomRes = await query(
        `SELECT id FROM rooms WHERE invite_code = ?`,
        [inviteCode.toUpperCase()]
      );
      if (!roomRes.rows[0]) return reply.code(404).send({ error: 'Invalid room code' });
      memberRes = await query(
        `SELECT m.*, r.name as room_name, r.invite_code FROM members m
         JOIN rooms r ON m.room_id = r.id
         WHERE m.email = ? AND m.room_id = ?`,
        [email.toLowerCase(), roomRes.rows[0].id]
      );
    } else {
      memberRes = await query(
        `SELECT m.*, r.name as room_name, r.invite_code FROM members m
         JOIN rooms r ON m.room_id = r.id
         WHERE m.email = ?`,
        [email.toLowerCase()]
      );
    }

    const member = memberRes.rows[0];
    if (!member) {
      return reply.code(401).send({ error: 'No account found with this email' });
    }

    // Check password
    if (!member.password_hash) {
      return reply.code(401).send({ error: 'This account was created without a password. Use the room code to sign in.' });
    }
    const valid = await bcrypt.compare(password, member.password_hash);
    if (!valid) {
      return reply.code(401).send({ error: 'Incorrect password' });
    }

    const token = fastify.jwt.sign(
      { roomId: member.room_id, memberId: member.id, memberName: member.name, roomName: member.room_name },
      { expiresIn: '30d' }
    );
    reply.setCookie('token', token, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30,
    });

    return reply.send({
      token,
      member: { id: member.id, name: member.name, upiId: member.upi_id, email: member.email, color: member.color, avatarInitials: member.avatar_initials },
      room:   { id: member.room_id, name: member.room_name, inviteCode: member.invite_code },
    });
  });

  // ── Legacy join (room code + pick member) — kept for backward compat ──────
  fastify.post('/auth/join', {
    config: { rateLimit: authRateLimitConfig },
    schema: {
      body: {
        type: 'object',
        required: ['inviteCode', 'memberId'],
        properties: {
          inviteCode: { type: 'string' },
          memberId:   { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { inviteCode, memberId } = request.body;
    const roomRes = await query(`SELECT * FROM rooms WHERE invite_code = ?`, [inviteCode.toUpperCase()]);
    if (!roomRes.rows[0]) return reply.code(404).send({ error: 'Invalid invite code' });
    const room = roomRes.rows[0];
    const memberRes = await query(`SELECT * FROM members WHERE id = ? AND room_id = ?`, [memberId, room.id]);
    if (!memberRes.rows[0]) return reply.code(403).send({ error: 'Member not found in this room' });
    const member = memberRes.rows[0];

    const token = fastify.jwt.sign(
      { roomId: room.id, memberId: member.id, memberName: member.name, roomName: room.name },
      { expiresIn: '30d' }
    );
    reply.setCookie('token', token, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30,
    });
    return reply.send({
      token,
      member: { id: member.id, name: member.name, upiId: member.upi_id, color: member.color, avatarInitials: member.avatar_initials },
      room:   { id: room.id, name: room.name, inviteCode: room.invite_code },
    });
  });

  // ── Logout ────────────────────────────────────────────────────────────────
  fastify.post('/auth/logout', async (request, reply) => {
    reply.clearCookie('token', { path: '/' });
    return reply.send({ success: true });
  });

  // ── Me ────────────────────────────────────────────────────────────────────
  fastify.get('/auth/me', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { roomId, memberId } = request.user;
    const [roomRes, memberRes] = await Promise.all([
      query(`SELECT id, name, invite_code, rent_amount FROM rooms WHERE id = ?`, [roomId]),
      query(`SELECT id, name, upi_id, email, color, avatar_initials FROM members WHERE id = ?`, [memberId]),
    ]);
    return reply.send({ room: roomRes.rows[0], member: memberRes.rows[0] });
  });
}
