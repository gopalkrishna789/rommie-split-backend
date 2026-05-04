/**
 * Rate limiting configuration for @fastify/rate-limit
 * Applied globally in app.js
 */
export const rateLimitConfig = {
  max: 100,           // max requests per window
  timeWindow: '1 minute',
  errorResponseBuilder: (request, context) => ({
    error: 'Too many requests',
    message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)}s`,
    statusCode: 429,
  }),
};

/**
 * Stricter limit for auth endpoints
 */
export const authRateLimitConfig = {
  max: 10,
  timeWindow: '1 minute',
  errorResponseBuilder: (request, context) => ({
    error: 'Too many auth attempts',
    message: `Please wait ${Math.ceil(context.ttl / 1000)}s before trying again`,
    statusCode: 429,
  }),
};
