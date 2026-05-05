import { Server } from 'socket.io';

let io = null;

/**
 * Initialize Socket.io with the HTTP server
 * @param {import('http').Server} httpServer
 * @param {string} frontendUrl
 */
export function initSocket(httpServer, frontendUrl) {
  io = new Server(httpServer, {
    cors: {
      origin: frontendUrl || 'http://localhost:5173',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Client sends { roomId } to join their room channel
    socket.on('join:room', ({ roomId }) => {
      if (!roomId) return;
      socket.join(`room:${roomId}`);
      console.log(`Socket ${socket.id} joined room:${roomId}`);
    });

    socket.on('leave:room', ({ roomId }) => {
      socket.leave(`room:${roomId}`);
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });

  return io;
}

/**
 * Get the Socket.io instance (after init)
 */
export function getIO() {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
}

/**
 * Emit expense:added to all room members
 */
export function emitExpenseAdded(roomId, data) {
  if (!io) return;
  io.to(`room:${roomId}`).emit('expense:added', data);
}

/**
 * Emit split:paid to all room members
 */
export function emitSplitPaid(roomId, data) {
  if (!io) return;
  io.to(`room:${roomId}`).emit('split:paid', data);
}

/**
 * Emit balance:updated to all room members
 */
export function emitBalanceUpdated(roomId, data) {
  if (!io) return;
  io.to(`room:${roomId}`).emit('balance:updated', data);
}

/**
 * Generic emit to all members in a room
 */
export function emitToRoom(roomId, event, data) {
  if (!io) return;
  io.to(`room:${roomId}`).emit(event, data);
}

export function emitExpenseUpdated(roomId, data) {
  if (!io) return;
  io.to(`room:${roomId}`).emit('expense:updated', data);
}
