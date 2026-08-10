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

  // Backfill older databases where role may be NULL/blank or missing a valid value.
  try {
    db.prepare(`
      UPDATE users
      SET role = 'user'
      WHERE role IS NULL OR TRIM(role) = '' OR role NOT IN ('user', 'admin')
    `).run();
  } catch (err) {
    // Older incompatible schemas will still be handled by SELECT fallbacks below.
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

  // Seed default settings
  const defaultPrices = {
    plan_price: '199',
    plan_price_demo: '0',
    plan_price_28: '199',
    plan_price_quarter: '549',
    plan_price_half_year: '999',
    plan_price_year: '1899',
    admin_whatsapp_number: process.env.ADMIN_WHATSAPP_NUMBER || ''
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

  // Digital Catalog table
  db.exec(`
    CREATE TABLE IF NOT EXISTS digital_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      brand_name TEXT NOT NULL,
      logo_path TEXT,
      description TEXT,
      catalog_audio_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Catalog Services table
  db.exec(`
    CREATE TABLE IF NOT EXISTS catalog_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      catalog_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      image_path TEXT,
      audio_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (catalog_id) REFERENCES digital_catalog(id) ON DELETE CASCADE
    )
  `);

  // Contacts table (Name, Mobile, Shop Name) + is_excluded
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      mobile TEXT NOT NULL,
      shop_name TEXT,
      is_excluded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, mobile)
    )
  `);

  // Contact Groups table
  db.exec(`
    CREATE TABLE IF NOT EXISTS contact_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Contact Group Members junction table
  db.exec(`
    CREATE TABLE IF NOT EXISTS contact_group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      contact_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (group_id) REFERENCES contact_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
      UNIQUE(group_id, contact_id)
    )
  `);

  // Auto Replies table
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      keyword TEXT NOT NULL,
      match_type TEXT NOT NULL DEFAULT 'contains',
      reply_text TEXT,
      media_path TEXT,
      media_type TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Reminders table
  db.exec(`
    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      contact_id INTEGER,
      recipient_mobile TEXT NOT NULL,
      recipient_name TEXT,
      shop_name TEXT,
      message_template TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      sent_at TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
    )
  `);

  // Message Templates table
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT DEFAULT 'General',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Automation Settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS automation_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      welcome_active INTEGER NOT NULL DEFAULT 0,
      welcome_text TEXT,
      welcome_media_path TEXT,
      welcome_media_type TEXT,
      away_active INTEGER NOT NULL DEFAULT 0,
      away_text TEXT,
      away_schedule_type TEXT DEFAULT 'always',
      away_start_time TEXT,
      away_end_time TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Campaigns table
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      message_text TEXT NOT NULL,
      media_path TEXT,
      media_type TEXT,
      scheduled_at TEXT, 
      status TEXT NOT NULL DEFAULT 'pending', -- pending, running, paused, completed, failed
      total_contacts INTEGER DEFAULT 0,
      successful_deliveries INTEGER DEFAULT 0,
      failed_deliveries INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Campaign Recipients table
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaign_recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      contact_id INTEGER,
      mobile TEXT NOT NULL,
      name TEXT,
      shop_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending', -- pending, sent, failed
      error_message TEXT,
      sent_at TEXT,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
    )
  `);

  // Expiry Notification Logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS expiry_notification_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Birthday Wishes automation table
  db.exec(`
    CREATE TABLE IF NOT EXISTS birthday_wishes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      contact_id INTEGER,
      recipient_name TEXT NOT NULL,
      recipient_phone TEXT NOT NULL,
      birthday_date TEXT NOT NULL,   -- MM-DD format for yearly recurrence
      birth_year TEXT,               -- Optional full birth year
      message_text TEXT NOT NULL,
      media_path TEXT,
      media_type TEXT,
      send_time TEXT DEFAULT '09:00', -- HH:MM to send on birthday
      active INTEGER NOT NULL DEFAULT 1,
      last_sent_year INTEGER,        -- Year last sent to avoid duplicates
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
    )
  `);

  // Payment Reminders automation table
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      contact_id INTEGER,
      recipient_name TEXT NOT NULL,
      recipient_phone TEXT NOT NULL,
      amount REAL,
      currency TEXT DEFAULT 'INR',
      due_date TEXT NOT NULL,         -- ISO date of payment due
      message_text TEXT NOT NULL,
      media_path TEXT,
      media_type TEXT,
      remind_days_before INTEGER DEFAULT 1,
      status TEXT DEFAULT 'pending',  -- pending, sent, paid, cancelled
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
    )
  `);

  // Order Notifications automation table
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      contact_id INTEGER,
      recipient_name TEXT NOT NULL,
      recipient_phone TEXT NOT NULL,
      order_id TEXT NOT NULL,
      order_status TEXT NOT NULL DEFAULT 'placed', -- placed, confirmed, shipped, out_for_delivery, delivered, cancelled
      product_name TEXT,
      amount REAL,
      currency TEXT DEFAULT 'INR',
      message_text TEXT NOT NULL,
      media_path TEXT,
      media_type TEXT,
      send_immediately INTEGER DEFAULT 1,
      scheduled_at TEXT,
      sent_at TEXT,
      status TEXT DEFAULT 'pending',  -- pending, sent, failed
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
    )
  `);

  // Follow-up Automation table
  db.exec(`
    CREATE TABLE IF NOT EXISTS followup_automations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      trigger_event TEXT NOT NULL DEFAULT 'no_response', -- no_response, after_purchase, after_reminder
      delay_days INTEGER NOT NULL DEFAULT 3,
      message_text TEXT NOT NULL,
      media_path TEXT,
      media_type TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      apply_to TEXT DEFAULT 'all',    -- all, group (future: group_id)
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
  try {
    db.exec("ALTER TABLE contacts ADD COLUMN email TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE contacts ADD COLUMN birthday TEXT");
  } catch (e) {}
  // Birthday wish delivery status tracking
  try {
    db.exec("ALTER TABLE birthday_wishes ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE birthday_wishes ADD COLUMN last_error TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE birthday_wishes ADD COLUMN last_sent_at TEXT");
  } catch (e) {}

  // Follow-up sent log table — tracks which contacts received which automation
  db.exec(`
    CREATE TABLE IF NOT EXISTS followup_sent_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      automation_id INTEGER NOT NULL,
      contact_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'sent',
      error_message TEXT,
      sent_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (automation_id) REFERENCES followup_automations(id) ON DELETE CASCADE
    )
  `);

  try {
    db.exec("ALTER TABLE followup_sent_log ADD COLUMN status TEXT NOT NULL DEFAULT 'sent'");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE followup_sent_log ADD COLUMN error_message TEXT");
  } catch (e) {}

  // Reminders table extra columns for day-of-week / recurring schedule
  try {
    db.exec("ALTER TABLE reminders ADD COLUMN repeat_option TEXT DEFAULT 'once'");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE reminders ADD COLUMN selected_days TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE reminders ADD COLUMN send_time TEXT");
  } catch (e) {}

  console.log('[DB] All tables initialized.');
}

// ─── User Helpers ────────────────────────────────────────────────────────────

function normalizeRole(role) {
  return role === 'admin' ? 'admin' : 'user';
}

export function createUser({ name, email, phone, password, role = 'user' }) {
  const db = getDb();
  const password_hash = bcrypt.hashSync(password, 10);
  const normalizedRole = normalizeRole(role);
  const stmt = db.prepare(`
    INSERT INTO users (name, email, phone, password_hash, role)
    VALUES (@name, @email, @phone, @password_hash, @role)
  `);
  const result = stmt.run({ name, email, phone: phone || '', password_hash, role: normalizedRole });
  return getUserById(result.lastInsertRowid);
}

export function getUserByEmail(email) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

export function getUserById(id) {
  const db = getDb();
  return db.prepare(`
    SELECT
      id,
      name,
      email,
      phone,
      CASE WHEN role = 'admin' THEN 'admin' ELSE 'user' END AS role,
      wallet_balance,
      is_blocked,
      created_at
    FROM users
    WHERE id = ?
  `).get(id);
}

export function updateUserProfile(userId, { name, phone }) {
  const db = getDb();
  db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(name, phone || '', userId);
  return getUserById(userId);
}

export function getAllUsers() {
  const db = getDb();
  return db.prepare(`
    SELECT u.id, u.name, u.email, u.phone,
           CASE WHEN u.role = 'admin' THEN 'admin' ELSE 'user' END AS role,
           u.wallet_balance, u.is_blocked, u.created_at,
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

// ─── Expiry Notification Helpers ──────────────────────────────────────────────

export function canSendExpiryNotification(userId, minIntervalMinutes, maxPer24h) {
  const db = getDb();
  
  // 1. Check minimum time interval since last notification sent
  const lastLog = db.prepare(`
    SELECT sent_at FROM expiry_notification_logs
    WHERE user_id = ?
    ORDER BY id DESC LIMIT 1
  `).get(userId);

  if (lastLog) {
    const minutesAgo = (Date.now() - new Date(lastLog.sent_at).getTime()) / (1000 * 60);
    if (minutesAgo < minIntervalMinutes) {
      return false;
    }
  }

  // 2. Check total sent count in the last 24 hours
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const countRow = db.prepare(`
    SELECT COUNT(*) as count FROM expiry_notification_logs
    WHERE user_id = ? AND sent_at >= ?
  `).get(userId, twentyFourHoursAgo);

  if (countRow && countRow.count >= maxPer24h) {
    return false;
  }

  return true;
}

export function logExpiryNotification(userId, category) {
  const db = getDb();
  db.prepare(`
    INSERT INTO expiry_notification_logs (user_id, category, sent_at)
    VALUES (?, ?, ?)
  `).run(userId, category, new Date().toISOString());
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

export function getOrderById(orderId) {
  const db = getDb();
  return db.prepare(`
    SELECT o.*, u.name as user_name, u.email as user_email, u.phone as user_phone
    FROM orders o
    JOIN users u ON u.id = o.user_id
    WHERE o.id = ?
  `).get(orderId);
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
    db.prepare('DELETE FROM reminders WHERE user_id = ?'),
    db.prepare('DELETE FROM message_templates WHERE user_id = ?'),
    db.prepare('DELETE FROM automation_settings WHERE user_id = ?'),
    db.prepare('DELETE FROM campaigns WHERE user_id = ?'),
    db.prepare('DELETE FROM auto_replies WHERE user_id = ?'),
    db.prepare('DELETE FROM contacts WHERE user_id = ?'),
    db.prepare('DELETE FROM digital_catalog WHERE user_id = ?'),
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

// ─── CRM Helpers ─────────────────────────────────────────────────────────────

// Digital Catalog Helpers
export function getCatalogByUserId(userId) {
  const db = getDb();
  return db.prepare('SELECT * FROM digital_catalog WHERE user_id = ?').get(userId);
}

export function getServicesByCatalogId(catalogId) {
  const db = getDb();
  return db.prepare('SELECT * FROM catalog_services WHERE catalog_id = ? ORDER BY created_at ASC').all(catalogId);
}

export function upsertCatalog(userId, { brand_name, logo_path, description, catalog_audio_path }) {
  const db = getDb();
  const existing = getCatalogByUserId(userId);
  if (existing) {
    db.prepare(`
      UPDATE digital_catalog
      SET brand_name = ?,
          logo_path = COALESCE(?, logo_path),
          description = ?,
          catalog_audio_path = COALESCE(?, catalog_audio_path)
      WHERE user_id = ?
    `).run(brand_name, logo_path || null, description || '', catalog_audio_path || null, userId);
  } else {
    db.prepare(`
      INSERT INTO digital_catalog (user_id, brand_name, logo_path, description, catalog_audio_path)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, brand_name, logo_path || null, description || '', catalog_audio_path || null);
  }
  return getCatalogByUserId(userId);
}

export function createService(catalogId, { name, description, price, image_path, audio_path }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO catalog_services (catalog_id, name, description, price, image_path, audio_path)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(catalogId, name, description || '', price, image_path || null, audio_path || null);
  return db.prepare('SELECT * FROM catalog_services WHERE id = ?').get(result.lastInsertRowid);
}

export function updateService(serviceId, catalogId, { name, description, price, image_path, audio_path }) {
  const db = getDb();
  db.prepare(`
    UPDATE catalog_services
    SET name = ?,
        description = ?,
        price = ?,
        image_path = COALESCE(?, image_path),
        audio_path = COALESCE(?, audio_path)
    WHERE id = ? AND catalog_id = ?
  `).run(name, description || '', price, image_path || null, audio_path || null, serviceId, catalogId);
  return db.prepare('SELECT * FROM catalog_services WHERE id = ?').get(serviceId);
}

export function deleteService(serviceId, catalogId) {
  const db = getDb();
  db.prepare('DELETE FROM catalog_services WHERE id = ? AND catalog_id = ?').run(serviceId, catalogId);
  return { id: serviceId, deleted: true };
}

// Contacts Directory Helpers
export function getContactsByUser(userId) {
  const db = getDb();
  return db.prepare('SELECT * FROM contacts WHERE user_id = ? ORDER BY name ASC').all(userId);
}

export function upsertContact({ user_id, name, mobile, shop_name, is_excluded = 0 }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO contacts (user_id, name, mobile, shop_name, is_excluded)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, mobile) DO UPDATE SET
      name = excluded.name,
      shop_name = COALESCE(excluded.shop_name, shop_name),
      is_excluded = COALESCE(excluded.is_excluded, is_excluded)
  `).run(user_id, name, mobile, shop_name || null, is_excluded);
  return db.prepare('SELECT * FROM contacts WHERE user_id = ? AND mobile = ?').get(user_id, mobile);
}

export function getContactByMobile(userId, mobile) {
  const db = getDb();
  return db.prepare('SELECT * FROM contacts WHERE user_id = ? AND mobile = ?').get(userId, mobile);
}

export function deleteContact(contactId, userId) {
  const db = getDb();
  db.prepare('DELETE FROM contacts WHERE id = ? AND user_id = ?').run(contactId, userId);
  return { id: contactId, deleted: true };
}

export function toggleContactExclude(contactId, userId, isExcluded) {
  const db = getDb();
  db.prepare('UPDATE contacts SET is_excluded = ? WHERE id = ? AND user_id = ?').run(isExcluded ? 1 : 0, contactId, userId);
  return db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);
}

export function isContactExcluded(userId, mobile) {
  const db = getDb();
  const row = db.prepare('SELECT is_excluded FROM contacts WHERE user_id = ? AND mobile = ?').get(userId, mobile);
  return row ? row.is_excluded === 1 : false;
}

// ─── Contact Groups Helpers ───────────────────────────────────────────────────

export function getContactGroupsByUser(userId) {
  const db = getDb();
  return db.prepare(`
    SELECT cg.*,
      COUNT(DISTINCT cgm.contact_id) as member_count
    FROM contact_groups cg
    LEFT JOIN contact_group_members cgm ON cgm.group_id = cg.id
    WHERE cg.user_id = ?
    GROUP BY cg.id
    ORDER BY cg.created_at DESC
  `).all(userId);
}

export function getContactGroupById(groupId, userId) {
  const db = getDb();
  return db.prepare('SELECT * FROM contact_groups WHERE id = ? AND user_id = ?').get(groupId, userId);
}

export function createContactGroup(userId, { name, description }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO contact_groups (user_id, name, description)
    VALUES (?, ?, ?)
  `).run(userId, name.trim(), description ? description.trim() : '');
  return db.prepare(`
    SELECT cg.*, COUNT(DISTINCT cgm.contact_id) as member_count
    FROM contact_groups cg
    LEFT JOIN contact_group_members cgm ON cgm.group_id = cg.id
    WHERE cg.id = ?
    GROUP BY cg.id
  `).get(result.lastInsertRowid);
}

export function updateContactGroup(groupId, userId, { name, description }) {
  const db = getDb();
  db.prepare(`
    UPDATE contact_groups
    SET name = ?, description = ?
    WHERE id = ? AND user_id = ?
  `).run(name.trim(), description ? description.trim() : '', groupId, userId);
  return getContactGroupById(groupId, userId);
}

export function deleteContactGroup(groupId, userId) {
  const db = getDb();
  db.prepare('DELETE FROM contact_groups WHERE id = ? AND user_id = ?').run(groupId, userId);
  return { id: groupId, deleted: true };
}

export function getContactGroupMembers(groupId, userId) {
  const db = getDb();
  // Verify group belongs to user first
  const group = getContactGroupById(groupId, userId);
  if (!group) return null;
  return db.prepare(`
    SELECT c.*, cgm.id as membership_id
    FROM contact_group_members cgm
    JOIN contacts c ON c.id = cgm.contact_id
    WHERE cgm.group_id = ?
    ORDER BY c.name ASC
  `).all(groupId);
}

export function addContactsToGroup(groupId, userId, contactIds) {
  const db = getDb();
  const group = getContactGroupById(groupId, userId);
  if (!group) throw new Error('Group not found');

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO contact_group_members (group_id, contact_id)
    VALUES (?, ?)
  `);

  const addTx = db.transaction((ids) => {
    let added = 0;
    for (const contactId of ids) {
      const result = insertStmt.run(groupId, contactId);
      if (result.changes > 0) added++;
    }
    return added;
  });

  const added = addTx(contactIds);
  return { added, groupId };
}

export function removeContactFromGroup(groupId, contactId, userId) {
  const db = getDb();
  const group = getContactGroupById(groupId, userId);
  if (!group) throw new Error('Group not found');
  db.prepare('DELETE FROM contact_group_members WHERE group_id = ? AND contact_id = ?').run(groupId, contactId);
  return { groupId, contactId, removed: true };
}

export function getContactsNotInGroup(groupId, userId) {
  const db = getDb();
  return db.prepare(`
    SELECT c.*
    FROM contacts c
    WHERE c.user_id = ?
      AND c.id NOT IN (
        SELECT contact_id FROM contact_group_members WHERE group_id = ?
      )
    ORDER BY c.name ASC
  `).all(userId, groupId);
}

// Auto Reply Helpers
export function getAutoRepliesByUser(userId) {
  const db = getDb();
  return db.prepare('SELECT * FROM auto_replies WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

export function createAutoReply({ user_id, keyword, match_type = 'contains', reply_text, media_path, media_type }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO auto_replies (user_id, keyword, match_type, reply_text, media_path, media_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(user_id, keyword, match_type, reply_text || null, media_path || null, media_type || null);
  return db.prepare('SELECT * FROM auto_replies WHERE id = ?').get(result.lastInsertRowid);
}

export function deleteAutoReply(replyId, userId) {
  const db = getDb();
  db.prepare('DELETE FROM auto_replies WHERE id = ? AND user_id = ?').run(replyId, userId);
  return { id: replyId, deleted: true };
}

export function toggleAutoReplyActive(replyId, userId, isActive) {
  const db = getDb();
  db.prepare('UPDATE auto_replies SET is_active = ? WHERE id = ? AND user_id = ?').run(isActive ? 1 : 0, replyId, userId);
  return db.prepare('SELECT * FROM auto_replies WHERE id = ?').get(replyId);
}

// Scheduled Reminders Helpers
export function getRemindersByUser(userId) {
  const db = getDb();
  return db.prepare(`
    SELECT r.*, c.name as contact_name
    FROM reminders r
    LEFT JOIN contacts c ON c.id = r.contact_id
    WHERE r.user_id = ?
    ORDER BY r.scheduled_at DESC
  `).all(userId);
}

export function calculateNextScheduleDate(selectedDays, sendTimeStr, fromDate = new Date()) {
  const dayNameMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  
  let targetHour = 9, targetMin = 0;
  if (sendTimeStr && sendTimeStr.includes(':')) {
    const parts = sendTimeStr.split(':').map(Number);
    if (!isNaN(parts[0])) targetHour = parts[0];
    if (!isNaN(parts[1])) targetMin = parts[1];
  }

  let dayList = [];
  if (Array.isArray(selectedDays)) {
    dayList = selectedDays.map(d => String(d).toLowerCase().trim());
  } else if (typeof selectedDays === 'string') {
    dayList = selectedDays.split(',').map(d => d.toLowerCase().trim());
  }

  const isAllDays = dayList.length === 0 || dayList.includes('all');
  
  // IST offset is UTC + 5h 30m (330 minutes)
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

  // Convert fromDate to IST Date representation
  const fromIst = new Date(fromDate.getTime() + IST_OFFSET_MS);

  const startYear = fromIst.getUTCFullYear();
  const startMonth = fromIst.getUTCMonth();
  const startDate = fromIst.getUTCDate();

  for (let offsetDays = 0; offsetDays <= 7; offsetDays++) {
    // candidate in IST (expressed in UTC components)
    const candidateIstMs = Date.UTC(startYear, startMonth, startDate + offsetDays, targetHour, targetMin, 0, 0);
    // convert back to actual UTC Date timestamp
    const candidateUtcMs = candidateIstMs - IST_OFFSET_MS;

    if (candidateUtcMs <= fromDate.getTime()) {
      continue;
    }

    const candidateIstDate = new Date(candidateIstMs);
    const candidateDayOfWeek = candidateIstDate.getUTCDay();

    if (isAllDays) {
      return new Date(candidateUtcMs).toISOString();
    }

    const matchesDay = dayList.some(dayStr => {
      const targetDayNum = dayNameMap[dayStr];
      return targetDayNum !== undefined && targetDayNum === candidateDayOfWeek;
    });

    if (matchesDay) {
      return new Date(candidateUtcMs).toISOString();
    }
  }

  const fallbackIstMs = Date.UTC(startYear, startMonth, startDate + 1, targetHour, targetMin, 0, 0);
  return new Date(fallbackIstMs - IST_OFFSET_MS).toISOString();
}

export function createReminder({ user_id, contact_id, recipient_mobile, recipient_name, shop_name, message_template, scheduled_at, repeat_option, selected_days, send_time }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO reminders (user_id, contact_id, recipient_mobile, recipient_name, shop_name, message_template, scheduled_at, repeat_option, selected_days, send_time, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(user_id, contact_id || null, recipient_mobile, recipient_name || null, shop_name || null, message_template, scheduled_at, repeat_option || 'once', selected_days || null, send_time || null);
  return db.prepare('SELECT * FROM reminders WHERE id = ?').get(result.lastInsertRowid);
}

export function deleteReminder(reminderId, userId) {
  const db = getDb();
  db.prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?').run(reminderId, userId);
  return { id: reminderId, deleted: true };
}

export function getPendingReminders() {
  const db = getDb();
  const now = new Date().toISOString();
  return db.prepare(`
    SELECT r.*, u.id as user_id, u.name as user_name
    FROM reminders r
    JOIN users u ON u.id = r.user_id
    WHERE r.status = 'pending' AND r.scheduled_at <= ?
  `).all(now);
}

export function updateReminderStatus(reminderId, status, errorMsg = null) {
  const db = getDb();
  db.prepare(`
    UPDATE reminders
    SET status = ?,
        sent_at = CASE WHEN ? = 'sent' THEN datetime('now') ELSE sent_at END,
        error_message = ?,
        created_at = created_at
    WHERE id = ?
  `).run(status, status, errorMsg || null, reminderId);
}

// ─── Message Templates Helpers ────────────────────────────────────────────────
export function getTemplatesByUser(userId) {
  const db = getDb();
  return db.prepare('SELECT * FROM message_templates WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

export function createTemplate({ user_id, title, content, category }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO message_templates (user_id, title, content, category)
    VALUES (?, ?, ?, ?)
  `).run(user_id, title, content, category || 'General');
  return db.prepare('SELECT * FROM message_templates WHERE id = ?').get(result.lastInsertRowid);
}

export function updateTemplate(templateId, userId, { title, content, category }) {
  const db = getDb();
  db.prepare(`
    UPDATE message_templates
    SET title = ?, content = ?, category = ?
    WHERE id = ? AND user_id = ?
  `).run(title, content, category || 'General', templateId, userId);
  return db.prepare('SELECT * FROM message_templates WHERE id = ? AND user_id = ?').get(templateId, userId);
}

export function deleteTemplate(templateId, userId) {
  const db = getDb();
  db.prepare('DELETE FROM message_templates WHERE id = ? AND user_id = ?').run(templateId, userId);
  return { id: templateId, deleted: true };
}

// ─── Automation Settings Helpers (Welcome & Away Messages) ───────────────────
export function getAutomationSettings(userId) {
  const db = getDb();
  const settings = db.prepare('SELECT * FROM automation_settings WHERE user_id = ?').get(userId);
  if (!settings) {
    // Default settings
    return {
      user_id: userId,
      welcome_active: 0,
      welcome_text: 'Hello {Name}! Welcome to {ShopName}. How can we assist you today?',
      welcome_media_path: null,
      welcome_media_type: null,
      away_active: 0,
      away_text: 'Thank you for contacting us! We are currently away and will reply to your message as soon as possible.',
      away_schedule_type: 'always',
      away_start_time: '19:00',
      away_end_time: '09:00'
    };
  }
  return settings;
}

export function upsertAutomationSettings(userId, settings) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM automation_settings WHERE user_id = ?').get(userId);
  if (existing) {
    db.prepare(`
      UPDATE automation_settings
      SET welcome_active = COALESCE(@welcome_active, welcome_active),
          welcome_text = COALESCE(@welcome_text, welcome_text),
          welcome_media_path = COALESCE(@welcome_media_path, welcome_media_path),
          welcome_media_type = COALESCE(@welcome_media_type, welcome_media_type),
          away_active = COALESCE(@away_active, away_active),
          away_text = COALESCE(@away_text, away_text),
          away_schedule_type = COALESCE(@away_schedule_type, away_schedule_type),
          away_start_time = COALESCE(@away_start_time, away_start_time),
          away_end_time = COALESCE(@away_end_time, away_end_time),
          updated_at = datetime('now')
      WHERE user_id = @user_id
    `).run({
      user_id: userId,
      welcome_active: settings.welcome_active ?? null,
      welcome_text: settings.welcome_text ?? null,
      welcome_media_path: settings.welcome_media_path ?? null,
      welcome_media_type: settings.welcome_media_type ?? null,
      away_active: settings.away_active ?? null,
      away_text: settings.away_text ?? null,
      away_schedule_type: settings.away_schedule_type ?? null,
      away_start_time: settings.away_start_time ?? null,
      away_end_time: settings.away_end_time ?? null
    });
  } else {
    db.prepare(`
      INSERT INTO automation_settings (
        user_id, welcome_active, welcome_text, welcome_media_path, welcome_media_type,
        away_active, away_text, away_schedule_type, away_start_time, away_end_time
      ) VALUES (
        @user_id, @welcome_active, @welcome_text, @welcome_media_path, @welcome_media_type,
        @away_active, @away_text, @away_schedule_type, @away_start_time, @away_end_time
      )
    `).run({
      user_id: userId,
      welcome_active: settings.welcome_active ?? 0,
      welcome_text: settings.welcome_text || 'Hello {Name}! Welcome to {ShopName}. How can we assist you today?',
      welcome_media_path: settings.welcome_media_path || null,
      welcome_media_type: settings.welcome_media_type || null,
      away_active: settings.away_active ?? 0,
      away_text: settings.away_text || 'Thank you for contacting us! We are currently away and will reply to your message as soon as possible.',
      away_schedule_type: settings.away_schedule_type || 'always',
      away_start_time: settings.away_start_time || '19:00',
      away_end_time: settings.away_end_time || '09:00'
    });
  }
  return getAutomationSettings(userId);
}

// ─── Campaigns Helpers ───────────────────────────────────────────────────────

export function getCampaignsByUser(userId) {
  const db = getDb();
  return db.prepare('SELECT * FROM campaigns WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

export function getCampaignRecipients(campaignId) {
  const db = getDb();
  return db.prepare('SELECT * FROM campaign_recipients WHERE campaign_id = ?').all(campaignId);
}

export function getCampaignById(campaignId) {
  const db = getDb();
  return db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
}

export function createCampaign(userId, { name, message_text, media_path, media_type, scheduled_at, contacts }) {
  const db = getDb();
  let campaignId;
  
  const createTx = db.transaction(() => {
    // Insert Campaign
    const result = db.prepare(`
      INSERT INTO campaigns (user_id, name, message_text, media_path, media_type, scheduled_at, total_contacts, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(userId, name, message_text, media_path, media_type, scheduled_at || null, contacts.length);
    
    campaignId = result.lastInsertRowid;

    // Insert Recipients
    const stmt = db.prepare(`
      INSERT INTO campaign_recipients (campaign_id, contact_id, mobile, name, shop_name)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const c of contacts) {
      stmt.run(campaignId, c.id || null, c.mobile, c.name, c.shop_name);
    }
  });

  createTx();
  return db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
}

export function updateCampaignStatus(campaignId, status) {
  const db = getDb();
  db.prepare('UPDATE campaigns SET status = ? WHERE id = ?').run(status, campaignId);
  return db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
}

export function updateCampaignRecipientStatus(recipientId, status, errorMsg = null) {
  const db = getDb();
  db.prepare(`
    UPDATE campaign_recipients 
    SET status = ?, error_message = ?, sent_at = datetime('now') 
    WHERE id = ?
  `).run(status, errorMsg, recipientId);
}

export function incrementCampaignSuccess(campaignId) {
  const db = getDb();
  db.prepare('UPDATE campaigns SET successful_deliveries = successful_deliveries + 1 WHERE id = ?').run(campaignId);
}

export function incrementCampaignFailure(campaignId) {
  const db = getDb();
  db.prepare('UPDATE campaigns SET failed_deliveries = failed_deliveries + 1 WHERE id = ?').run(campaignId);
}

export function getPendingCampaigns() {
  const db = getDb();
  // Fetch campaigns that are 'pending' and their scheduled time is past, OR they are currently 'running'
  return db.prepare(`
    SELECT * FROM campaigns 
    WHERE status = 'running' 
       OR (status = 'pending' AND (scheduled_at IS NULL OR scheduled_at <= datetime('now', 'localtime')))
  `).all();
}

export function getPendingRecipients(campaignId, limit = 50) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM campaign_recipients 
    WHERE campaign_id = ? AND status = 'pending'
    LIMIT ?
  `).all(campaignId, limit);
}

// ─── Birthday Wishes Helpers ──────────────────────────────────────────────────

export function getBirthdayWishesByUser(userId) {
  const db = getDb();
  return db.prepare(`
    SELECT bw.*, c.name AS contact_name
    FROM birthday_wishes bw
    LEFT JOIN contacts c ON c.id = bw.contact_id
    WHERE bw.user_id = ?
    ORDER BY bw.birthday_date ASC
  `).all(userId);
}

export function createBirthdayWish(userId, data) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO birthday_wishes (user_id, contact_id, recipient_name, recipient_phone,
      birthday_date, birth_year, message_text, media_path, media_type, send_time, active)
    VALUES (@user_id, @contact_id, @recipient_name, @recipient_phone,
      @birthday_date, @birth_year, @message_text, @media_path, @media_type, @send_time, 1)
  `).run({
    user_id: userId,
    contact_id: data.contact_id || null,
    recipient_name: data.recipient_name,
    recipient_phone: data.recipient_phone,
    birthday_date: data.birthday_date,
    birth_year: data.birth_year || null,
    message_text: data.message_text,
    media_path: data.media_path || null,
    media_type: data.media_type || null,
    send_time: data.send_time || '09:00'
  });
  return db.prepare('SELECT * FROM birthday_wishes WHERE id = ?').get(result.lastInsertRowid);
}

export function updateBirthdayWish(id, userId, data) {
  const db = getDb();
  db.prepare(`
    UPDATE birthday_wishes SET
      recipient_name = COALESCE(@recipient_name, recipient_name),
      recipient_phone = COALESCE(@recipient_phone, recipient_phone),
      birthday_date = COALESCE(@birthday_date, birthday_date),
      birth_year = @birth_year,
      message_text = COALESCE(@message_text, message_text),
      send_time = COALESCE(@send_time, send_time),
      active = COALESCE(@active, active)
    WHERE id = @id AND user_id = @user_id
  `).run({ id, user_id: userId, ...data, birth_year: data.birth_year || null });
  return db.prepare('SELECT * FROM birthday_wishes WHERE id = ?').get(id);
}

export function deleteBirthdayWish(id, userId) {
  const db = getDb();
  return db.prepare('DELETE FROM birthday_wishes WHERE id = ? AND user_id = ?').run(id, userId);
}

export function getDueBirthdayWishes() {
  const db = getDb();
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  const month  = String(istNow.getUTCMonth() + 1).padStart(2, '0');
  const day    = String(istNow.getUTCDate()).padStart(2, '0');
  const mmdd   = `${month}-${day}`;
  const currentYear = istNow.getUTCFullYear();
  return db.prepare(`
    SELECT bw.*, u.id AS owner_user_id
    FROM birthday_wishes bw
    JOIN users u ON u.id = bw.user_id
    WHERE bw.active = 1
      AND bw.birthday_date = ?
      AND (bw.last_sent_year IS NULL OR bw.last_sent_year < ?)
  `).all(mmdd, currentYear);
}


export function markBirthdayWishSent(id, year) {
  const db = getDb();
  db.prepare(`
    UPDATE birthday_wishes
    SET last_sent_year = ?, status = 'sent', last_error = NULL, last_sent_at = datetime('now')
    WHERE id = ?
  `).run(year, id);
}

export function markBirthdayWishFailed(id, errorMessage) {
  const db = getDb();
  db.prepare(`
    UPDATE birthday_wishes
    SET status = 'failed', last_error = ?
    WHERE id = ?
  `).run(errorMessage || 'Unknown error', id);
}

// ─── Payment Reminder Helpers ─────────────────────────────────────────────────

export function getPaymentRemindersByUser(userId) {
  const db = getDb();
  return db.prepare(`
    SELECT pr.*, c.name AS contact_name
    FROM payment_reminders pr
    LEFT JOIN contacts c ON c.id = pr.contact_id
    WHERE pr.user_id = ?
    ORDER BY pr.due_date ASC
  `).all(userId);
}

export function createPaymentReminder(userId, data) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO payment_reminders (user_id, contact_id, recipient_name, recipient_phone,
      amount, currency, due_date, message_text, media_path, media_type, remind_days_before, status, active)
    VALUES (@user_id, @contact_id, @recipient_name, @recipient_phone,
      @amount, @currency, @due_date, @message_text, @media_path, @media_type, @remind_days_before, 'pending', 1)
  `).run({
    user_id: userId,
    contact_id: data.contact_id || null,
    recipient_name: data.recipient_name,
    recipient_phone: data.recipient_phone,
    amount: data.amount || null,
    currency: data.currency || 'INR',
    due_date: data.due_date,
    message_text: data.message_text,
    media_path: data.media_path || null,
    media_type: data.media_type || null,
    remind_days_before: data.remind_days_before || 1
  });
  return db.prepare('SELECT * FROM payment_reminders WHERE id = ?').get(result.lastInsertRowid);
}

export function updatePaymentReminderStatus(id, userId, status) {
  const db = getDb();
  db.prepare('UPDATE payment_reminders SET status = ? WHERE id = ? AND user_id = ?').run(status, id, userId);
  return db.prepare('SELECT * FROM payment_reminders WHERE id = ?').get(id);
}

export function deletePaymentReminder(id, userId) {
  const db = getDb();
  return db.prepare('DELETE FROM payment_reminders WHERE id = ? AND user_id = ?').run(id, userId);
}

// ─── Order Notification Helpers ───────────────────────────────────────────────

export function getOrderNotificationsByUser(userId) {
  const db = getDb();
  return db.prepare(`
    SELECT orn.*, c.name AS contact_name
    FROM order_notifications orn
    LEFT JOIN contacts c ON c.id = orn.contact_id
    WHERE orn.user_id = ?
    ORDER BY orn.created_at DESC
  `).all(userId);
}

export function createOrderNotification(userId, data) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO order_notifications (user_id, contact_id, recipient_name, recipient_phone,
      order_id, order_status, product_name, amount, currency, message_text,
      media_path, media_type, send_immediately, scheduled_at, status)
    VALUES (@user_id, @contact_id, @recipient_name, @recipient_phone,
      @order_id, @order_status, @product_name, @amount, @currency, @message_text,
      @media_path, @media_type, @send_immediately, @scheduled_at, 'pending')
  `).run({
    user_id: userId,
    contact_id: data.contact_id || null,
    recipient_name: data.recipient_name,
    recipient_phone: data.recipient_phone,
    order_id: data.order_id,
    order_status: data.order_status || 'placed',
    product_name: data.product_name || null,
    amount: data.amount || null,
    currency: data.currency || 'INR',
    message_text: data.message_text,
    media_path: data.media_path || null,
    media_type: data.media_type || null,
    send_immediately: data.send_immediately !== false ? 1 : 0,
    scheduled_at: data.scheduled_at || null
  });
  return db.prepare('SELECT * FROM order_notifications WHERE id = ?').get(result.lastInsertRowid);
}

export function updateOrderNotificationStatus(id, userId, status, sentAt) {
  const db = getDb();
  db.prepare('UPDATE order_notifications SET status = ?, sent_at = ? WHERE id = ? AND user_id = ?')
    .run(status, sentAt || null, id, userId);
  return db.prepare('SELECT * FROM order_notifications WHERE id = ?').get(id);
}

export function deleteOrderNotification(id, userId) {
  const db = getDb();
  return db.prepare('DELETE FROM order_notifications WHERE id = ? AND user_id = ?').run(id, userId);
}

export function getPendingOrderNotifications() {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM order_notifications
    WHERE status = 'pending'
      AND (send_immediately = 1 OR (scheduled_at IS NOT NULL AND scheduled_at <= datetime('now', 'localtime')))
  `).all();
}

// ─── Follow-up Automation Helpers ─────────────────────────────────────────────

export function getFollowupAutomationsByUser(userId) {
  const db = getDb();
  return db.prepare(`
    SELECT fa.*,
      COUNT(CASE WHEN fsl.status = 'sent' THEN 1 END) AS sent_count,
      COUNT(CASE WHEN fsl.status = 'failed' THEN 1 END) AS failed_count,
      MAX(fsl.sent_at) AS last_sent_at
    FROM followup_automations fa
    LEFT JOIN followup_sent_log fsl ON fsl.automation_id = fa.id
    WHERE fa.user_id = ?
    GROUP BY fa.id
    ORDER BY fa.created_at DESC
  `).all(userId);
}

export function createFollowupAutomation(userId, data) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO followup_automations (user_id, name, trigger_event, delay_days,
      message_text, media_path, media_type, active, apply_to)
    VALUES (@user_id, @name, @trigger_event, @delay_days,
      @message_text, @media_path, @media_type, 1, @apply_to)
  `).run({
    user_id: userId,
    name: data.name,
    trigger_event: data.trigger_event || 'no_response',
    delay_days: data.delay_days || 3,
    message_text: data.message_text,
    media_path: data.media_path || null,
    media_type: data.media_type || null,
    apply_to: data.apply_to || 'all'
  });
  return db.prepare('SELECT * FROM followup_automations WHERE id = ?').get(result.lastInsertRowid);
}

export function updateFollowupAutomation(id, userId, data) {
  const db = getDb();
  db.prepare(`
    UPDATE followup_automations SET
      name = COALESCE(@name, name),
      trigger_event = COALESCE(@trigger_event, trigger_event),
      delay_days = COALESCE(@delay_days, delay_days),
      message_text = COALESCE(@message_text, message_text),
      active = COALESCE(@active, active),
      apply_to = COALESCE(@apply_to, apply_to)
    WHERE id = @id AND user_id = @user_id
  `).run({ id, user_id: userId, name: data.name || null, trigger_event: data.trigger_event || null,
    delay_days: data.delay_days || null, message_text: data.message_text || null,
    active: data.active ?? null, apply_to: data.apply_to || null });
  return db.prepare('SELECT * FROM followup_automations WHERE id = ?').get(id);
}

export function deleteFollowupAutomation(id, userId) {
  const db = getDb();
  return db.prepare('DELETE FROM followup_automations WHERE id = ? AND user_id = ?').run(id, userId);
}

export function getFollowupLogsByUser(userId) {
  const db = getDb();
  return db.prepare(`
    SELECT fsl.*, fa.name AS automation_name, c.name AS contact_name, c.mobile AS contact_mobile
    FROM followup_sent_log fsl
    JOIN followup_automations fa ON fa.id = fsl.automation_id
    LEFT JOIN contacts c ON c.id = fsl.contact_id
    WHERE fsl.user_id = ?
    ORDER BY fsl.sent_at DESC
    LIMIT 50
  `).all(userId);
}

export function deleteFollowupLog(id, userId) {
  const db = getDb();
  return db.prepare('DELETE FROM followup_sent_log WHERE id = ? AND user_id = ?').run(id, userId);
}
