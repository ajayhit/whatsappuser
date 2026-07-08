import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'database.db');

let db;

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

export function initDb() {
  const db = getDb();

  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      wallet_balance REAL NOT NULL DEFAULT 0,
      is_blocked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Ensure is_blocked column exists if table was created in previous versions
  try {
    db.exec("ALTER TABLE users ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0");
    console.log('[DB] Added is_blocked column to users table');
  } catch (err) {
    // Column already exists, ignore
  }

  // Banks table
  db.exec(`
    CREATE TABLE IF NOT EXISTS banks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bank_name TEXT NOT NULL,
      account_number TEXT NOT NULL,
      ifsc TEXT NOT NULL,
      account_holder TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `);

  // Settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Seed default bank if empty
  try {
    const bankCount = db.prepare('SELECT COUNT(*) as cnt FROM banks').get().cnt;
    if (bankCount === 0) {
      db.prepare(`
        INSERT INTO banks (bank_name, account_number, ifsc, account_holder)
        VALUES (?, ?, ?, ?)
      `).run(
        process.env.BANK_NAME || 'State Bank of India',
        process.env.BANK_ACCOUNT_NUMBER || '123456789012',
        process.env.BANK_IFSC || 'SBIN0001234',
        process.env.BANK_ACCOUNT_HOLDER || 'WhatsApp SaaS Admin'
      );
      console.log('[DB Seed] Seeded default bank account.');
    }
  } catch (e) {
    console.error('Error seeding banks:', e);
  }

  // Seed default settings
  const defaultPrices = {
    plan_price: '199',
    plan_price_demo: '0',
    plan_price_28: '199',
    plan_price_quarter: '549',
    plan_price_half_year: '999',
    plan_price_year: '1899'
  };
  for (const [key, val] of Object.entries(defaultPrices)) {
    try {
      db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, val);
    } catch (e) {
      console.error(`Error seeding setting ${key}:`, e);
    }
  }

  // Plans table
  db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      started_at TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Orders table
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL DEFAULT 149,
      utr TEXT NOT NULL,
      bank_name TEXT NOT NULL,
      account_name TEXT NOT NULL,
      screenshot_path TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      confirmed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Wallet transactions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Password reset tokens table
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS paytm_account (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      paytm_userid TEXT,
      paytm_password TEXT,
      number TEXT,
      session_name TEXT,
      token_name TEXT,
      qr_details TEXT,
      login_status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
      otp_requested_at TEXT,
      last_login_at TEXT,
      last_refresh_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Ensure table columns exist for plans and orders
  try {
    db.exec("ALTER TABLE plans ADD COLUMN plan_type TEXT NOT NULL DEFAULT 'plan_28'");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE plans ADD COLUMN duration_days INTEGER NOT NULL DEFAULT 28");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE plans ADD COLUMN price REAL NOT NULL DEFAULT 199");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE orders ADD COLUMN plan_type TEXT");
  } catch (e) {}

  console.log('[DB] All tables initialized.');
}

// ─── User Helpers ────────────────────────────────────────────────────────────

export function createUser({ name, email, phone, password, role = 'user' }) {
  const db = getDb();
  const password_hash = bcrypt.hashSync(password, 10);
  const stmt = db.prepare(`
    INSERT INTO users (name, email, phone, password_hash, role)
    VALUES (@name, @email, @phone, @password_hash, @role)
  `);
  const result = stmt.run({ name, email, phone: phone || '', password_hash, role });
  return getUserById(result.lastInsertRowid);
}

export function getUserByEmail(email) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

export function getUserById(id) {
  const db = getDb();
  return db.prepare('SELECT id, name, email, phone, role, wallet_balance, is_blocked, created_at FROM users WHERE id = ?').get(id);
}

export function getAllUsers() {
  const db = getDb();
  return db.prepare(`
    SELECT u.id, u.name, u.email, u.phone, u.role, u.wallet_balance, u.is_blocked, u.created_at,
           p.status as plan_status, p.expires_at
    FROM users u
    LEFT JOIN plans p ON p.user_id = u.id AND p.status = 'active'
    ORDER BY u.created_at DESC
  `).all();
}

export function setUserBlockStatus(userId, isBlocked) {
  const db = getDb();
  db.prepare('UPDATE users SET is_blocked = ? WHERE id = ?').run(isBlocked ? 1 : 0, userId);
  return getUserById(userId);
}

export function creditWallet(userId, amount, description) {
  const db = getDb();
  db.prepare('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?').run(amount, userId);
  db.prepare(`
    INSERT INTO wallet_transactions (user_id, type, amount, description)
    VALUES (?, 'credit', ?, ?)
  `).run(userId, amount, description);
}

export function debitWallet(userId, amount, description) {
  const db = getDb();
  const user = db.prepare('SELECT wallet_balance FROM users WHERE id = ?').get(userId);
  if (user.wallet_balance < amount) throw new Error('Insufficient wallet balance');
  db.prepare('UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?').run(amount, userId);
  db.prepare(`
    INSERT INTO wallet_transactions (user_id, type, amount, description)
    VALUES (?, 'debit', ?, ?)
  `).run(userId, amount, description);
}

export function getWalletTransactions(userId) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC
  `).all(userId);
}

// ─── Plan Helpers ─────────────────────────────────────────────────────────────

export function getActivePlan(userId) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM plans WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1
  `).get(userId);
}

export function getPlansByUser(userId) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM plans WHERE user_id = ? ORDER BY created_at DESC
  `).all(userId);
}

export function activatePlan(userId, planType = 'plan_28', durationDays = 28, price = 199) {
  const db = getDb();

  const activePlan = getActivePlan(userId);
  const startedAt = new Date().toISOString();
  let expiresAt;

  const additionalTime = durationDays * 24 * 60 * 60 * 1000;

  if (activePlan && new Date(activePlan.expires_at) > new Date()) {
    // Add durationDays to the existing expiration date
    expiresAt = new Date(new Date(activePlan.expires_at).getTime() + additionalTime).toISOString();
  } else {
    // Set to durationDays from now
    expiresAt = new Date(Date.now() + additionalTime).toISOString();
  }

  // Expire any previous active plans
  db.prepare(`UPDATE plans SET status = 'expired' WHERE user_id = ? AND status = 'active'`).run(userId);

  const result = db.prepare(`
    INSERT INTO plans (user_id, status, started_at, expires_at, plan_type, duration_days, price)
    VALUES (?, 'active', ?, ?, ?, ?, ?)
  `).run(userId, startedAt, expiresAt, planType, durationDays, price);

  return db.prepare('SELECT * FROM plans WHERE id = ?').get(result.lastInsertRowid);
}

export function getPlanDetails(planType) {
  const prices = {
    demo: { name: 'Demo Plan', durationDays: 10, settingKey: 'plan_price_demo', defaultPrice: 0 },
    plan_28: { name: 'Monthly Plan', durationDays: 28, settingKey: 'plan_price_28', defaultPrice: 199 },
    quarter: { name: 'Quarter Plan', durationDays: 90, settingKey: 'plan_price_quarter', defaultPrice: 549 },
    half_year: { name: 'Half-Year Plan', durationDays: 180, settingKey: 'plan_price_half_year', defaultPrice: 999 },
    year: { name: 'Year Plan', durationDays: 365, settingKey: 'plan_price_year', defaultPrice: 1899 }
  };

  const plan = prices[planType];
  if (!plan) return null;

  const priceStr = getSetting(plan.settingKey, String(plan.defaultPrice));
  const price = parseFloat(priceStr);

  return {
    type: planType,
    name: plan.name,
    durationDays: plan.durationDays,
    price: price
  };
}

export function subscribeToPlan(userId, planType) {
  const db = getDb();
  
  const planDetails = getPlanDetails(planType);
  if (!planDetails) throw new Error('Invalid plan type');

  // Enforce Demo Plan only once per user
  if (planType === 'demo') {
    const hasDemo = db.prepare(`
      SELECT COUNT(*) as count FROM plans 
      WHERE user_id = ? AND plan_type = 'demo'
    `).get(userId).count;
    if (hasDemo > 0) {
      throw new Error('You have already claimed the Demo Plan. It can only be claimed once.');
    }
  }

  // Debit wallet (if price is > 0)
  if (planDetails.price > 0) {
    const user = getUserById(userId);
    if (user.wallet_balance < planDetails.price) {
      throw new Error(`Insufficient wallet balance. You need ₹${planDetails.price} but only have ₹${user.wallet_balance.toFixed(2)}.`);
    }
    debitWallet(userId, planDetails.price, `Subscribed to ${planDetails.name} (${planDetails.durationDays} Days)`);
  }

  // Activate plan
  const plan = activatePlan(userId, planType, planDetails.durationDays, planDetails.price);

  return plan;
}

export function expireOldPlans() {
  const db = getDb();
  const now = new Date().toISOString();
  const updated = db.prepare(`
    UPDATE plans SET status = 'expired'
    WHERE status = 'active' AND expires_at < ?
  `).run(now);
  if (updated.changes > 0) {
    console.log(`[Plan Expiry] Expired ${updated.changes} plan(s).`);
  }
}

// ─── Order Helpers ────────────────────────────────────────────────────────────

export function createOrder({ userId, amount, utr, bank_name, account_name, screenshot_path, plan_type }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO orders (user_id, amount, utr, bank_name, account_name, screenshot_path, plan_type)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, amount, utr, bank_name, account_name, screenshot_path || null, plan_type || null);
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(result.lastInsertRowid);
}

export function getOrdersByUser(userId) {
  const db = getDb();
  return db.prepare(`
    SELECT o.*, u.name as user_name, u.email as user_email
    FROM orders o
    JOIN users u ON u.id = o.user_id
    WHERE o.user_id = ?
    ORDER BY o.created_at DESC
  `).all(userId);
}

export function getAllOrders() {
  const db = getDb();
  return db.prepare(`
    SELECT o.*, u.name as user_name, u.email as user_email
    FROM orders o
    JOIN users u ON u.id = o.user_id
    ORDER BY o.created_at DESC
  `).all();
}

export function confirmOrder(orderId) {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw new Error('Order not found');
  if (order.status !== 'pending') throw new Error(`Order is already ${order.status}`);

  const confirmedAt = new Date().toISOString();

  // Update order status
  db.prepare(`
    UPDATE orders SET status = 'confirmed', confirmed_at = ? WHERE id = ?
  `).run(confirmedAt, orderId);

  // Credit wallet with the order amount (what user paid)
  creditWallet(order.user_id, order.amount, `Plan deposit confirmed - Order #${orderId}`);

  let plan = null;
  // If order is tied to a subscription plan, purchase it automatically
  if (order.plan_type && order.plan_type !== 'wallet') {
    const details = getPlanDetails(order.plan_type);
    if (details) {
      try {
        // Debit wallet for the plan fee
        debitWallet(order.user_id, details.price, `₹${details.price} / ${details.name} activated - Order #${orderId}`);
        // Activate plan
        plan = activatePlan(order.user_id, order.plan_type, details.durationDays, details.price);
      } catch (err) {
        console.error(`Auto-activation failed on confirmOrder: ${err.message}`);
      }
    }
  }

  return { order: db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId), plan };
}

export function rejectOrder(orderId, notes) {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw new Error('Order not found');
  if (order.status !== 'pending') throw new Error(`Order is already ${order.status}`);

  db.prepare(`
    UPDATE orders SET status = 'rejected', notes = ? WHERE id = ?
  `).run(notes || 'Rejected by admin', orderId);

  return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
}

export function verifyPassword(plaintext, hash) {
  return bcrypt.compareSync(plaintext, hash);
}

// ─── Settings Helpers ─────────────────────────────────────────────────────────

export function getSetting(key, defaultValue = '') {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}

export function setSetting(key, value) {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
  return { key, value };
}

// ─── Bank Helpers ─────────────────────────────────────────────────────────────

export function getBanks(onlyActive = false) {
  const db = getDb();
  if (onlyActive) {
    return db.prepare('SELECT * FROM banks WHERE is_active = 1 ORDER BY id ASC').all();
  }
  return db.prepare('SELECT * FROM banks ORDER BY id ASC').all();
}

export function createBank({ bank_name, account_number, ifsc, account_holder }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO banks (bank_name, account_number, ifsc, account_holder)
    VALUES (?, ?, ?, ?)
  `).run(bank_name, account_number, ifsc, account_holder);
  return db.prepare('SELECT * FROM banks WHERE id = ?').get(result.lastInsertRowid);
}

export function updateBank(id, { bank_name, account_number, ifsc, account_holder, is_active }) {
  const db = getDb();
  db.prepare(`
    UPDATE banks
    SET bank_name = ?, account_number = ?, ifsc = ?, account_holder = ?, is_active = ?
    WHERE id = ?
  `).run(bank_name, account_number, ifsc, account_holder, is_active ? 1 : 0, id);
  return db.prepare('SELECT * FROM banks WHERE id = ?').get(id);
}

export function deleteBank(id) {
  const db = getDb();
  db.prepare('DELETE FROM banks WHERE id = ?').run(id);
  return { id, deleted: true };
}

function ensurePaytmAccount() {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO paytm_account (id, login_status)
    VALUES (1, 'NOT_CONFIGURED')
  `).run();
}

export function getPaytmAccount() {
  const db = getDb();
  ensurePaytmAccount();
  return db.prepare('SELECT * FROM paytm_account WHERE id = 1').get();
}

export function startPaytmLogin({ paytm_userid, paytm_password }) {
  const db = getDb();
  ensurePaytmAccount();
  const current = getPaytmAccount();
  if (current.login_status === 'LOGGED_IN') {
    return { alreadyLoggedIn: true, account: current };
  }

  const now = new Date().toISOString();
  const sessionName = current.session_name || `paytm_session_${Date.now()}`;
  const tokenName = current.token_name || `paytm_token_${Date.now()}`;

  db.prepare(`
    UPDATE paytm_account
    SET paytm_userid = ?,
        paytm_password = ?,
        session_name = ?,
        token_name = ?,
        login_status = 'OTP_REQUIRED',
        otp_requested_at = ?,
        updated_at = datetime('now')
    WHERE id = 1
  `).run(paytm_userid, paytm_password, sessionName, tokenName, now);

  return { alreadyLoggedIn: false, account: getPaytmAccount() };
}

export function completePaytmOtpLogin({ otp, number, session_name, token_name, qr_details }) {
  const db = getDb();
  ensurePaytmAccount();
  if (!otp) throw new Error('OTP is required');

  const current = getPaytmAccount();
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE paytm_account
    SET number = ?,
        session_name = ?,
        token_name = ?,
        qr_details = ?,
        login_status = 'LOGGED_IN',
        last_login_at = ?,
        last_refresh_at = ?,
        updated_at = datetime('now')
    WHERE id = 1
  `).run(
    number || current.number || current.paytm_userid || '',
    session_name || current.session_name || `paytm_session_${Date.now()}`,
    token_name || current.token_name || `paytm_token_${Date.now()}`,
    qr_details || current.qr_details || '',
    now,
    now
  );

  return getPaytmAccount();
}

export function refreshPaytmAccount() {
  const db = getDb();
  ensurePaytmAccount();
  db.prepare(`
    UPDATE paytm_account
    SET last_refresh_at = ?,
        updated_at = datetime('now')
    WHERE id = 1
  `).run(new Date().toISOString());
  return getPaytmAccount();
}

export function logoutPaytmAccount() {
  const db = getDb();
  ensurePaytmAccount();
  db.prepare(`
    UPDATE paytm_account
    SET login_status = 'LOGGED_OUT',
        updated_at = datetime('now')
    WHERE id = 1
  `).run();
  return getPaytmAccount();
}

// ─── Password Management Helpers ──────────────────────────────────────────────

export function updateUserPassword(userId, newPassword) {
  const db = getDb();
  const password_hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(password_hash, userId);
  return true;
}

export function createPasswordResetToken(userId) {
  const db = getDb();
  // Invalidate any existing unused tokens for this user
  db.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0').run(userId);
  
  // Generate a 6-digit OTP code
  const token = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes
  
  db.prepare(`
    INSERT INTO password_resets (user_id, token, expires_at)
    VALUES (?, ?, ?)
  `).run(userId, token, expiresAt);
  
  return { token, expiresAt };
}

export function getValidResetToken(email, token) {
  const db = getDb();
  const now = new Date().toISOString();
  return db.prepare(`
    SELECT pr.*, u.email, u.name FROM password_resets pr
    JOIN users u ON u.id = pr.user_id
    WHERE u.email = ? AND pr.token = ? AND pr.used = 0 AND pr.expires_at > ?
    ORDER BY pr.created_at DESC LIMIT 1
  `).get(email, token, now);
}

export function invalidateResetToken(tokenId) {
  const db = getDb();
  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(tokenId);
}

export function deleteUser(userId) {
  const db = getDb();
  
  const deleteStatements = [
    db.prepare('DELETE FROM password_resets WHERE user_id = ?'),
    db.prepare('DELETE FROM wallet_transactions WHERE user_id = ?'),
    db.prepare('DELETE FROM plans WHERE user_id = ?'),
    db.prepare('DELETE FROM orders WHERE user_id = ?'),
    db.prepare('DELETE FROM users WHERE id = ?')
  ];

  const transaction = db.transaction((id) => {
    for (const stmt of deleteStatements) {
      stmt.run(id);
    }
  });

  transaction(userId);
  return { id: userId, deleted: true };
}
