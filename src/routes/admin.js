import { query } from '../db/index.js';

export default async function adminRoutes(fastify, options) {
  
  // ── Clear all data (for testing only) ────────────────────────────────────
  fastify.post('/clear-database', async (request, reply) => {
    const { secret } = request.body;
    
    // Simple secret key protection
    const ADMIN_SECRET = process.env.ADMIN_SECRET || 'delete-all-data-2026';
    
    if (secret !== ADMIN_SECRET) {
      return reply.code(403).send({ error: 'Invalid secret key' });
    }
    
    try {
      // Delete in correct order (respecting foreign keys)
      await query('DELETE FROM payment_attempts');
      await query('DELETE FROM activity_log');
      await query('DELETE FROM splits');
      await query('DELETE FROM expenses');
      await query('DELETE FROM members');
      await query('DELETE FROM rooms');
      await query('VACUUM');
      
      // Get counts to verify
      const counts = await Promise.all([
        query('SELECT COUNT(*) as count FROM rooms'),
        query('SELECT COUNT(*) as count FROM members'),
        query('SELECT COUNT(*) as count FROM expenses'),
        query('SELECT COUNT(*) as count FROM splits'),
        query('SELECT COUNT(*) as count FROM payment_attempts'),
        query('SELECT COUNT(*) as count FROM activity_log'),
      ]);
      
      return reply.send({
        success: true,
        message: 'All data deleted successfully',
        counts: {
          rooms: counts[0].rows[0].count,
          members: counts[1].rows[0].count,
          expenses: counts[2].rows[0].count,
          splits: counts[3].rows[0].count,
          payment_attempts: counts[4].rows[0].count,
          activity_log: counts[5].rows[0].count,
        }
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Failed to clear database', details: error.message });
    }
  });
  
  // ── Get database stats ────────────────────────────────────────────────────
  fastify.get('/database-stats', async (request, reply) => {
    try {
      const counts = await Promise.all([
        query('SELECT COUNT(*) as count FROM rooms'),
        query('SELECT COUNT(*) as count FROM members'),
        query('SELECT COUNT(*) as count FROM expenses'),
        query('SELECT COUNT(*) as count FROM splits'),
        query('SELECT COUNT(*) as count FROM payment_attempts'),
        query('SELECT COUNT(*) as count FROM activity_log'),
      ]);
      
      return reply.send({
        rooms: counts[0].rows[0].count,
        members: counts[1].rows[0].count,
        expenses: counts[2].rows[0].count,
        splits: counts[3].rows[0].count,
        payment_attempts: counts[4].rows[0].count,
        activity_log: counts[5].rows[0].count,
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Failed to get stats', details: error.message });
    }
  });

  // ── Get all members with email status ─────────────────────────────────────
  fastify.get('/members-emails', async (request, reply) => {
    try {
      const result = await query(`
        SELECT m.id, m.name, m.email, r.name as room_name, r.id as room_id
        FROM members m
        JOIN rooms r ON m.room_id = r.id
        ORDER BY r.name, m.name
      `);
      
      const members = result.rows.map(m => ({
        id: m.id,
        name: m.name,
        email: m.email || null,
        hasEmail: !!m.email,
        roomName: m.room_name,
        roomId: m.room_id,
      }));
      
      return reply.send({
        members,
        summary: {
          total: members.length,
          withEmail: members.filter(m => m.hasEmail).length,
          withoutEmail: members.filter(m => !m.hasEmail).length,
        }
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Failed to get members', details: error.message });
    }
  });

  // ── Update member email (admin only) ──────────────────────────────────────
  fastify.post('/update-member-email', async (request, reply) => {
    const { secret, memberId, email } = request.body;
    
    // Simple secret key protection
    const ADMIN_SECRET = process.env.ADMIN_SECRET || 'delete-all-data-2026';
    
    if (secret !== ADMIN_SECRET) {
      return reply.code(403).send({ error: 'Invalid secret key' });
    }
    
    if (!memberId || !email) {
      return reply.code(400).send({ error: 'memberId and email are required' });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return reply.code(400).send({ error: 'Invalid email format' });
    }
    
    try {
      await query('UPDATE members SET email = ? WHERE id = ?', [email, memberId]);
      
      const result = await query('SELECT id, name, email FROM members WHERE id = ?', [memberId]);
      
      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Member not found' });
      }
      
      return reply.send({
        success: true,
        message: 'Email updated successfully',
        member: result.rows[0],
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Failed to update email', details: error.message });
    }
  });

  // ── Get all unpaid splits ─────────────────────────────────────────────────
  fastify.get('/unpaid-splits', async (request, reply) => {
    try {
      const result = await query(`
        SELECT s.*, e.purpose, e.date, e.total_amount,
               m.name as member_name, m.email as member_email,
               p.name as payer_name, p.upi_id as payer_upi_id,
               r.name as room_name
        FROM splits s
        JOIN expenses e ON s.expense_id = e.id
        JOIN members m ON s.member_id = m.id
        JOIN members p ON e.payer_id = p.id
        JOIN rooms r ON e.room_id = r.id
        WHERE s.paid = 0 AND e.payer_id != s.member_id
        ORDER BY e.date DESC
      `);
      
      return reply.send({
        splits: result.rows,
        count: result.rows.length,
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Failed to get unpaid splits', details: error.message });
    }
  });

  // ── Send reminder email to a member ───────────────────────────────────────
  fastify.post('/send-reminder', async (request, reply) => {
    const { secret, memberId, email, splits } = request.body;
    
    // Simple secret key protection
    const ADMIN_SECRET = process.env.ADMIN_SECRET || 'delete-all-data-2026';
    
    if (secret !== ADMIN_SECRET) {
      return reply.code(403).send({ error: 'Invalid secret key' });
    }
    
    if (!memberId || !email || !splits || splits.length === 0) {
      return reply.code(400).send({ error: 'memberId, email, and splits are required' });
    }
    
    try {
      // Import email service
      const { sendBulkPaymentReminderEmail } = await import('../services/emailService.js');
      
      // Get member details
      const memberResult = await query('SELECT * FROM members WHERE id = ?', [memberId]);
      const member = memberResult.rows[0];
      
      if (!member) {
        return reply.code(404).send({ error: 'Member not found' });
      }
      
      // Get room details
      const roomResult = await query('SELECT * FROM rooms WHERE id = ?', [member.room_id]);
      const room = roomResult.rows[0];
      
      // Calculate total owed
      const totalOwed = splits.reduce((sum, s) => sum + s.share + (s.carry_forward || 0), 0);
      
      // Send email
      await sendBulkPaymentReminderEmail({
        toEmail: email,
        toName: member.name,
        roomName: room?.name || 'your room',
        totalOwed,
        splits,
      });
      
      return reply.send({
        success: true,
        message: 'Reminder email sent',
        member: member.name,
        email,
        totalOwed,
        splitsCount: splits.length,
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Failed to send reminder', details: error.message });
    }
  });
}
