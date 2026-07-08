import express from 'express';
import { adminMiddleware } from './middleware/authMiddleware.js';
import { generateToken } from './middleware/authMiddleware.js';
import {
  getAllOrders, confirmOrder, rejectOrder,
  getAllUsers, creditWallet, getUserById,
  getBanks, createBank, updateBank, deleteBank,
  getSetting, setSetting, setUserBlockStatus, createUser, getUserByEmail,
  deleteUser
} from './db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router = express.Router();

// Apply admin auth to all routes
router.use(adminMiddleware);

/**
 * GET /admin/orders
 * List all orders (filter by status via ?status=pending)
 */
router.get('/orders', (req, res) => {
  try {
    let orders = getAllOrders();
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
 * Confirm payment → credit wallet → activate plan
 */
router.post('/orders/:id/confirm', (req, res) => {
  try {
    const result = confirmOrder(parseInt(req.params.id));
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
 * Reject a payment order
 */
router.post('/orders/:id/reject', (req, res) => {
  const { notes } = req.body;
  try {
    const order = rejectOrder(parseInt(req.params.id), notes);
    return res.json({ message: 'Order rejected.', order });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * GET /admin/users
 * List all users with plan status
 */
router.get('/users', (req, res) => {
  try {
    const users = getAllUsers();
    return res.json({ users });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /admin/users
 * Admin creates user manually
 */
router.post('/users', (req, res) => {
  const { name, email, phone, password, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }
  try {
    const existing = getUserByEmail(email);
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const user = createUser({ name, email, phone, password, role: role || 'user' });
    return res.status(201).json({ message: 'User created successfully', user });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /admin/users/:id/block
 * Toggle user block status
 */
router.post('/users/:id/block', (req, res) => {
  const userId = parseInt(req.params.id);
  const { is_blocked } = req.body; // boolean or 0/1
  try {
    const user = setUserBlockStatus(userId, is_blocked);
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
router.post('/users/:id/generate-token', (req, res) => {
  const userId = parseInt(req.params.id);
  try {
    const user = getUserById(userId);
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
router.post('/wallet/credit', (req, res) => {
  const { userId, amount, description } = req.body;
  if (!userId || !amount) {
    return res.status(400).json({ error: 'userId and amount are required' });
  }
  try {
    creditWallet(parseInt(userId), parseFloat(amount), description || 'Admin credit');
    const user = getUserById(parseInt(userId));
    return res.json({ message: `Wallet credited ₹${amount} for user ${userId}`, user });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Settings Endpoints ──────────────────────────────────────────────────────

/**
 * GET /admin/settings
 * Fetch all setting values
 */
router.get('/settings', (req, res) => {
  try {
    return res.json({
      plan_price_28: getSetting('plan_price_28', '199'),
      plan_price_quarter: getSetting('plan_price_quarter', '549'),
      plan_price_half_year: getSetting('plan_price_half_year', '999'),
      plan_price_year: getSetting('plan_price_year', '1899')
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /admin/settings
 * Set a setting value (e.g. key: 'plan_price', value: '199')
 */
router.post('/settings', (req, res) => {
  const { key, value } = req.body;
  if (!key || value === undefined) {
    return res.status(400).json({ error: 'key and value are required' });
  }
  try {
    const result = setSetting(key, value);
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
router.get('/banks', (req, res) => {
  try {
    const banks = getBanks(false); // return all (active and inactive)
    return res.json({ banks });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /admin/banks
 * Add a bank account
 */
router.post('/banks', (req, res) => {
  const { bank_name, account_number, ifsc, account_holder } = req.body;
  if (!bank_name || !account_number || !ifsc || !account_holder) {
    return res.status(400).json({ error: 'bank_name, account_number, ifsc, and account_holder are required' });
  }
  try {
    const bank = createBank({ bank_name, account_number, ifsc, account_holder });
    return res.status(201).json({ message: 'Bank account created successfully.', bank });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /admin/banks/:id
 * Edit a bank account details
 */
router.put('/banks/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const { bank_name, account_number, ifsc, account_holder, is_active } = req.body;
  if (!bank_name || !account_number || !ifsc || !account_holder) {
    return res.status(400).json({ error: 'bank_name, account_number, ifsc, and account_holder are required' });
  }
  try {
    const bank = updateBank(id, { bank_name, account_number, ifsc, account_holder, is_active });
    return res.json({ message: 'Bank account updated successfully.', bank });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /admin/banks/:id
 * Hard delete a bank account
 */
router.delete('/banks/:id', (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const result = deleteBank(id);
    return res.json({ message: 'Bank account deleted successfully.', ...result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /admin/users/:id
 * Delete a user and all their associated data (plans, orders, transactions, reset codes, sessions)
 */
router.delete('/users/:id', (req, res) => {
  const userId = parseInt(req.params.id);
  
  // Prevent admin from deleting themselves
  if (userId === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own admin account.' });
  }

  try {
    const user = getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Delete database records
    deleteUser(userId);

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

export default router;
