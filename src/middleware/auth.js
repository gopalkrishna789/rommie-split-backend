/**
 * JWT authentication middleware for Fastify
 * Verifies the JWT from httpOnly cookie or Authorization header
 * Attaches decoded payload to request.user
 */
export async function authenticate(request, reply) {
  try {
    // Try cookie first, then Authorization header
    const token =
      request.cookies?.token ||
      request.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const decoded = await request.jwtVerify();
    // jwtVerify attaches to request.user automatically when using @fastify/jwt
    // But if using cookie, we need to verify manually:
    if (!request.user) {
      const payload = request.server.jwt.verify(token);
      request.user = payload;
    }
  } catch (err) {
    return reply.code(401).send({ error: 'Invalid or expired token' });
  }
}

/**
 * Optional auth — doesn't fail if no token, just sets request.user = null
 */
export async function optionalAuth(request, reply) {
  try {
    const token =
      request.cookies?.token ||
      request.headers.authorization?.replace('Bearer ', '');
    if (token) {
      request.user = request.server.jwt.verify(token);
    } else {
      request.user = null;
    }
  } catch {
    request.user = null;
  }
}
