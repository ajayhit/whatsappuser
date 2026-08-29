import express from 'express';
import multer from 'multer';
import { adminMiddleware } from './middleware/authMiddleware.js';
import { generateToken } from './middleware/authMiddleware.js';
import {
  getAllOrders, confirmOrder, rejectOrder,
  getAllUsers, creditWallet, getUserById,
  getBanks, createBank, updateBank, deleteBank,
  getSetting, setSetting, setUserBlockStatus, createUser, getUserByEmail,
  deleteUser, getOrderById,
  getDbPath, checkpointDb, closeDb, reloadDb
} from './db.js';
import {
  initSession, getSessionStatus, requestPairingCode, logoutSession,
  sendMessageToJid, waitForSessionState, hasSessionFiles
} from './sessionManager.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router = express.Router();

// Configure multer for database restore uploads
const tempDbDir = path.join(__dirname, 'uploads', 'temp_db');
if (!fs.existsSync(tempDbDir)) {
  fs.mkdirSync(tempDbDir, { recursive: true });
}
const dbUpload = multer({
  dest: tempDbDir,
  limits: { fileSize: 100 * 1024 * 1024 } // 100 MB
});

// Apply admin auth to all routes
router.use(adminMiddleware);

// ─── Admin WhatsApp Session Endpoints ────────────────────────────────────────

/**
 * POST /admin/session/login
 * Start or resume the admin WhatsApp session (shows QR if not connected)
 */
router.post('/session/login', async (req, res) => {
  const phoneNumber = req.body?.phoneNumber || req.body?.phone;
  try {
    if (phoneNumber) {
      const codeResult = await requestPairingCode('admin', phoneNumber);
      return res.json({
        message: 'Admin pairing code generated successfully. Enter it in WhatsApp > Linked Devices.',
        ...codeResult
      });
    }

    initSession('admin').catch(err =>
      console.error('[Admin WA] initSession error:', err)
    );
    const sessionInfo = await waitForSessionState('admin', ['CONNECTED', 'QR', 'PAIRING_CODE'], 1500);
    return res.json({
      message:
        sessionInfo.status === 'CONNECTED'
          ? 'Admin WhatsApp session is connected'
          : sessionInfo.status === 'QR'
          ? 'Scan the QR code with the admin WhatsApp number'
          : sessionInfo.status === 'PAIRING_CODE'
          ? 'Admin pairing code is active'
          : 'Session is initializing — try again in a moment',
      ...sessionInfo
    });
  } catch (err) {
    console.error('[Admin WA] session/login error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /admin/session/pairing-code
 * Request an 8-digit pairing code for admin WhatsApp session
 */
router.post('/session/pairing-code', async (req, res) => {
  let phoneNumber = req.body?.phoneNumber || req.body?.phone;
  if (!phoneNumber) {
    phoneNumber = await getAdminPhone();
  }
  if (!phoneNumber) {
    return res.status(400).json({ error: 'Phone number is required for admin WhatsApp pairing code' });
  }

  try {
    const result = await requestPairingCode('admin', phoneNumber);
    return res.json({
      success: true,
      message: 'Admin pairing code generated. Enter this 8-digit code in WhatsApp on your mobile.',
      ...result
    });
  } catch (err) {
    console.error('[Admin WA] Pairing code error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/session/status
 * Return current admin WhatsApp session status + QR if pending
 */
router.get('/session/status', (req, res) => {
  try {
    const statusInfo = getSessionStatus('admin');
    return res.json(statusInfo);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /admin/session/logout
 * Disconnect and clean up admin WhatsApp session
 */
router.post('/session/logout', async (req, res) => {
  try {
    const result = await logoutSession('admin');
    return res.json({ message: 'Admin WhatsApp session disconnected', ...result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Helper: resolve Admin WhatsApp Number ───────────────────────────────────

async function getAdminPhone() {
  let adminNumber = await getSetting('admin_whatsapp_number', '');
  if (!adminNumber) {
    const status = getSessionStatus('admin');
    if (status?.user?.phone) {
      adminNumber = status.user.phone;
    }
  }
  if (!adminNumber) {
    try {
      const adminUser = await queryOne("SELECT phone FROM users WHERE role = 'admin' AND phone IS NOT NULL AND phone != '' LIMIT 1");
      if (adminUser && adminUser.phone) {
        adminNumber = adminUser.phone;
      }
    } catch (e) {}
  }
  return adminNumber;
}

// ─── Helper: send WhatsApp notification via admin session ─────────────────────

async function sendAdminSessionMsg(phone, message) {
  try {
    let status = getSessionStatus('admin');
    if (status.status !== 'CONNECTED' && hasSessionFiles('admin')) {
      try {
        initSession('admin').catch(err => console.error('[AutoConnect Admin WA Error]:', err));
        await waitForSessionState('admin', ['CONNECTED'], 3000);
        status = getSessionStatus('admin');
      } catch (e) {}
    }
    if (status.status !== 'CONNECTED') {
      console.warn('[Admin WA Notify] Admin session not connected — skipping notification');
      return false;
    }
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits || digits.length < 10) {
      console.warn('[Admin WA Notify] Invalid phone number — skipping notification');
      return false;
    }
    await sendMessageToJid('admin', digits, message);
    return true;
  } catch (err) {
    console.error('[Admin WA Notify] Failed to send message:', err.message);
    return false;
  }
}

/**
 * GET /admin/orders
 * List all orders (filter by status via ?status=pending)
 */
router.get('/orders', async (req, res) => {
  try {
    let orders = await getAllOrders();
    if (req.query.status) {
      orders = orders.filter(o => o.status === req.query.status);
    }
    return res.json({ orders });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /admin/orders/:id/confirm
 * Confirm payment → credit wallet → activate plan → notify user & admin via WhatsApp
 */
router.post('/orders/:id/confirm', async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const result = await confirmOrder(orderId);

    // Send WhatsApp confirmation to BOTH User and Admin (non-blocking)
    try {
      const order = await getOrderById(orderId);
      if (order) {
        const user = await getUserById(order.user_id);
        const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

        // 1. Notify User
        const userPhone = user?.phone || order.phone;
        if (userPhone) {
          const userMsg =
            `✅ *Payment Confirmed!*\n\n` +
            `Hi ${user?.name || 'there'},\n` +
            `Your deposit request of *₹${order.amount}* has been confirmed & approved! 🎉\n\n` +
            `📋 UTR: ${order.utr || 'N/A'}\n` +
            `🏦 Bank: ${order.bank_name || 'N/A'}\n` +
            `🕐 Time: ${timestamp}\n\n` +
            `Your wallet/plan has been activated. Thank you for your payment! 🙏`;
          await sendAdminSessionMsg(userPhone, userMsg);
          console.log(`[Admin WA] Sent deposit confirmation to user #${order.user_id} (${userPhone})`);
        } else {
          console.warn(`[Admin WA] User #${order.user_id} has no phone number — skipping user notification`);
        }

        // 2. Notify Admin
        const adminPhone = await getAdminPhone();
        if (adminPhone) {
          const adminMsg =
            `✅ *Deposit Request Approved*\n\n` +
            `Order #${order.id} for *₹${order.amount}* has been confirmed.\n` +
            `👤 User: ${user?.name || 'N/A'} (${user?.email || 'N/A'})\n` +
            `📱 User Phone: ${userPhone || 'N/A'}\n` +
            `📋 UTR: ${order.utr || 'N/A'}\n` +
            `🕐 Time: ${timestamp}`;
          await sendAdminSessionMsg(adminPhone, adminMsg);
          console.log(`[Admin WA] Sent deposit confirmation alert to admin (${adminPhone})`);
        } else {
          console.warn('[Admin WA] Admin phone number not set — skipping admin alert');
        }
      }
    } catch (notifyErr) {
      console.error('[Admin WA] Confirm notification failed:', notifyErr.message);
    }

    return res.json({
      message: 'Order confirmed. Plan activated.',
      ...result
    });
  } catch (err) {
    console.error('Confirm order error:', err);
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /admin/orders/:id/reject
 * Reject a payment order → notify user & admin via WhatsApp
 */
router.post('/orders/:id/reject', async (req, res) => {
  const { notes } = req.body;
  try {
    const orderId = parseInt(req.params.id);
    const order = await rejectOrder(orderId, notes);

    // Send WhatsApp rejection to BOTH User and Admin (non-blocking)
    try {
      const fullOrder = await getOrderById(orderId);
      if (fullOrder) {
        const user = await getUserById(fullOrder.user_id);
        const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        const reasonStr = notes || 'Payment details could not be verified';

        // 1. Notify User
        const userPhone = user?.phone || fullOrder.phone;
        if (userPhone) {
          const userMsg =
            `❌ *Deposit Request Rejected*\n\n` +
            `Hi ${user?.name || 'there'},\n` +
            `Unfortunately, your deposit request of *₹${fullOrder.amount}* could not be verified.\n\n` +
            `📋 UTR: ${fullOrder.utr || 'N/A'}\n` +
            `📝 Reason: ${reasonStr}\n` +
            `🕐 Time: ${timestamp}\n\n` +
            `Please check your payment details/screenshot and re-submit or contact support.`;
          await sendAdminSessionMsg(userPhone, userMsg);
          console.log(`[Admin WA] Sent deposit rejection to user #${fullOrder.user_id} (${userPhone})`);
        } else {
          console.warn(`[Admin WA] User #${fullOrder.user_id} has no phone number — skipping user notification`);
        }

        // 2. Notify Admin
        const adminPhone = await getAdminPhone();
        if (adminPhone) {
          const adminMsg =
            `❌ *Deposit Request Rejected*\n\n` +
            `Order #${fullOrder.id} for *₹${fullOrder.amount}* has been rejected.\n` +
            `👤 User: ${user?.name || 'N/A'} (${user?.email || 'N/A'})\n` +
            `📱 User Phone: ${userPhone || 'N/A'}\n` +
            `📋 UTR: ${fullOrder.utr || 'N/A'}\n` +
            `📝 Reason: ${reasonStr}\n` +
            `🕐 Time: ${timestamp}`;
          await sendAdminSessionMsg(adminPhone, adminMsg);
          console.log(`[Admin WA] Sent deposit rejection alert to admin (${adminPhone})`);
        } else {
          console.warn('[Admin WA] Admin phone number not set — skipping admin alert');
        }
      }
    } catch (notifyErr) {
      console.error('[Admin WA] Reject notification failed:', notifyErr.message);
    }

    return res.json({ message: 'Order rejected.', order });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * GET /admin/users
 * List all users with plan status
 */
router.get('/users', async (req, res) => {
  try {
    const users = await getAllUsers();
    return res.json({ users });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /admin/users
 * Admin creates user manually
 */
router.post('/users', async (req, res) => {
  const { name, email, phone, password, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }
  try {
    const existing = await getUserByEmail(email);
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const user = await createUser({ name, email, phone, password, role: role || 'user' });
    return res.status(201).json({ message: 'User created successfully', user });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /admin/users/:id/block
 * Toggle user block status
 */
router.post('/users/:id/block', async (req, res) => {
  const userId = parseInt(req.params.id);
  const { is_blocked } = req.body; // boolean or 0/1
  try {
    const user = await setUserBlockStatus(userId, is_blocked);
    return res.json({
      message: `User block status set to ${is_blocked ? 'BLOCKED' : 'ALLOWED'}`,
      user
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /admin/users/:id/generate-token
 * Generate a JWT token for a specific user (admin only)
 */
router.post('/users/:id/generate-token', async (req, res) => {
  const userId = parseInt(req.params.id);
  try {
    const user = await getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const token = generateToken(user);
    return res.json({
      message: `JWT token generated for user #${userId}`,
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      token
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /admin/wallet/credit
 * Manually credit a user's wallet
 */
router.post('/wallet/credit', async (req, res) => {
  const { userId, amount, description } = req.body;
  if (!userId || !amount) {
    return res.status(400).json({ error: 'userId and amount are required' });
  }
  try {
    await creditWallet(parseInt(userId), parseFloat(amount), description || 'Admin credit');
    const user = await getUserById(parseInt(userId));
    return res.json({ message: `Wallet credited ₹${amount} for user ${userId}`, user });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /admin/send-message
 * Send WhatsApp message from Admin session to:
 * - 'all': All registered users with a phone number
 * - 'user': Specific user by userId
 * - 'custom': Custom phone number
 */
router.post('/send-message', async (req, res) => {
  const { targetType, userId, phone, message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message content is required' });
  }

  // Verify Admin WhatsApp session status
  let status = getSessionStatus('admin');
  if (status.status !== 'CONNECTED' && hasSessionFiles('admin')) {
    try {
      initSession('admin').catch(err => console.error('[AutoConnect Admin WA Error]:', err));
      await waitForSessionState('admin', ['CONNECTED'], 3000);
      status = getSessionStatus('admin');
    } catch (e) {}
  }

  if (status.status !== 'CONNECTED') {
    return res.status(400).json({
      error: 'Admin WhatsApp session is not connected. Please go to Admin WhatsApp tab and connect / scan QR code first.'
    });
  }

  try {
    const msgText = message.trim();
    const adminPhoneDigits = String((await getAdminPhone()) || '').replace(/\D/g, '');

    // Helper: filter valid non-admin users with phone numbers
    function getEligibleUsers(users) {
      return users.filter(u => {
        if (u.role === 'admin') return false;
        if (!u.phone) return false;
        const uPhoneDigits = String(u.phone).replace(/\D/g, '');
        if (uPhoneDigits.length < 10) return false;
        if (adminPhoneDigits && uPhoneDigits.endsWith(adminPhoneDigits.slice(-10))) return false;
        return true;
      });
    }

    // Helper: broadcast to a list of users and return counts
    async function broadcastToUsers(targetUsers) {
      let sentCount = 0;
      let failedCount = 0;
      for (const user of targetUsers) {
        try {
          const success = await sendAdminSessionMsg(user.phone, msgText);
          if (success) sentCount++;
          else failedCount++;
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (err) {
          failedCount++;
        }
      }
      return { sentCount, failedCount, total: targetUsers.length };
    }

    if (targetType === 'all') {
      const users = await getAllUsers();
      const targetUsers = getEligibleUsers(users);

      if (targetUsers.length === 0) {
        return res.status(400).json({ error: 'No registered regular users found with valid phone numbers.' });
      }

      const result = await broadcastToUsers(targetUsers);
      return res.json({
        message: `Broadcast to ALL users finished: ${result.sentCount} sent, ${result.failedCount} failed out of ${result.total} user(s).`,
        ...result
      });

    } else if (targetType === 'active_users') {
      // Users who currently have an active plan (plan_status = 'active')
      const users = await getAllUsers();
      const activeUsers = getEligibleUsers(users.filter(u => u.plan_status === 'active'));

      if (activeUsers.length === 0) {
        return res.status(400).json({ error: 'No active subscribers with valid phone numbers found.' });
      }

      const result = await broadcastToUsers(activeUsers);
      return res.json({
        message: `Broadcast to ACTIVE users finished: ${result.sentCount} sent, ${result.failedCount} failed out of ${result.total} active subscriber(s).`,
        ...result
      });

    } else if (targetType === 'inactive_users') {
      // Users who do NOT have an active plan (no plan or expired plan)
      const users = await getAllUsers();
      const inactiveUsers = getEligibleUsers(users.filter(u => u.plan_status !== 'active'));

      if (inactiveUsers.length === 0) {
        return res.status(400).json({ error: 'No inactive users with valid phone numbers found.' });
      }

      const result = await broadcastToUsers(inactiveUsers);
      return res.json({
        message: `Broadcast to INACTIVE users finished: ${result.sentCount} sent, ${result.failedCount} failed out of ${result.total} inactive user(s).`,
        ...result
      });

    } else if (targetType === 'user') {
      if (!userId) return res.status(400).json({ error: 'Please select a user' });
      const user = await getUserById(parseInt(userId));
      if (!user) return res.status(404).json({ error: 'Selected user not found' });
      if (!user.phone || String(user.phone).replace(/\D/g, '').length < 10) {
        return res.status(400).json({ error: `User ${user.name} does not have a valid phone number recorded.` });
      }

      const success = await sendAdminSessionMsg(user.phone, msgText);
      if (!success) {
        return res.status(500).json({ error: `Failed to send message to ${user.name} (${user.phone}).` });
      }

      return res.json({
        message: `Message sent successfully to ${user.name} (${user.phone}).`,
        sentCount: 1
      });

    } else if (targetType === 'custom') {
      const digits = String(phone || '').replace(/\D/g, '');
      if (!digits || digits.length < 10) {
        return res.status(400).json({ error: 'Please enter a valid mobile number with country code (e.g. 919509116337)' });
      }

      const success = await sendAdminSessionMsg(digits, msgText);
      if (!success) {
        return res.status(500).json({ error: `Failed to send message to ${digits}.` });
      }

      return res.json({
        message: `Message sent successfully to +${digits}.`,
        sentCount: 1
      });

    } else {
      return res.status(400).json({ error: 'Invalid target type. Must be "all", "active_users", "inactive_users", "user", or "custom".' });
    }

  } catch (err) {
    console.error('Admin Send Message Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── Settings Endpoints ──────────────────────────────────────────────────────

/**
 * GET /admin/settings
 * Fetch all setting values
 */
router.get('/settings', async (req, res) => {
  try {
    return res.json({
      plan_price_28: await getSetting('plan_price_28', '199'),
      plan_price_quarter: await getSetting('plan_price_quarter', '549'),
      plan_price_half_year: await getSetting('plan_price_half_year', '999'),
      plan_price_year: await getSetting('plan_price_year', '1899'),
      admin_whatsapp_number: await getSetting('admin_whatsapp_number', ''),
      razorpay_key_id: await getSetting('razorpay_key_id', ''),
      razorpay_key_secret: await getSetting('razorpay_key_secret', '')
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /admin/settings
 * Set a setting value (e.g. key: 'plan_price', value: '199')
 */
router.post('/settings', async (req, res) => {
  const { key, value } = req.body;
  if (!key || value === undefined) {
    return res.status(400).json({ error: 'key and value are required' });
  }
  try {
    const result = await setSetting(key, value);
    return res.json({ message: `Setting "${key}" updated successfully.`, ...result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Bank Endpoints ──────────────────────────────────────────────────────────

/**
 * GET /admin/banks
 * Fetch all banks
 */
router.get('/banks', async (req, res) => {
  try {
    const banks = await getBanks(false); // return all (active and inactive)
    return res.json({ banks });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /admin/banks
 * Add a bank account
 */
router.post('/banks', async (req, res) => {
  const { bank_name, account_number, ifsc, account_holder } = req.body;
  if (!bank_name || !account_number || !ifsc || !account_holder) {
    return res.status(400).json({ error: 'bank_name, account_number, ifsc, and account_holder are required' });
  }
  try {
    const bank = await createBank({ bank_name, account_number, ifsc, account_holder });
    return res.status(201).json({ message: 'Bank account created successfully.', bank });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /admin/banks/:id
 * Edit a bank account details
 */
router.put('/banks/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const { bank_name, account_number, ifsc, account_holder, is_active } = req.body;
  if (!bank_name || !account_number || !ifsc || !account_holder) {
    return res.status(400).json({ error: 'bank_name, account_number, ifsc, and account_holder are required' });
  }
  try {
    const bank = await updateBank(id, { bank_name, account_number, ifsc, account_holder, is_active });
    return res.json({ message: 'Bank account updated successfully.', bank });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /admin/banks/:id
 * Hard delete a bank account
 */
router.delete('/banks/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const result = await deleteBank(id);
    return res.json({ message: 'Bank account deleted successfully.', ...result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /admin/users/:id
 * Delete a user and all their associated data (plans, orders, transactions, reset codes, sessions)
 */
router.delete('/users/:id', async (req, res) => {
  const userId = parseInt(req.params.id);
  
  // Prevent admin from deleting themselves
  if (userId === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own admin account.' });
  }

  try {
    const user = await getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Delete database records
    await deleteUser(userId);

    // Clean up session folder on disk
    try {
      const sessionPath = path.join(__dirname, 'sessions', `session_${userId}`);
      if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        console.log(`[Admin Delete User] Deleted WhatsApp session folder for user #${userId}`);
      }
    } catch (fsErr) {
      console.error(`Error deleting session folder for user #${userId}:`, fsErr);
    }

    return res.json({ message: `User #${userId} ("${user.name}") and all associated data deleted successfully.` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Database Sync / Backup & Restore Endpoints ──────────────────────────────

/**
 * GET /admin/database/backup
 * Checkpoints WAL and downloads current SQLite database.db file
 */
router.get('/database/backup', (req, res) => {
  try {
    checkpointDb();
    const dbPath = getDbPath();
    if (!fs.existsSync(dbPath)) {
      return res.status(404).json({ error: 'Database file not found.' });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.download(dbPath, `chatautomate_backup_${timestamp}.db`);
  } catch (err) {
    console.error('[Admin DB Backup] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /admin/database/restore
 * Upload & restore database from a .db SQLite file
 */
router.post('/database/restore', dbUpload.single('db_file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Please select a valid .db SQLite file to upload.' });
  }
  const uploadedPath = req.file.path;
  try {
    // Validate SQLite Header (first 16 bytes: "SQLite format 3\0")
    const buffer = Buffer.alloc(16);
    const fd = fs.openSync(uploadedPath, 'r');
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);

    const headerString = buffer.toString('utf8');
    if (!headerString.startsWith('SQLite format 3')) {
      fs.unlinkSync(uploadedPath);
      return res.status(400).json({ error: 'The uploaded file is not a valid SQLite database file.' });
    }

    const targetDbPath = getDbPath();
    const walPath = `${targetDbPath}-wal`;
    const shmPath = `${targetDbPath}-shm`;

    // 1. Close current DB connection safely
    closeDb();

    // 2. Remove stale WAL & SHM files if present
    if (fs.existsSync(walPath)) {
      try { fs.unlinkSync(walPath); } catch (e) {}
    }
    if (fs.existsSync(shmPath)) {
      try { fs.unlinkSync(shmPath); } catch (e) {}
    }

    // 3. Replace target DB file with uploaded file
    fs.copyFileSync(uploadedPath, targetDbPath);
    fs.unlinkSync(uploadedPath); // clean up temp file

    // 4. Reopen and reload DB connection
    reloadDb();

    console.log(`[Admin DB Restore] Database restored successfully from upload`);
    return res.json({ message: 'Database successfully restored and reloaded! All accounts and data have been updated.' });
  } catch (err) {
    console.error('[Admin DB Restore] Error:', err);
    try { if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath); } catch (e) {}
    try { reloadDb(); } catch (e) {}
    return res.status(500).json({ error: 'Failed to restore database: ' + err.message });
  }
});

export default router;
