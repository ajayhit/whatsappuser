import { getActivePlan, expireOldPlans } from '../db.js';

export function planMiddleware(req, res, next) {
  // Check if account is blocked by Admin
  if (req.user && req.user.is_blocked === 1) {
    return res.status(403).json({
      error: 'Your account has been suspended or blocked by an admin.',
      code: 'ACCOUNT_BLOCKED'
    });
  }

  // Admins bypass plan checks
  if (req.user?.role === 'admin') return next();

  // Run expiry sweep first
  try { expireOldPlans(); } catch (e) {}

  const plan = getActivePlan(req.user.id);

  if (!plan) {
    return res.status(403).json({
      error: 'No active plan. Please purchase a plan to use this service.',
      code: 'NO_PLAN'
    });
  }

  // Double-check expiry in case cron hasn't run
  if (new Date(plan.expires_at) < new Date()) {
    return res.status(403).json({
      error: 'Your plan has expired. Please purchase a new plan to continue.',
      code: 'PLAN_EXPIRED',
      expiredAt: plan.expires_at
    });
  }

  // Attach plan info to request for downstream use
  req.plan = plan;
  next();
}
