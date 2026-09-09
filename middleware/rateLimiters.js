import rateLimit from 'express-rate-limit';

/**
 * Strict rate limiter for sensitive authentication and password reset routes.
 * Mitigates credential stuffing, password spray, and user enumeration attacks.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20, // Max 20 requests per IP per 15 minutes
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too many attempts from this IP address. Please try again after 15 minutes.'
  }
});

/**
 * Upload limiter to prevent malicious storage exhaustion / disk bombing.
 */
export const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  limit: 50, // Max 50 uploads per IP per 10 minutes
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Upload frequency limit reached. Please wait a few minutes before uploading more files.'
  }
});
