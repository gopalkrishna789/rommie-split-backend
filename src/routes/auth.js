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
    // Return constructed object — skip the SELECT round-trip
    return reply.code(201).send({
      room: { id, name: name.trim(), invite_code: inviteCode, rent_amount: rentAmount, is_locked: false, created_at: new Date().toISOString() }
    });
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
          photoBase64:  { type: 'string' },
          color:        { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { inviteCode, name, upiId, email, password, qrCodeBase64, photoBase64, color } = request.body;

    // Find room and check email in parallel
    if (!inviteCode) {
      return reply.code(400).send({ error: 'Invite code is required to join a room' });
    }

    const [roomRes, emailCheck] = await Promise.all([
      query(`SELECT * FROM rooms WHERE invite_code = ?`, [inviteCode.toUpperCase()]),
      email ? query(`SELECT id FROM members WHERE email = ?`, [email.toLowerCase()]) : Promise.resolve({ rows: [] }),
    ]);

    if (emailCheck.rows[0]) {
      return reply.code(400).send({ error: 'An account with this email already exists. Please sign in.' });
    }
    if (!roomRes.rows[0]) {
      return reply.code(404).send({ error: 'Invalid invite code' });
    }
    const room = roomRes.rows[0];

    // Check if room is locked
    if (room.is_locked) {
      return reply.code(403).send({ error: 'This room is locked. Ask a roommate to unlock it before joining.' });
    }

    // Hash password and count members in parallel
    const [passwordHash, existingRes] = await Promise.all([
      password ? bcrypt.hash(password, 10) : Promise.resolve(null),
      query(`SELECT COUNT(*) as count FROM members WHERE room_id = ?`, [room.id]),
    ]);

    // Avatar initials + color
    const avatarInitials = name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 3);
    const count = parseInt(existingRes.rows[0].count, 10);
    const assignedColor = color || COLORS[count % COLORS.length];

    // Create member — return constructed object, skip SELECT
    const memberId = uuidv4();
    await query(
      `INSERT INTO members (id, room_id, name, upi_id, email, password_hash, qr_code_base64, photo_base64, color, avatar_initials)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [memberId, room.id, name.trim(), upiId.trim().toLowerCase(),
       email ? email.toLowerCase() : null, passwordHash, qrCodeBase64 || null, photoBase64 || null, assignedColor, avatarInitials]
    );

    // Register in user_rooms for multi-room support
    if (email) {
      const urId = uuidv4();
      await query(
        `INSERT OR IGNORE INTO user_rooms (id, email, room_id, member_id) VALUES (?, ?, ?, ?)`,
        [urId, email.toLowerCase(), room.id, memberId]
      );
    }

    const member = {
      id: memberId,
      room_id: room.id,
      name: name.trim(),
      upi_id: upiId.trim().toLowerCase(),
      email: email ? email.toLowerCase() : null,
      color: assignedColor,
      avatar_initials: avatarInitials,
      tour_completed: false,
    };

    const token = fastify.jwt.sign(
      { roomId: room.id, memberId: member.id, memberName: member.name, roomName: room.name },
      { expiresIn: '30d' }
    );
    reply.setCookie('token', token, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30,
    });

    // Send welcome email (async, don't wait)
    if (email) {
      const { sendWelcomeEmail } = await import('../services/emailService.js');
      const roommates = await getMembersByRoom(room.id);
      const otherRoommates = roommates.filter(m => m.id !== member.id);
      
      sendWelcomeEmail({
        toEmail: email,
        toName: member.name,
        roomName: room.name,
        roomCode: room.invite_code,
        roommates: otherRoommates,
      }).catch(err => console.error('Welcome email error:', err.message));
    }

    return reply.code(201).send({
      token,
      member: { id: member.id, name: member.name, upiId: member.upi_id, email: member.email, color: member.color, avatarInitials: member.avatar_initials, tour_completed: member.tour_completed || false },
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
      member: { id: member.id, name: member.name, upiId: member.upi_id, email: member.email, color: member.color, avatarInitials: member.avatar_initials, tour_completed: member.tour_completed },
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
      member: { id: member.id, name: member.name, upiId: member.upi_id, color: member.color, avatarInitials: member.avatar_initials, tour_completed: member.tour_completed || false },
      room:   { id: room.id, name: room.name, inviteCode: room.invite_code },
    });
  });

  // ── Forgot Password ───────────────────────────────────────────────────────
  fastify.post('/auth/forgot-password', {
    config: { rateLimit: authRateLimitConfig },
    schema: {
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' },
        },
      },
    },
  }, async (request, reply) => {
    const { email } = request.body;

    const memberRes = await query(
      `SELECT id, name, email FROM members WHERE email = ?`,
      [email.toLowerCase()]
    );
    const member = memberRes.rows[0];

    // Always return success to avoid email enumeration
    if (!member || !member.email) {
      return reply.send({ success: true, message: 'If that email exists, a reset link has been sent.' });
    }

    // Generate a secure token
    const crypto = await import('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await query(
      `UPDATE members SET reset_token = ?, reset_token_expires = ? WHERE id = ?`,
      [token, expires.toISOString(), member.id]
    );

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

    const { sendPasswordResetEmail } = await import('../services/emailService.js');
    sendPasswordResetEmail({
      toEmail: member.email,
      toName: member.name,
      resetUrl,
    }).catch(err => console.error('Reset email error:', err.message));

    return reply.send({ success: true, message: 'If that email exists, a reset link has been sent.' });
  });

  // ── Reset Password ────────────────────────────────────────────────────────
  fastify.post('/auth/reset-password', {
    config: { rateLimit: authRateLimitConfig },
    schema: {
      body: {
        type: 'object',
        required: ['token', 'newPassword'],
        properties: {
          token:       { type: 'string' },
          newPassword: { type: 'string', minLength: 6 },
        },
      },
    },
  }, async (request, reply) => {
    const { token, newPassword } = request.body;

    const memberRes = await query(
      `SELECT id, reset_token, reset_token_expires FROM members WHERE reset_token = ?`,
      [token]
    );
    const member = memberRes.rows[0];

    if (!member) {
      return reply.code(400).send({ error: 'Invalid or expired reset link.' });
    }

    const expires = new Date(member.reset_token_expires);
    if (expires < new Date()) {
      return reply.code(400).send({ error: 'This reset link has expired. Please request a new one.' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await query(
      `UPDATE members SET password_hash = ?, reset_token = ?, reset_token_expires = ? WHERE id = ?`,
      [newHash, null, null, member.id]
    );

    return reply.send({ success: true, message: 'Password reset successfully. You can now sign in.' });
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
      query(`SELECT id, name, upi_id, email, color, avatar_initials, tour_completed FROM members WHERE id = ?`, [memberId]),
    ]);
    return reply.send({ room: roomRes.rows[0], member: memberRes.rows[0] });
  });

  // ── Update Password ───────────────────────────────────────────────────────
  fastify.post('/members/update-password', {
    preHandler: [fastify.authenticate],
    config: { rateLimit: authRateLimitConfig },
    schema: {
      body: {
        type: 'object',
        required: ['newPassword'],
        properties: {
          currentPassword: { type: 'string' },
          newPassword: { type: 'string', minLength: 6 },
        },
      },
    },
  }, async (request, reply) => {
    const { currentPassword, newPassword } = request.body;
    const { memberId } = request.user;

    // Get current member
    const memberRes = await query(
      `SELECT id, password_hash FROM members WHERE id = ?`,
      [memberId]
    );
    const member = memberRes.rows[0];
    
    if (!member) {
      return reply.code(404).send({ error: 'Member not found' });
    }

    // If member has a password, verify current password
    if (member.password_hash) {
      if (!currentPassword) {
        return reply.code(400).send({ error: 'Current password is required' });
      }
      const valid = await bcrypt.compare(currentPassword, member.password_hash);
      if (!valid) {
        return reply.code(401).send({ error: 'Current password is incorrect' });
      }
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // Update password
    await query(
      `UPDATE members SET password_hash = ? WHERE id = ?`,
      [newPasswordHash, memberId]
    );

    return reply.send({ 
      success: true, 
      message: member.password_hash 
        ? 'Password updated successfully' 
        : 'Password set successfully. You can now sign in with email and password.' 
    });
  });

  // ── Get all rooms for the current user (multi-room) ───────────────────────
  fastify.get('/auth/my-rooms', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { memberId } = request.user;

    // Get the current member's email
    const memberRes = await query(
      `SELECT id, email FROM members WHERE id = ?`,
      [memberId]
    );
    const currentMember = memberRes.rows[0];
    if (!currentMember?.email) {
      // No email — can only be in one room
      const singleRes = await query(
        `SELECT r.id, r.name, r.invite_code, r.is_locked, m.id as member_id, m.name as member_name, m.color, m.avatar_initials
         FROM members m JOIN rooms r ON m.room_id = r.id WHERE m.id = ?`,
        [memberId]
      );
      const row = singleRes.rows[0];
      if (!row) return reply.send({ rooms: [] });
      return reply.send({
        rooms: [{
          id: row.id, name: row.name, inviteCode: row.invite_code, isLocked: !!row.is_locked,
          memberId: row.member_id, memberName: row.member_name, color: row.color, avatarInitials: row.avatar_initials,
        }],
      });
    }

    // Get all rooms this email belongs to
    const res = await query(
      `SELECT r.id, r.name, r.invite_code, r.is_locked,
              ur.member_id, m.name as member_name, m.color, m.avatar_initials
       FROM user_rooms ur
       JOIN rooms r ON ur.room_id = r.id
       JOIN members m ON ur.member_id = m.id
       WHERE ur.email = ?
       ORDER BY ur.joined_at ASC`,
      [currentMember.email]
    );

    const rooms = res.rows.map((row) => ({
      id: row.id,
      name: row.name,
      inviteCode: row.invite_code,
      isLocked: !!row.is_locked,
      memberId: row.member_id,
      memberName: row.member_name,
      color: row.color,
      avatarInitials: row.avatar_initials,
    }));

    return reply.send({ rooms });
  });

  // ── Switch active room ────────────────────────────────────────────────────
  fastify.post('/auth/switch-room', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['roomId'],
        properties: {
          roomId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { roomId: targetRoomId } = request.body;
    const { memberId } = request.user;

    // Get current member's email
    const memberRes = await query(`SELECT email FROM members WHERE id = ?`, [memberId]);
    const email = memberRes.rows[0]?.email;

    // Find the member record for this email in the target room
    let targetMemberRes;
    if (email) {
      targetMemberRes = await query(
        `SELECT m.*, r.name as room_name, r.invite_code
         FROM user_rooms ur
         JOIN members m ON ur.member_id = m.id
         JOIN rooms r ON ur.room_id = r.id
         WHERE ur.email = ? AND ur.room_id = ?`,
        [email, targetRoomId]
      );
    } else {
      // Fallback: check if current member is in target room
      targetMemberRes = await query(
        `SELECT m.*, r.name as room_name, r.invite_code
         FROM members m JOIN rooms r ON m.room_id = r.id
         WHERE m.id = ? AND m.room_id = ?`,
        [memberId, targetRoomId]
      );
    }

    const targetMember = targetMemberRes.rows[0];
    if (!targetMember) {
      return reply.code(403).send({ error: 'You are not a member of that room' });
    }

    // Issue new token for the target room
    const newToken = fastify.jwt.sign(
      { roomId: targetRoomId, memberId: targetMember.id, memberName: targetMember.name, roomName: targetMember.room_name },
      { expiresIn: '30d' }
    );
    reply.setCookie('token', newToken, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30,
    });

    return reply.send({
      token: newToken,
      member: {
        id: targetMember.id, name: targetMember.name, upiId: targetMember.upi_id,
        email: targetMember.email, color: targetMember.color,
        avatarInitials: targetMember.avatar_initials, tour_completed: targetMember.tour_completed,
      },
      room: { id: targetRoomId, name: targetMember.room_name, inviteCode: targetMember.invite_code },
    });
  });

  // ── Join an additional room (for existing logged-in users) ────────────────
  fastify.post('/auth/join-room', {
    preHandler: [fastify.authenticate],
    config: { rateLimit: authRateLimitConfig },
    schema: {
      body: {
        type: 'object',
        required: ['inviteCode', 'name', 'upiId'],
        properties: {
          inviteCode:   { type: 'string' },
          name:         { type: 'string', minLength: 1, maxLength: 100 },
          upiId:        { type: 'string', minLength: 3, maxLength: 100 },
          qrCodeBase64: { type: 'string' },
          color:        { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { inviteCode, name, upiId, qrCodeBase64, color } = request.body;
    const { memberId: currentMemberId } = request.user;

    // Get current member's email
    const currentMemberRes = await query(`SELECT email FROM members WHERE id = ?`, [currentMemberId]);
    const email = currentMemberRes.rows[0]?.email;

    // Find the room
    const roomRes = await query(`SELECT * FROM rooms WHERE invite_code = ?`, [inviteCode.toUpperCase()]);
    if (!roomRes.rows[0]) return reply.code(404).send({ error: 'Invalid invite code' });
    const room = roomRes.rows[0];
    if (room.is_locked) return reply.code(403).send({ error: 'This room is locked' });

    // Check if already in this room
    if (email) {
      const existingRes = await query(
        `SELECT id FROM user_rooms WHERE email = ? AND room_id = ?`,
        [email, room.id]
      );
      if (existingRes.rows[0]) return reply.code(400).send({ error: 'You are already in this room' });
    }

    // Create new member record for this room
    const existingRes = await query(`SELECT COUNT(*) as count FROM members WHERE room_id = ?`, [room.id]);
    const count = parseInt(existingRes.rows[0].count, 10);
    const avatarInitials = name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 3);
    const assignedColor = color || COLORS[count % COLORS.length];
    const newMemberId = uuidv4();

    // Get password hash from current member
    const pwRes = await query(`SELECT password_hash FROM members WHERE id = ?`, [currentMemberId]);
    const passwordHash = pwRes.rows[0]?.password_hash;

    await query(
      `INSERT INTO members (id, room_id, name, upi_id, email, password_hash, qr_code_base64, color, avatar_initials)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newMemberId, room.id, name.trim(), upiId.trim().toLowerCase(),
       email || null, passwordHash || null, qrCodeBase64 || null, assignedColor, avatarInitials]
    );

    // Register in user_rooms
    if (email) {
      const urId = uuidv4();
      await query(
        `INSERT OR IGNORE INTO user_rooms (id, email, room_id, member_id) VALUES (?, ?, ?, ?)`,
        [urId, email, room.id, newMemberId]
      );
    }

    // Issue new token for the new room
    const newToken = fastify.jwt.sign(
      { roomId: room.id, memberId: newMemberId, memberName: name.trim(), roomName: room.name },
      { expiresIn: '30d' }
    );
    reply.setCookie('token', newToken, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30,
    });

    return reply.code(201).send({
      token: newToken,
      member: { id: newMemberId, name: name.trim(), upiId: upiId.trim().toLowerCase(), email, color: assignedColor, avatarInitials },
      room: { id: room.id, name: room.name, inviteCode: room.invite_code },
    });
  });
}
