import express from 'express';
import {
  createUser, getUserByEmail, getUserByPhone, getUserById, updateUserProfile,
  getActivePlan, getPlansByUser, getOrdersByUser, getWalletTransactions,
  createOrder, verifyPassword, expireOldPlans,
  getSetting, setSetting, getBanks,
  updateUserPassword, createPasswordResetToken,
  getValidResetToken, invalidateResetToken,
  getPlanDetails, subscribeToPlan, getDb
} from './db.js';
import { generateToken, authMiddleware } from './middleware/authMiddleware.js';
import { getSessionStatus, sendMessageToJid, initSession, waitForSessionState, hasSessionFiles } from './sessionManager.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = express.Router();
const captchaChallenges = new Map();
const CAPTCHA_TTL_MS = 3 * 60 * 1000;
const CAPTCHA_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function escapeSvgText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function randomCaptchaCode(length = 7) {
  return Array.from({ length }, () => CAPTCHA_CHARS[Math.floor(Math.random() * CAPTCHA_CHARS.length)]).join('');
}

function createCaptchaImage(code) {
  const text = escapeSvgText(code);
  const noiseLines = Array.from({ length: 15 }, () => {
    const x1 = Math.floor(Math.random() * 260);
    const y1 = Math.floor(Math.random() * 92);
    const x2 = Math.floor(Math.random() * 260);
    const y2 = Math.floor(Math.random() * 92);
    const opacity = (Math.random() * 0.3 + 0.18).toFixed(2);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#38bdf8" stroke-width="1.5" opacity="${opacity}" />`;
  }).join('');
  const dots = Array.from({ length: 85 }, () => {
    const cx = Math.floor(Math.random() * 260);
    const cy = Math.floor(Math.random() * 92);
    const opacity = (Math.random() * 0.35 + 0.15).toFixed(2);
    return `<circle cx="${cx}" cy="${cy}" r="${Math.random() > 0.65 ? 1.7 : 1}" fill="#f8fafc" opacity="${opacity}" />`;
  }).join('');
  const decoyLetters = Array.from({ length: 9 }, () => {
    const char = CAPTCHA_CHARS[Math.floor(Math.random() * CAPTCHA_CHARS.length)];
    const x = 18 + Math.floor(Math.random() * 220);
    const y = 22 + Math.floor(Math.random() * 52);
    const rotate = Math.floor(Math.random() * 70) - 35;
    return `<text x="${x}" y="${y}" transform="rotate(${rotate} ${x} ${y})" fill="#94a3b8" opacity="0.16">${char}</text>`;
  }).join('');
  const letters = text.split('').map((char, index) => {
    const x = 20 + index * 31 + Math.floor(Math.random() * 8);
    const y = 57 + Math.floor(Math.random() * 14);
    const rotate = Math.floor(Math.random() * 32) - 16;
    const color = ['#f8fafc', '#a7f3d0', '#bfdbfe', '#fde68a'][index % 4];
    return `<text x="${x}" y="${y}" transform="rotate(${rotate} ${x} ${y})" fill="${color}">${char}</text>`;
  }).join('');
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="260" height="92" viewBox="0 0 260 92" role="img" aria-label="Signup security code">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#0f172a"/>
          <stop offset="0.55" stop-color="#1e293b"/>
          <stop offset="1" stop-color="#064e3b"/>
        </linearGradient>
        <filter id="wobble">
          <feTurbulence type="fractalNoise" baseFrequency="0.018 0.06" numOctaves="2" seed="${Math.floor(Math.random() * 1000)}"/>
          <feDisplacementMap in="SourceGraphic" scale="4"/>
        </filter>
      </defs>
      <rect width="260" height="92" rx="14" fill="url(#bg)"/>
      ${noiseLines}
      ${dots}
      <g font-family="Consolas, 'Courier New', monospace" font-size="26" font-weight="800" letter-spacing="3">
        ${decoyLetters}
      </g>
      <g filter="url(#wobble)" font-family="Consolas, 'Courier New', monospace" font-size="31" font-weight="800" letter-spacing="3">
        ${letters}
      </g>
      <path d="M15 64 C55 42, 94 82, 139 58 S210 40, 244 60" fill="none" stroke="#f472b6" stroke-width="2.4" opacity="0.55"/>
      <path d="M12 30 C62 52, 111 18, 157 38 S222 74, 247 34" fill="none" stroke="#22d3ee" stroke-width="1.7" opacity="0.42"/>
    </svg>
  `.trim();
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function createCaptchaChallenge() {
  const code = randomCaptchaCode();
  const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  captchaChallenges.set(id, {
    answer: code,
    expiresAt: Date.now() + CAPTCHA_TTL_MS
  });
  return {
    id,
    image: createCaptchaImage(code),
    question: 'Type the security code shown'
  };
}

function verifyCaptcha(captchaId, captchaAnswer) {
  const challenge = captchaChallenges.get(captchaId);
  captchaChallenges.delete(captchaId);
  if (!challenge || challenge.expiresAt < Date.now()) return false;
  return String(captchaAnswer || '').trim().toUpperCase() === challenge.answer;
}

/**
 * GET /auth/captcha
 * Generate a visual signup captcha challenge.
 */
router.get('/captcha', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  return res.json(createCaptchaChallenge());
});

router.get('/test-captcha', (req, res) => {
  return res.json(Object.fromEntries(
    Array.from(captchaChallenges.entries()).map(([id, val]) => [id, { answer: val.answer }])
  ));
});

// Screenshot upload config
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `order_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Only images and PDF allowed'));
    }
  }
});

/**
 * GET /auth/public-plans
 * Unauthenticated route to get subscription plan options and prices
 */
router.get('/public-plans', (req, res) => {
  try {
    const planOptions = [
      getPlanDetails('demo'),
      getPlanDetails('plan_28'),
      getPlanDetails('quarter'),
      getPlanDetails('half_year'),
      getPlanDetails('year')
    ];
    return res.json({ planOptions });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /auth/register
 * Create a new user account
 */
router.post('/register', (req, res) => {
  const { name, email, phone, password, captchaId, captchaAnswer } = req.body;
  if (!name || !email || !password || !phone) {
    return res.status(400).json({ error: 'Name, email, phone number, and password are required' });
  }
  const phoneDigits = String(phone || '').replace(/\D/g, '');
  if (!phoneDigits || phoneDigits.length !== 10) {
    return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (!verifyCaptcha(captchaId, captchaAnswer)) {
    return res.status(400).json({ error: 'Captcha verification failed. Please try again.' });
  }

  try {
    const existing = getUserByEmail(email);
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const existingPhone = getUserByPhone(phoneDigits);
    if (existingPhone) return res.status(409).json({ error: 'Phone number already registered. Please use a different number or sign in.' });

    const user = createUser({ name, email, phone: phoneDigits, password });
    const token = generateToken(user);
    return res.status(201).json({ message: 'Account created successfully', token, user });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /auth/login
 * Login and get JWT token
 */
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const userRow = getUserByEmail(email);
    if (!userRow) return res.status(401).json({ error: 'Invalid email or password' });

    // Check block status immediately
    if (userRow.is_blocked === 1) {
      return res.status(403).json({ error: 'Your account has been suspended or blocked by an admin.' });
    }

    const valid = verifyPassword(password, userRow.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const user = getUserById(userRow.id);
    const token = generateToken(user);

    // Expire old plans on login
    try { expireOldPlans(); } catch (e) {}

    const plan = getActivePlan(user.id);
    return res.json({ message: 'Login successful', token, user, plan: plan || null });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /auth/me
 * Get current user info, plan, wallet, orders, dynamic banks, plan_price
 */
router.get('/me', authMiddleware, (req, res) => {
  try {
    // Check block status
    if (req.user.is_blocked === 1) {
      return res.status(403).json({ error: 'Your account is blocked.' });
    }
 
    expireOldPlans();
    const user = getUserById(req.user.id);
    const plan = getActivePlan(req.user.id);
    const plans = getPlansByUser(req.user.id);
    const orders = getOrdersByUser(req.user.id);
    const transactions = getWalletTransactions(req.user.id);
 
    // Dynamic settings & active banks
    const planPrice = parseFloat(getSetting('plan_price_28', '199'));
    const banks = getBanks(true); // only active banks

    // Get all subscription options
    const planOptions = [
      getPlanDetails('demo'),
      getPlanDetails('plan_28'),
      getPlanDetails('quarter'),
      getPlanDetails('half_year'),
      getPlanDetails('year')
    ];
 
    return res.json({
      user,
      plan: plan || null,
      plans,
      orders,
      transactions,
      planPrice,
      planOptions,
      banks
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /auth/orders
 * Submit a payment order (bank transfer)
 */
router.post('/orders', authMiddleware, upload.single('screenshot'), async (req, res) => {
  const { utr, bank_name, account_name, plan_type, amount: customAmount, user_phone } = req.body;
  
  if (req.user.is_blocked === 1) {
    return res.status(403).json({ error: 'Your account is blocked.' });
  }

  if (!utr || !bank_name || !account_name) {
    return res.status(400).json({ error: 'UTR number, bank name, and account name are required' });
  }

  // Update user phone number if provided or missing in DB
  const rawUserPhone = user_phone || req.user.phone;
  if (rawUserPhone) {
    const cleanPhone = String(rawUserPhone).replace(/\D/g, '');
    if (cleanPhone.length >= 10 && (!req.user.phone || req.user.phone !== cleanPhone)) {
      try {
        const dbConn = getDb();
        dbConn.prepare("UPDATE users SET phone = ? WHERE id = ?").run(cleanPhone, req.user.id);
        req.user.phone = cleanPhone;
      } catch (e) {
        console.error('[Deposit] Failed to update user phone:', e.message);
      }
    }
  }

  try {
    const planType = plan_type || 'plan_28';
    let orderAmount = 0;

    if (planType === 'wallet') {
      orderAmount = parseFloat(customAmount || '0');
      if (orderAmount <= 0) {
        return res.status(400).json({ error: 'Recharge amount must be greater than 0.' });
      }
    } else {
      const details = getPlanDetails(planType);
      if (!details) {
        return res.status(400).json({ error: 'Invalid plan type selected.' });
      }
      orderAmount = details.price;
    }

    const screenshot_path = req.file ? req.file.filename : null;
    const order = createOrder({
      userId: req.user.id,
      amount: orderAmount,
      utr,
      bank_name,
      account_name,
      screenshot_path,
      plan_type: planType
    });

    // ─── WhatsApp Notifications (non-blocking) ────────────────────────────
    try {
      // Ensure admin session is connected if files exist
      let adminSessionStatus = getSessionStatus('admin');
      if (adminSessionStatus.status !== 'CONNECTED' && hasSessionFiles('admin')) {
        try {
          initSession('admin').catch(e => console.error('[Deposit Notify AutoInit Error]:', e));
          await waitForSessionState('admin', ['CONNECTED'], 3000);
          adminSessionStatus = getSessionStatus('admin');
        } catch (e) {}
      }

      if (adminSessionStatus.status === 'CONNECTED') {
        const user = req.user;
        const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        const hasScreenshot = screenshot_path ? 'Yes 📸' : 'No';

        // 1. Resolve Admin WhatsApp Number
        let adminNumber = getSetting('admin_whatsapp_number', '');
        if (!adminNumber && adminSessionStatus.user?.phone) {
          adminNumber = adminSessionStatus.user.phone;
        }
        if (!adminNumber) {
          try {
            const dbConn = getDb();
            const adminUser = dbConn.prepare("SELECT phone FROM users WHERE role = 'admin' AND phone IS NOT NULL AND phone != '' LIMIT 1").get();
            if (adminUser && adminUser.phone) {
              adminNumber = adminUser.phone;
            }
          } catch (e) {}
        }

        const adminDigits = String(adminNumber || '').replace(/\D/g, '');
        if (adminDigits && adminDigits.length >= 10) {
          const adminMsg =
            `🔔 *New Deposit Request Received*\n\n` +
            `👤 User: ${user.name || 'N/A'} (${user.email || 'N/A'})\n` +
            `📱 Phone: ${user.phone || rawUserPhone || 'N/A'}\n` +
            `💰 Amount: *₹${orderAmount}*\n` +
            `🏦 Bank: ${bank_name}\n` +
            `📋 UTR: ${utr}\n` +
            `🕐 Time: ${timestamp}\n` +
            `📸 Screenshot: ${hasScreenshot}\n\n` +
            `Please review and approve/reject in the Admin Panel.`;
          await sendMessageToJid('admin', adminDigits, adminMsg);
          console.log(`[Deposit Notify] Admin notified at ${adminDigits}`);
        } else {
          console.warn('[Deposit Notify] Admin WhatsApp number not found — skipping admin notification');
        }

        // 2. Notify user (if user phone number exists)
        const activeUserPhone = user.phone || rawUserPhone;
        const userDigits = activeUserPhone ? String(activeUserPhone).replace(/\D/g, '') : '';
        if (userDigits && userDigits.length >= 10) {
          const userMsg =
            `✅ *Deposit Request Received!*\n\n` +
            `Hi ${user.name || 'there'},\n` +
            `We have successfully received your deposit request of *₹${orderAmount}*!\n\n` +
            `📋 UTR: ${utr}\n` +
            `🏦 Bank: ${bank_name}\n` +
            `🕐 Time: ${timestamp}\n\n` +
            `⏳ Please wait *5 minutes* while our team reviews your payment.\n` +
            `You will receive a WhatsApp confirmation once your deposit is approved. Thank you! 🙏`;
          await sendMessageToJid('admin', userDigits, userMsg);
          console.log(`[Deposit Notify] User #${user.id} notified at ${userDigits}`);
        } else {
          console.warn(`[Deposit Notify] User #${user.id} has no valid phone number — skipping user notification`);
        }
      } else {
        console.warn('[Deposit Notify] Admin WA session not connected — skipping notifications');
      }
    } catch (notifyErr) {
      console.error('[Deposit Notify] Notification error (non-fatal):', notifyErr.message);
    }
    // ─────────────────────────────────────────────────────────────────────

    return res.status(201).json({
      message: 'Order submitted successfully. Awaiting admin confirmation.',
      order
    });
  } catch (err) {
    console.error('Order error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /auth/subscribe
 * Subscribe to a plan using wallet balance (or claim demo for free)
 */
router.post('/subscribe', authMiddleware, (req, res) => {
  const { planType } = req.body;
  if (req.user.is_blocked === 1) {
    return res.status(403).json({ error: 'Your account is blocked.' });
  }
  if (!planType) {
    return res.status(400).json({ error: 'planType is required' });
  }
  try {
    const plan = subscribeToPlan(req.user.id, planType);
    const user = getUserById(req.user.id);
    return res.json({
      message: `Successfully subscribed to plan: ${planType}`,
      plan,
      user
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * GET /auth/orders
 * Get current user's orders
 */
router.get('/orders', authMiddleware, (req, res) => {
  if (req.user.is_blocked === 1) {
    return res.status(403).json({ error: 'Your account is blocked.' });
  }
  try {
    const orders = getOrdersByUser(req.user.id);
    return res.json({ orders });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /auth/profile
 * Update user/admin profile details (Name, Phone Number)
 */
router.post('/profile', authMiddleware, (req, res) => {
  const { name, phone } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }

  const cleanPhone = phone ? String(phone).replace(/\D/g, '') : '';
  if (phone && cleanPhone.length > 0 && cleanPhone.length < 10) {
    return res.status(400).json({ error: 'Please enter a valid 10+ digit mobile number' });
  }

  try {
    const updatedUser = updateUserProfile(req.user.id, {
      name: name.trim(),
      phone: cleanPhone
    });

    // If admin updates phone, sync it with admin_whatsapp_number setting as well
    if (req.user.role === 'admin' && cleanPhone) {
      setSetting('admin_whatsapp_number', cleanPhone);
    }

    return res.json({
      message: 'Profile updated successfully!',
      user: updatedUser
    });
  } catch (err) {
    console.error('Update profile error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /auth/change-password
 * Change password (authenticated user)
 */
router.post('/change-password', authMiddleware, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  try {
    // Get full user row with password_hash
    const userRow = getUserByEmail(req.user.email);
    if (!userRow) return res.status(404).json({ error: 'User not found' });

    const valid = verifyPassword(currentPassword, userRow.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    updateUserPassword(req.user.id, newPassword);
    return res.json({ message: 'Password changed successfully!' });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /auth/forgot-password
 * Generate a password reset OTP token
 */
router.post('/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const user = getUserByEmail(email);
    if (!user) {
      // Don't reveal whether the email exists
      return res.json({ 
        message: 'If this email is registered, a reset code has been generated.',
        showOtp: false
      });
    }

    const { token, expiresAt } = createPasswordResetToken(user.id);
    
    // Since there's no email service configured, return the OTP directly
    // In production, this should be sent via email/SMS
    console.log(`[Password Reset] OTP for ${email}: ${token}`);
    return res.json({
      message: 'A 6-digit reset code has been generated. It expires in 15 minutes.',
      otp: token,  // In production, remove this and send via email/SMS
      expiresAt,
      showOtp: true
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /auth/reset-password
 * Reset password using OTP token
 */
router.post('/reset-password', (req, res) => {
  const { email, otp, newPassword } = req.body;
  if (!email || !otp || !newPassword) {
    return res.status(400).json({ error: 'Email, OTP code, and new password are required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  try {
    const resetRecord = getValidResetToken(email, otp);
    if (!resetRecord) {
      return res.status(400).json({ error: 'Invalid or expired reset code. Please request a new one.' });
    }

    // Update password and invalidate token
    updateUserPassword(resetRecord.user_id, newPassword);
    invalidateResetToken(resetRecord.id);

    return res.json({ message: 'Password has been reset successfully! You can now sign in.' });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
