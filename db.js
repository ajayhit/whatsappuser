import Database from 'better-sqlite3';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, 'database.db');

let sqliteDb = null;
let pgPool = null;

// Lightweight in-memory TTL cache to eliminate redundant WAN round-trips to Neon PostgreSQL
const memoryCache = new Map();

function getCached(key, ttlMs = 30000) {
  const item = memoryCache.get(key);
  if (item && (Date.now() - item.time < ttlMs)) {
    return item.value;
  }
  return undefined;
}

function setCached(key, value) {
  memoryCache.set(key, { value, time: Date.now() });
}

export function invalidateCache(prefix) {
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key);
    }
  }
}

// Clean up expired cache items every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, item] of memoryCache.entries()) {
    if (now - item.time > 60000) {
      memoryCache.delete(key);
    }
  }
}, 15 * 60 * 1000);

export function isPg() {
  return !!(process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== '');
}

export function getPgPool() {
  if (!pgPool && isPg()) {
    const databaseUrl = process.env.DATABASE_URL.trim();
    const isLocalhost = databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1');
    pgPool = new pg.Pool({
      connectionString: databaseUrl,
      ssl: isLocalhost ? false : { rejectUnauthorized: false },
      max: 2, // Minimal connection pool for low memory and fast idle suspend on Neon
      idleTimeoutMillis: 3000, // Drop idle connections after 3s to allow Neon to auto-suspend
      connectionTimeoutMillis: 10000,
      allowExitOnIdle: true
    });
  }
  return pgPool;
}

export function getDb() {
  if (isPg()) {
    return getPgPool();
  }
  if (!sqliteDb) {
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const seedDbPath = fs.existsSync(path.join(__dirname, 'database.seed.db'))
      ? path.join(__dirname, 'database.seed.db')
      : path.join(__dirname, 'database.db');

    if (DB_PATH !== seedDbPath && (!fs.existsSync(DB_PATH) || fs.statSync(DB_PATH).size === 0) && fs.existsSync(seedDbPath)) {
      try {
        fs.copyFileSync(seedDbPath, DB_PATH);
        console.log(`[DB] Successfully initialized database from template ${seedDbPath} to ${DB_PATH}`);
      } catch (copyErr) {
        console.error('[DB] Error copying seed template to persistent storage:', copyErr);
      }
    }

    sqliteDb = new Database(DB_PATH);
    sqliteDb.pragma('journal_mode = WAL');
    sqliteDb.pragma('foreign_keys = ON');
  }
  return sqliteDb;
}

export function getDbPath() {
  return DB_PATH;
}

export function checkpointDb() {
  if (sqliteDb && !isPg()) {
    try {
      sqliteDb.pragma('wal_checkpoint(TRUNCATE)');
    } catch (e) {
      console.error('[DB] Checkpoint error:', e);
    }
  }
}

export function closeDb() {
  if (isPg() && pgPool) {
    pgPool.end().catch(e => console.error('[DB] Error closing PG pool:', e));
    pgPool = null;
  } else if (sqliteDb) {
    try {
      sqliteDb.pragma('wal_checkpoint(TRUNCATE)');
      sqliteDb.close();
    } catch (e) {
      console.error('[DB] Error closing database:', e);
    }
    sqliteDb = null;
  }
}

export async function reloadDb() {
  closeDb();
  await initDb();
}

function transformPgQuery(sql, params) {
  let text = sql;
  let values = [];

  // Convert SQLite functions to PostgreSQL functions
  text = text.replace(/datetime\('now'\)/gi, 'NOW()');
  text = text.replace(/datetime\('now',\s*'localtime'\)/gi, 'NOW()');

  if (Array.isArray(params)) {
    let idx = 1;
    text = text.replace(/\?/g, () => `$${idx++}`);
    values = [...params];
  } else if (params && typeof params === 'object') {
    let idx = 1;
    text = text.replace(/@([a-zA-Z0-9_]+)/g, (match, key) => {
      values.push(params[key] !== undefined ? params[key] : null);
      return `$${idx++}`;
    });
  }

  if (text.toUpperCase().includes('INSERT OR IGNORE INTO')) {
    text = text.replace(/INSERT OR IGNORE INTO/gi, 'INSERT INTO');
    if (!text.toUpperCase().includes('ON CONFLICT')) {
      text += ' ON CONFLICT DO NOTHING';
    }
  }

  return { text, values };
}

export async function queryOne(sql, params = []) {
  if (isPg()) {
    const { text, values } = transformPgQuery(sql, params);
    const res = await getPgPool().query(text, values);
    return res.rows[0] || null;
  } else {
    const db = getDb();
    if (Array.isArray(params)) {
      return db.prepare(sql).get(...params);
    } else if (params && typeof params === 'object') {
      return db.prepare(sql).get(params);
    }
    return db.prepare(sql).get();
  }
}

export async function queryAll(sql, params = []) {
  if (isPg()) {
    const { text, values } = transformPgQuery(sql, params);
    const res = await getPgPool().query(text, values);
    return res.rows;
  } else {
    const db = getDb();
    if (Array.isArray(params)) {
      return db.prepare(sql).all(...params);
    } else if (params && typeof params === 'object') {
      return db.prepare(sql).all(params);
    }
    return db.prepare(sql).all();
  }
}

export async function execute(sql, params = []) {
  if (isPg()) {
    let { text, values } = transformPgQuery(sql, params);
    const shouldAppendReturning = text.trim().toUpperCase().startsWith('INSERT') &&
      !text.toUpperCase().includes('RETURNING') &&
      !text.toUpperCase().includes('WHATSAPP_SESSION_AUTH') &&
      !text.toUpperCase().includes('SETTINGS');

    if (shouldAppendReturning) {
      text += ' RETURNING id';
    }

    try {
      const res = await getPgPool().query(text, values);
      return {
        changes: res.rowCount,
        lastInsertRowid: res.rows?.[0]?.id || null,
        rows: res.rows || []
      };
    } catch (err) {
      if (shouldAppendReturning && err.message && err.message.includes('"id" does not exist')) {
        const cleanText = text.replace(/\s+RETURNING id$/i, '');
        const res = await getPgPool().query(cleanText, values);
        return {
          changes: res.rowCount,
          lastInsertRowid: null,
          rows: res.rows || []
        };
      }
      throw err;
    }
  } else {
    const db = getDb();
    let info;
    if (Array.isArray(params)) {
      info = db.prepare(sql).run(...params);
    } else if (params && typeof params === 'object') {
      info = db.prepare(sql).run(params);
    } else {
      info = db.prepare(sql).run();
    }
    return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
  }
}

export async function initDb() {
  if (isPg()) {
    const pool = getPgPool();
    const client = await pool.connect();
    try {
      console.log('[DB] Initializing PostgreSQL schema...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          phone TEXT,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'user',
          wallet_balance DOUBLE PRECISION NOT NULL DEFAULT 0,
          is_blocked INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS banks (
          id SERIAL PRIMARY KEY,
          bank_name TEXT NOT NULL,
          account_number TEXT NOT NULL,
          ifsc TEXT NOT NULL,
          account_holder TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS plans (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id),
          status TEXT NOT NULL DEFAULT 'pending',
          started_at TIMESTAMP WITH TIME ZONE,
          expires_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          plan_type TEXT NOT NULL DEFAULT 'plan_28',
          duration_days INTEGER NOT NULL DEFAULT 28,
          price DOUBLE PRECISION NOT NULL DEFAULT 199
        );

        CREATE TABLE IF NOT EXISTS orders (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id),
          amount DOUBLE PRECISION NOT NULL DEFAULT 149,
          utr TEXT NOT NULL,
          bank_name TEXT NOT NULL,
          account_name TEXT NOT NULL,
          screenshot_path TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          notes TEXT,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          confirmed_at TIMESTAMP WITH TIME ZONE,
          plan_type TEXT,
          payment_method TEXT DEFAULT 'bank_transfer',
          razorpay_order_id TEXT,
          razorpay_payment_id TEXT
        );

        CREATE TABLE IF NOT EXISTS wallet_transactions (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id),
          type TEXT NOT NULL,
          amount DOUBLE PRECISION NOT NULL,
          description TEXT,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS password_resets (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id),
          token TEXT NOT NULL,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          used INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS paytm_account (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          paytm_userid TEXT,
          paytm_password TEXT,
          number TEXT,
          session_name TEXT,
          token_name TEXT,
          qr_details TEXT,
          login_status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
          otp_requested_at TIMESTAMP WITH TIME ZONE,
          last_login_at TIMESTAMP WITH TIME ZONE,
          last_refresh_at TIMESTAMP WITH TIME ZONE,
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS digital_catalog (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
          brand_name TEXT NOT NULL,
          logo_path TEXT,
          description TEXT,
          catalog_audio_path TEXT,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS catalog_services (
          id SERIAL PRIMARY KEY,
          catalog_id INTEGER NOT NULL REFERENCES digital_catalog(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT,
          price DOUBLE PRECISION NOT NULL,
          image_path TEXT,
          audio_path TEXT,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS contacts (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          mobile TEXT NOT NULL,
          shop_name TEXT,
          is_excluded INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          email TEXT,
          birthday TEXT,
          UNIQUE(user_id, mobile)
        );

        CREATE TABLE IF NOT EXISTS contact_groups (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS contact_group_members (
          id SERIAL PRIMARY KEY,
          group_id INTEGER NOT NULL REFERENCES contact_groups(id) ON DELETE CASCADE,
          contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          UNIQUE(group_id, contact_id)
        );

        CREATE TABLE IF NOT EXISTS auto_replies (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          keyword TEXT NOT NULL,
          match_type TEXT NOT NULL DEFAULT 'contains',
          reply_text TEXT,
          media_path TEXT,
          media_type TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS reminders (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
          recipient_mobile TEXT NOT NULL,
          recipient_name TEXT,
          shop_name TEXT,
          message_template TEXT NOT NULL,
          scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          sent_at TIMESTAMP WITH TIME ZONE,
          error_message TEXT,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          repeat_option TEXT DEFAULT 'once',
          selected_days TEXT,
          send_time TEXT
        );

        CREATE TABLE IF NOT EXISTS message_templates (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          category TEXT DEFAULT 'General',
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS automation_settings (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
          welcome_active INTEGER NOT NULL DEFAULT 0,
          welcome_text TEXT,
          welcome_media_path TEXT,
          welcome_media_type TEXT,
          away_active INTEGER NOT NULL DEFAULT 0,
          away_text TEXT,
          away_schedule_type TEXT DEFAULT 'always',
          away_start_time TEXT,
          away_end_time TEXT,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE
        );

        CREATE TABLE IF NOT EXISTS campaigns (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          message_text TEXT NOT NULL,
          media_path TEXT,
          media_type TEXT,
          scheduled_at TIMESTAMP WITH TIME ZONE,
          status TEXT NOT NULL DEFAULT 'pending',
          total_contacts INTEGER DEFAULT 0,
          successful_deliveries INTEGER DEFAULT 0,
          failed_deliveries INTEGER DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS campaign_recipients (
          id SERIAL PRIMARY KEY,
          campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
          mobile TEXT NOT NULL,
          name TEXT,
          shop_name TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          error_message TEXT,
          sent_at TIMESTAMP WITH TIME ZONE
        );

        CREATE TABLE IF NOT EXISTS expiry_notification_logs (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          category TEXT NOT NULL,
          sent_at TIMESTAMP WITH TIME ZONE NOT NULL
        );

        CREATE TABLE IF NOT EXISTS birthday_wishes (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
          recipient_name TEXT NOT NULL,
          recipient_phone TEXT NOT NULL,
          birthday_date TEXT NOT NULL,
          birth_year TEXT,
          message_text TEXT NOT NULL,
          media_path TEXT,
          media_type TEXT,
          send_time TEXT DEFAULT '09:00',
          active INTEGER NOT NULL DEFAULT 1,
          last_sent_year INTEGER,
          status TEXT NOT NULL DEFAULT 'pending',
          last_error TEXT,
          last_sent_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS payment_reminders (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
          recipient_name TEXT NOT NULL,
          recipient_phone TEXT NOT NULL,
          amount DOUBLE PRECISION,
          currency TEXT DEFAULT 'INR',
          due_date TEXT NOT NULL,
          message_text TEXT NOT NULL,
          media_path TEXT,
          media_type TEXT,
          remind_days_before INTEGER DEFAULT 1,
          status TEXT DEFAULT 'pending',
          active INTEGER NOT NULL DEFAULT 1,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS order_notifications (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
          recipient_name TEXT NOT NULL,
          recipient_phone TEXT NOT NULL,
          order_id TEXT NOT NULL,
          order_status TEXT NOT NULL DEFAULT 'placed',
          product_name TEXT,
          amount DOUBLE PRECISION,
          currency TEXT DEFAULT 'INR',
          message_text TEXT NOT NULL,
          media_path TEXT,
          media_type TEXT,
          send_immediately INTEGER DEFAULT 1,
          scheduled_at TIMESTAMP WITH TIME ZONE,
          sent_at TIMESTAMP WITH TIME ZONE,
          status TEXT DEFAULT 'pending',
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS followup_automations (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          trigger_event TEXT NOT NULL DEFAULT 'no_response',
          delay_days INTEGER NOT NULL DEFAULT 3,
          message_text TEXT NOT NULL,
          media_path TEXT,
          media_type TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          apply_to TEXT DEFAULT 'all',
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS followup_sent_log (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          automation_id INTEGER NOT NULL REFERENCES followup_automations(id) ON DELETE CASCADE,
          contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'sent',
          error_message TEXT,
          sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS whatsapp_session_auth (
          user_id TEXT NOT NULL,
          file_name TEXT NOT NULL,
          file_data TEXT NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, file_name)
        );

        CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id);
        CREATE INDEX IF NOT EXISTS idx_contacts_user_mobile ON contacts(user_id, mobile);
        CREATE INDEX IF NOT EXISTS idx_campaigns_status_sched ON campaigns(status, scheduled_at);
        CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);
        CREATE INDEX IF NOT EXISTS idx_campaign_recipients_camp_status ON campaign_recipients(campaign_id, status);
        CREATE INDEX IF NOT EXISTS idx_reminders_status_sched ON reminders(status, scheduled_at);
        CREATE INDEX IF NOT EXISTS idx_reminders_user_id ON reminders(user_id);
        CREATE INDEX IF NOT EXISTS idx_payment_reminders_active_status ON payment_reminders(active, status, due_date);
        CREATE INDEX IF NOT EXISTS idx_payment_reminders_user_id ON payment_reminders(user_id);
        CREATE INDEX IF NOT EXISTS idx_birthday_wishes_user_id ON birthday_wishes(user_id);
        CREATE INDEX IF NOT EXISTS idx_followup_auto_user_active ON followup_automations(user_id, active);
        CREATE INDEX IF NOT EXISTS idx_followup_sent_log_lookup ON followup_sent_log(user_id, automation_id, contact_id);
        CREATE INDEX IF NOT EXISTS idx_plans_user_status ON plans(user_id, status, expires_at);
        CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status);
        CREATE INDEX IF NOT EXISTS idx_auto_replies_user_active ON auto_replies(user_id, is_active);
        CREATE INDEX IF NOT EXISTS idx_digital_catalog_user_id ON digital_catalog(user_id);
      `);

      const defaultPrices = {
        plan_price: '199',
        plan_price_demo: '0',
        plan_price_28: '199',
        plan_price_quarter: '549',
        plan_price_half_year: '999',
        plan_price_year: '1899',
        admin_whatsapp_number: process.env.ADMIN_WHATSAPP_NUMBER || '',
        razorpay_key_id: process.env.RAZORPAY_KEY_ID || '',
        razorpay_key_secret: process.env.RAZORPAY_KEY_SECRET || ''
      };
      for (const [key, val] of Object.entries(defaultPrices)) {
        await client.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, val]);
      }

      const adminEmail = process.env.ADMIN_EMAIL || 'admin@whatsapp.local';
      const adminPassword = process.env.ADMIN_PASSWORD || 'adminpassword123';
      const adminCheck = await client.query("SELECT id FROM users WHERE role = 'admin' OR email = $1", [adminEmail]);
      if (adminCheck.rows.length === 0) {
        const password_hash = bcrypt.hashSync(adminPassword, 10);
        await client.query(`
          INSERT INTO users (name, email, phone, password_hash, role)
          VALUES ('System Admin', $1, $2, $3, 'admin')
        `, [adminEmail, process.env.ADMIN_WHATSAPP_NUMBER || '', password_hash]);
        console.log(`[DB] Default admin created in PG: ${adminEmail}`);
      }

      console.log('[DB] All PostgreSQL tables and indexes initialized.');
    } finally {
      client.release();
    }
    return;
  }

  // SQLite Initialization
  const db = getDb();

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

  try {
    db.exec("ALTER TABLE users ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0");
  } catch (err) {}

  try {
    db.prepare(`
      UPDATE users
      SET role = 'user'
      WHERE role IS NULL OR TRIM(role) = '' OR role NOT IN ('user', 'admin')
    `).run();
  } catch (err) {}

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

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  const defaultPrices = {
    plan_price: '199',
    plan_price_demo: '0',
    plan_price_28: '199',
    plan_price_quarter: '549',
    plan_price_half_year: '999',
    plan_price_year: '1899',
    admin_whatsapp_number: process.env.ADMIN_WHATSAPP_NUMBER || '',
    razorpay_key_id: process.env.RAZORPAY_KEY_ID || '',
    razorpay_key_secret: process.env.RAZORPAY_KEY_SECRET || ''
  };
  for (const [key, val] of Object.entries(defaultPrices)) {
    try {
      db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, val);
    } catch (e) {}
  }

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

  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      message_text TEXT NOT NULL,
      media_path TEXT,
      media_type TEXT,
      scheduled_at TEXT, 
      status TEXT NOT NULL DEFAULT 'pending',
      total_contacts INTEGER DEFAULT 0,
      successful_deliveries INTEGER DEFAULT 0,
      failed_deliveries INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS campaign_recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      contact_id INTEGER,
      mobile TEXT NOT NULL,
      name TEXT,
      shop_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      sent_at TEXT,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS expiry_notification_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS birthday_wishes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      contact_id INTEGER,
      recipient_name TEXT NOT NULL,
      recipient_phone TEXT NOT NULL,
      birthday_date TEXT NOT NULL,
      birth_year TEXT,
      message_text TEXT NOT NULL,
      media_path TEXT,
      media_type TEXT,
      send_time TEXT DEFAULT '09:00',
      active INTEGER NOT NULL DEFAULT 1,
      last_sent_year INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      contact_id INTEGER,
      recipient_name TEXT NOT NULL,
      recipient_phone TEXT NOT NULL,
      amount REAL,
      currency TEXT DEFAULT 'INR',
      due_date TEXT NOT NULL,
      message_text TEXT NOT NULL,
      media_path TEXT,
      media_type TEXT,
      remind_days_before INTEGER DEFAULT 1,
      status TEXT DEFAULT 'pending',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS order_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      contact_id INTEGER,
      recipient_name TEXT NOT NULL,
      recipient_phone TEXT NOT NULL,
      order_id TEXT NOT NULL,
      order_status TEXT NOT NULL DEFAULT 'placed',
      product_name TEXT,
      amount REAL,
      currency TEXT DEFAULT 'INR',
      message_text TEXT NOT NULL,
      media_path TEXT,
      media_type TEXT,
      send_immediately INTEGER DEFAULT 1,
      scheduled_at TEXT,
      sent_at TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS followup_automations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      trigger_event TEXT NOT NULL DEFAULT 'no_response',
      delay_days INTEGER NOT NULL DEFAULT 3,
      message_text TEXT NOT NULL,
      media_path TEXT,
      media_type TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      apply_to TEXT DEFAULT 'all',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

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
    );

    CREATE TABLE IF NOT EXISTS whatsapp_session_auth (
      user_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_data TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, file_name)
    );
  `);

  try { db.exec("ALTER TABLE plans ADD COLUMN plan_type TEXT NOT NULL DEFAULT 'plan_28'"); } catch (e) {}
  try { db.exec("ALTER TABLE plans ADD COLUMN duration_days INTEGER NOT NULL DEFAULT 28"); } catch (e) {}
  try { db.exec("ALTER TABLE plans ADD COLUMN price REAL NOT NULL DEFAULT 199"); } catch (e) {}
  try { db.exec("ALTER TABLE orders ADD COLUMN plan_type TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE contacts ADD COLUMN email TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE contacts ADD COLUMN birthday TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE birthday_wishes ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'"); } catch (e) {}
  try { db.exec("ALTER TABLE birthday_wishes ADD COLUMN last_error TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE birthday_wishes ADD COLUMN last_sent_at TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE followup_sent_log ADD COLUMN status TEXT NOT NULL DEFAULT 'sent'"); } catch (e) {}
  try { db.exec("ALTER TABLE followup_sent_log ADD COLUMN error_message TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE reminders ADD COLUMN repeat_option TEXT DEFAULT 'once'"); } catch (e) {}
  try { db.exec("ALTER TABLE reminders ADD COLUMN selected_days TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE reminders ADD COLUMN send_time TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE orders ADD COLUMN razorpay_order_id TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE orders ADD COLUMN razorpay_payment_id TEXT"); } catch (e) {}

  try {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@whatsapp.local';
    const adminPassword = process.env.ADMIN_PASSWORD || 'adminpassword123';
    const existingAdmin = db.prepare("SELECT id FROM users WHERE role = 'admin' OR email = ?").get(adminEmail);
    if (!existingAdmin) {
      const password_hash = bcrypt.hashSync(adminPassword, 10);
      db.prepare(`
        INSERT INTO users (name, email, phone, password_hash, role)
        VALUES (?, ?, ?, ?, 'admin')
      `).run('System Admin', adminEmail, process.env.ADMIN_WHATSAPP_NUMBER || '', password_hash);
      console.log(`[DB] Default admin created: ${adminEmail}`);
    }
  } catch (err) {
    console.error('[DB] Error seeding default admin:', err.message);
  }

  console.log('[DB] All SQLite tables initialized.');
}

// ─── User Helpers ────────────────────────────────────────────────────────────

function normalizeRole(role) {
  return role === 'admin' ? 'admin' : 'user';
}

export async function createUser({ name, email, phone, password, role = 'user' }) {
  const password_hash = bcrypt.hashSync(password, 10);
  const normalizedRole = normalizeRole(role);
  const res = await execute(`
    INSERT INTO users (name, email, phone, password_hash, role)
    VALUES (?, ?, ?, ?, ?)
  `, [name, email, phone || '', password_hash, normalizedRole]);
  return await getUserById(res.lastInsertRowid);
}

export async function getUserByEmail(email) {
  return await queryOne('SELECT * FROM users WHERE email = ?', [email]);
}

export async function getUserByPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits || digits.length < 10) return null;
  const last10 = digits.slice(-10);
  return await queryOne(`
    SELECT * FROM users 
    WHERE replace(replace(phone, '+', ''), ' ', '') LIKE '%' || ?
  `, [last10]);
}

export async function getUserById(id) {
  const cacheKey = `user_${id}`;
  const cached = getCached(cacheKey, 30000);
  if (cached !== undefined) return cached;

  const user = await queryOne(`
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
  `, [id]);

  if (user) setCached(cacheKey, user);
  return user;
}

export async function updateUserProfile(userId, { name, phone }) {
  invalidateCache(`user_${userId}`);
  await execute('UPDATE users SET name = ?, phone = ? WHERE id = ?', [name, phone || '', userId]);
  return await getUserById(userId);
}

export async function getAllUsers() {
  return await queryAll(`
    SELECT u.id, u.name, u.email, u.phone,
           CASE WHEN u.role = 'admin' THEN 'admin' ELSE 'user' END AS role,
           u.wallet_balance, u.is_blocked, u.created_at,
           p.status as plan_status, p.expires_at
    FROM users u
    LEFT JOIN plans p ON p.user_id = u.id AND p.status = 'active'
    ORDER BY u.created_at DESC
  `);
}

export async function setUserBlockStatus(userId, isBlocked) {
  await execute('UPDATE users SET is_blocked = ? WHERE id = ?', [isBlocked ? 1 : 0, userId]);
  return await getUserById(userId);
}

export async function creditWallet(userId, amount, description) {
  await execute('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [amount, userId]);
  await execute(`
    INSERT INTO wallet_transactions (user_id, type, amount, description)
    VALUES (?, 'credit', ?, ?)
  `, [userId, amount, description]);
}

export async function debitWallet(userId, amount, description) {
  const user = await queryOne('SELECT wallet_balance FROM users WHERE id = ?', [userId]);
  if (!user || user.wallet_balance < amount) throw new Error('Insufficient wallet balance');
  await execute('UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?', [amount, userId]);
  await execute(`
    INSERT INTO wallet_transactions (user_id, type, amount, description)
    VALUES (?, 'debit', ?, ?)
  `, [userId, amount, description]);
}

export async function getWalletTransactions(userId) {
  return await queryAll(`
    SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC
  `, [userId]);
}

// ─── Plan Helpers ─────────────────────────────────────────────────────────────

export async function getActivePlan(userId) {
  const cacheKey = `active_plan_${userId}`;
  const cached = getCached(cacheKey, 10000);
  if (cached !== undefined) return cached;

  const plan = await queryOne(`
    SELECT * FROM plans WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1
  `, [userId]);

  // If expired by date, don't return active
  if (plan && new Date(plan.expires_at) <= new Date()) {
    setCached(cacheKey, null);
    return null;
  }

  setCached(cacheKey, plan || null);
  return plan;
}

export async function getPlansByUser(userId) {
  return await queryAll(`
    SELECT * FROM plans WHERE user_id = ? ORDER BY created_at DESC
  `, [userId]);
}

export async function activatePlan(userId, planType = 'plan_28', durationDays = 28, price = 199) {
  // Query DB directly without dirtying the cache with previous expired state
  const activePlan = await queryOne(`
    SELECT * FROM plans WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1
  `, [userId]);

  const startedAt = new Date().toISOString();
  let expiresAt;

  const additionalTime = durationDays * 24 * 60 * 60 * 1000;

  if (activePlan && new Date(activePlan.expires_at) > new Date()) {
    expiresAt = new Date(new Date(activePlan.expires_at).getTime() + additionalTime).toISOString();
  } else {
    expiresAt = new Date(Date.now() + additionalTime).toISOString();
  }

  await execute(`UPDATE plans SET status = 'expired' WHERE user_id = ? AND status = 'active'`, [userId]);

  const res = await execute(`
    INSERT INTO plans (user_id, status, started_at, expires_at, plan_type, duration_days, price)
    VALUES (?, 'active', ?, ?, ?, ?, ?)
  `, [userId, startedAt, expiresAt, planType, durationDays, price]);

  const newPlan = (res?.lastInsertRowid)
    ? await queryOne('SELECT * FROM plans WHERE id = ?', [res.lastInsertRowid])
    : await queryOne(`SELECT * FROM plans WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`, [userId]);

  // Invalidate stale cache and populate with new plan immediately
  invalidateCache(`active_plan_${userId}`);
  if (newPlan) {
    setCached(`active_plan_${userId}`, newPlan);
  }

  return newPlan;
}

export async function getPlanDetails(planType) {
  const prices = {
    demo: { name: 'Demo Plan', durationDays: 10, settingKey: 'plan_price_demo', defaultPrice: 0 },
    plan_28: { name: 'Monthly Plan', durationDays: 28, settingKey: 'plan_price_28', defaultPrice: 199 },
    quarter: { name: 'Quarter Plan', durationDays: 90, settingKey: 'plan_price_quarter', defaultPrice: 549 },
    half_year: { name: 'Half-Year Plan', durationDays: 180, settingKey: 'plan_price_half_year', defaultPrice: 999 },
    year: { name: 'Year Plan', durationDays: 365, settingKey: 'plan_price_year', defaultPrice: 1899 }
  };

  const plan = prices[planType];
  if (!plan) return null;

  const priceStr = await getSetting(plan.settingKey, String(plan.defaultPrice));
  const price = parseFloat(priceStr);

  return {
    type: planType,
    name: plan.name,
    durationDays: plan.durationDays,
    price: price
  };
}

export async function subscribeToPlan(userId, planType) {
  const planDetails = await getPlanDetails(planType);
  if (!planDetails) throw new Error('Invalid plan type');

  if (planType === 'demo') {
    const hasDemo = await queryOne(`
      SELECT COUNT(*) as count FROM plans 
      WHERE user_id = ? AND plan_type = 'demo'
    `, [userId]);
    if (hasDemo && parseInt(hasDemo.count) > 0) {
      throw new Error('You have already claimed the Demo Plan. It can only be claimed once.');
    }
  }

  if (planDetails.price > 0) {
    const user = await getUserById(userId);
    if (user.wallet_balance < planDetails.price) {
      throw new Error(`Insufficient wallet balance. You need ₹${planDetails.price} but only have ₹${user.wallet_balance.toFixed(2)}.`);
    }
    await debitWallet(userId, planDetails.price, `Subscribed to ${planDetails.name} (${planDetails.durationDays} Days)`);
  }

  const plan = await activatePlan(userId, planType, planDetails.durationDays, planDetails.price);
  return plan;
}

export async function expireOldPlans() {
  const now = new Date().toISOString();
  const res = await execute(`
    UPDATE plans SET status = 'expired'
    WHERE status = 'active' AND expires_at < ?
  `, [now]);
  if (res.changes > 0) {
    console.log(`[Plan Expiry] Expired ${res.changes} plan(s).`);
  }
}

// ─── Expiry Notification Helpers ──────────────────────────────────────────────

export async function canSendExpiryNotification(userId, minIntervalMinutes, maxPer24h) {
  const lastLog = await queryOne(`
    SELECT sent_at FROM expiry_notification_logs
    WHERE user_id = ?
    ORDER BY id DESC LIMIT 1
  `, [userId]);

  if (lastLog) {
    const minutesAgo = (Date.now() - new Date(lastLog.sent_at).getTime()) / (1000 * 60);
    if (minutesAgo < minIntervalMinutes) {
      return false;
    }
  }

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const countRow = await queryOne(`
    SELECT COUNT(*) as count FROM expiry_notification_logs
    WHERE user_id = ? AND sent_at >= ?
  `, [userId, twentyFourHoursAgo]);

  if (countRow && parseInt(countRow.count) >= maxPer24h) {
    return false;
  }

  return true;
}

export async function logExpiryNotification(userId, category) {
  await execute(`
    INSERT INTO expiry_notification_logs (user_id, category, sent_at)
    VALUES (?, ?, ?)
  `, [userId, category, new Date().toISOString()]);
}

// ─── Order Helpers ────────────────────────────────────────────────────────────

export async function createOrder({ userId, amount, utr, bank_name, account_name, screenshot_path, plan_type }) {
  const res = await execute(`
    INSERT INTO orders (user_id, amount, utr, bank_name, account_name, screenshot_path, plan_type, payment_method)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'bank_transfer')
  `, [userId, amount, utr, bank_name, account_name, screenshot_path || null, plan_type || null]);
  return await queryOne('SELECT * FROM orders WHERE id = ?', [res.lastInsertRowid]);
}

export async function createRazorpayOrder({ userId, amount, razorpayOrderId, planType }) {
  const res = await execute(`
    INSERT INTO orders
      (user_id, amount, utr, bank_name, account_name, plan_type, razorpay_order_id, payment_method)
    VALUES
      (?, ?, 'RAZORPAY', 'Razorpay', 'Online Payment', ?, ?, 'razorpay')
  `, [userId, amount, planType || 'plan_28', razorpayOrderId]);
  return await queryOne('SELECT * FROM orders WHERE id = ?', [res.lastInsertRowid]);
}

export async function confirmRazorpayOrder(razorpayOrderId, razorpayPaymentId) {
  const order = await queryOne('SELECT * FROM orders WHERE razorpay_order_id = ?', [razorpayOrderId]);
  if (!order) throw new Error('Razorpay order not found');
  if (order.status === 'confirmed') throw new Error('Order already confirmed');

  const confirmedAt = new Date().toISOString();

  await execute(`
    UPDATE orders
    SET status = 'confirmed', confirmed_at = ?, razorpay_payment_id = ?
    WHERE razorpay_order_id = ?
  `, [confirmedAt, razorpayPaymentId, razorpayOrderId]);

  let plan = null;
  if (order.plan_type && order.plan_type !== 'wallet') {
    const details = await getPlanDetails(order.plan_type);
    if (details) {
      try {
        await creditWallet(order.user_id, order.amount, `Razorpay payment received - Order #${order.id}`);
        await debitWallet(order.user_id, details.price, `${details.name} activated via Razorpay - Order #${order.id}`);
        plan = await activatePlan(order.user_id, order.plan_type, details.durationDays, details.price);
      } catch (err) {
        console.error(`[Razorpay] Plan auto-activation error: ${err.message}`);
      }
    }
  }

  return { order: await queryOne('SELECT * FROM orders WHERE id = ?', [order.id]), plan };
}

export async function getRazorpayOrderByRazorpayId(razorpayOrderId) {
  return await queryOne('SELECT * FROM orders WHERE razorpay_order_id = ?', [razorpayOrderId]);
}

export async function getOrdersByUser(userId) {
  return await queryAll(`
    SELECT o.*, u.name as user_name, u.email as user_email
    FROM orders o
    JOIN users u ON u.id = o.user_id
    WHERE o.user_id = ?
    ORDER BY o.created_at DESC
  `, [userId]);
}

export async function getAllOrders() {
  return await queryAll(`
    SELECT o.*, u.name as user_name, u.email as user_email
    FROM orders o
    JOIN users u ON u.id = o.user_id
    ORDER BY o.created_at DESC
  `);
}

export async function getOrderById(orderId) {
  return await queryOne(`
    SELECT o.*, u.name as user_name, u.email as user_email, u.phone as user_phone
    FROM orders o
    JOIN users u ON u.id = o.user_id
    WHERE o.id = ?
  `, [orderId]);
}

export async function confirmOrder(orderId) {
  const order = await queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order) throw new Error('Order not found');
  if (order.status !== 'pending') throw new Error(`Order is already ${order.status}`);

  const confirmedAt = new Date().toISOString();

  await execute(`
    UPDATE orders SET status = 'confirmed', confirmed_at = ? WHERE id = ?
  `, [confirmedAt, orderId]);

  await creditWallet(order.user_id, order.amount, `Plan deposit confirmed - Order #${orderId}`);

  let plan = null;
  if (order.plan_type && order.plan_type !== 'wallet') {
    const details = await getPlanDetails(order.plan_type);
    if (details) {
      try {
        await debitWallet(order.user_id, details.price, `₹${details.price} / ${details.name} activated - Order #${orderId}`);
        plan = await activatePlan(order.user_id, order.plan_type, details.durationDays, details.price);
      } catch (err) {
        console.error(`Auto-activation failed on confirmOrder: ${err.message}`);
      }
    }
  }

  return { order: await queryOne('SELECT * FROM orders WHERE id = ?', [orderId]), plan };
}

export async function rejectOrder(orderId, notes) {
  const order = await queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order) throw new Error('Order not found');
  if (order.status !== 'pending') throw new Error(`Order is already ${order.status}`);

  await execute(`
    UPDATE orders SET status = 'rejected', notes = ? WHERE id = ?
  `, [notes || 'Rejected by admin', orderId]);

  return await queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
}

export function verifyPassword(plaintext, hash) {
  return bcrypt.compareSync(plaintext, hash);
}

// ─── Settings Helpers ─────────────────────────────────────────────────────────

export async function getSetting(key, defaultValue = '') {
  const row = await queryOne('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : defaultValue;
}

export async function setSetting(key, value) {
  if (isPg()) {
    await execute('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, String(value)]);
  } else {
    await execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)]);
  }
  return { key, value };
}

// ─── Bank Helpers ─────────────────────────────────────────────────────────────

export async function getBanks(onlyActive = false) {
  if (onlyActive) {
    return await queryAll('SELECT * FROM banks WHERE is_active = 1 ORDER BY id ASC');
  }
  return await queryAll('SELECT * FROM banks ORDER BY id ASC');
}

export async function createBank({ bank_name, account_number, ifsc, account_holder }) {
  const res = await execute(`
    INSERT INTO banks (bank_name, account_number, ifsc, account_holder)
    VALUES (?, ?, ?, ?)
  `, [bank_name, account_number, ifsc, account_holder]);
  return await queryOne('SELECT * FROM banks WHERE id = ?', [res.lastInsertRowid]);
}

export async function updateBank(id, { bank_name, account_number, ifsc, account_holder, is_active }) {
  await execute(`
    UPDATE banks
    SET bank_name = ?, account_number = ?, ifsc = ?, account_holder = ?, is_active = ?
    WHERE id = ?
  `, [bank_name, account_number, ifsc, account_holder, is_active ? 1 : 0, id]);
  return await queryOne('SELECT * FROM banks WHERE id = ?', [id]);
}

export async function deleteBank(id) {
  await execute('DELETE FROM banks WHERE id = ?', [id]);
  return { id, deleted: true };
}

async function ensurePaytmAccount() {
  if (isPg()) {
    await execute(`
      INSERT INTO paytm_account (id, login_status)
      VALUES (1, 'NOT_CONFIGURED')
      ON CONFLICT (id) DO NOTHING
    `);
  } else {
    await execute(`
      INSERT OR IGNORE INTO paytm_account (id, login_status)
      VALUES (1, 'NOT_CONFIGURED')
    `);
  }
}

export async function getPaytmAccount() {
  await ensurePaytmAccount();
  return await queryOne('SELECT * FROM paytm_account WHERE id = 1');
}

export async function startPaytmLogin({ paytm_userid, paytm_password }) {
  await ensurePaytmAccount();
  const current = await getPaytmAccount();
  if (current.login_status === 'LOGGED_IN') {
    return { alreadyLoggedIn: true, account: current };
  }

  const now = new Date().toISOString();
  const sessionName = current.session_name || `paytm_session_${Date.now()}`;
  const tokenName = current.token_name || `paytm_token_${Date.now()}`;

  await execute(`
    UPDATE paytm_account
    SET paytm_userid = ?,
        paytm_password = ?,
        session_name = ?,
        token_name = ?,
        login_status = 'OTP_REQUIRED',
        otp_requested_at = ?,
        updated_at = NOW()
    WHERE id = 1
  `, [paytm_userid, paytm_password, sessionName, tokenName, now]);

  return { alreadyLoggedIn: false, account: await getPaytmAccount() };
}

export async function completePaytmOtpLogin({ otp, number, session_name, token_name, qr_details }) {
  await ensurePaytmAccount();
  if (!otp) throw new Error('OTP is required');

  const current = await getPaytmAccount();
  const now = new Date().toISOString();

  await execute(`
    UPDATE paytm_account
    SET number = ?,
        session_name = ?,
        token_name = ?,
        qr_details = ?,
        login_status = 'LOGGED_IN',
        last_login_at = ?,
        last_refresh_at = ?,
        updated_at = NOW()
    WHERE id = 1
  `, [
    number || current.number || current.paytm_userid || '',
    session_name || current.session_name || `paytm_session_${Date.now()}`,
    token_name || current.token_name || `paytm_token_${Date.now()}`,
    qr_details || current.qr_details || '',
    now,
    now
  ]);

  return await getPaytmAccount();
}

export async function refreshPaytmAccount() {
  await ensurePaytmAccount();
  await execute(`
    UPDATE paytm_account
    SET last_refresh_at = ?,
        updated_at = NOW()
    WHERE id = 1
  `, [new Date().toISOString()]);
  return await getPaytmAccount();
}

export async function logoutPaytmAccount() {
  await ensurePaytmAccount();
  await execute(`
    UPDATE paytm_account
    SET login_status = 'LOGGED_OUT',
        updated_at = NOW()
    WHERE id = 1
  `);
  return await getPaytmAccount();
}

// ─── Password Management Helpers ──────────────────────────────────────────────

export async function updateUserPassword(userId, newPassword) {
  const password_hash = bcrypt.hashSync(newPassword, 10);
  await execute('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash, userId]);
  return true;
}

export async function createPasswordResetToken(userId) {
  await execute('UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0', [userId]);
  
  const token = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  
  await execute(`
    INSERT INTO password_resets (user_id, token, expires_at)
    VALUES (?, ?, ?)
  `, [userId, token, expiresAt]);
  
  return { token, expiresAt };
}

export async function getValidResetToken(email, token) {
  const now = new Date().toISOString();
  return await queryOne(`
    SELECT pr.*, u.email, u.name FROM password_resets pr
    JOIN users u ON u.id = pr.user_id
    WHERE u.email = ? AND pr.token = ? AND pr.used = 0 AND pr.expires_at > ?
    ORDER BY pr.created_at DESC LIMIT 1
  `, [email, token, now]);
}

export async function invalidateResetToken(tokenId) {
  await execute('UPDATE password_resets SET used = 1 WHERE id = ?', [tokenId]);
}

export async function deleteUser(userId) {
  const deleteQueries = [
    ['DELETE FROM password_resets WHERE user_id = ?', [userId]],
    ['DELETE FROM wallet_transactions WHERE user_id = ?', [userId]],
    ['DELETE FROM plans WHERE user_id = ?', [userId]],
    ['DELETE FROM orders WHERE user_id = ?', [userId]],
    ['DELETE FROM reminders WHERE user_id = ?', [userId]],
    ['DELETE FROM message_templates WHERE user_id = ?', [userId]],
    ['DELETE FROM automation_settings WHERE user_id = ?', [userId]],
    ['DELETE FROM campaigns WHERE user_id = ?', [userId]],
    ['DELETE FROM auto_replies WHERE user_id = ?', [userId]],
    ['DELETE FROM contacts WHERE user_id = ?', [userId]],
    ['DELETE FROM digital_catalog WHERE user_id = ?', [userId]],
    ['DELETE FROM users WHERE id = ?', [userId]]
  ];

  for (const [sql, params] of deleteQueries) {
    await execute(sql, params);
  }

  return { id: userId, deleted: true };
}

// ─── CRM Helpers ─────────────────────────────────────────────────────────────

export async function getCatalogByUserId(userId) {
  return await queryOne('SELECT * FROM digital_catalog WHERE user_id = ?', [userId]);
}

export async function getAllCatalogs() {
  return await queryAll('SELECT * FROM digital_catalog');
}

export async function getServicesByCatalogId(catalogId) {
  return await queryAll('SELECT * FROM catalog_services WHERE catalog_id = ? ORDER BY created_at ASC', [catalogId]);
}

export async function upsertCatalog(userId, { brand_name, logo_path, description, catalog_audio_path }) {
  const existing = await getCatalogByUserId(userId);
  if (existing) {
    await execute(`
      UPDATE digital_catalog
      SET brand_name = ?,
          logo_path = COALESCE(?, logo_path),
          description = ?,
          catalog_audio_path = COALESCE(?, catalog_audio_path)
      WHERE user_id = ?
    `, [brand_name, logo_path || null, description || '', catalog_audio_path || null, userId]);
  } else {
    await execute(`
      INSERT INTO digital_catalog (user_id, brand_name, logo_path, description, catalog_audio_path)
      VALUES (?, ?, ?, ?, ?)
    `, [userId, brand_name, logo_path || null, description || '', catalog_audio_path || null]);
  }
  return await getCatalogByUserId(userId);
}

export async function createService(catalogId, { name, description, price, image_path, audio_path }) {
  const res = await execute(`
    INSERT INTO catalog_services (catalog_id, name, description, price, image_path, audio_path)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [catalogId, name, description || '', price, image_path || null, audio_path || null]);
  return await queryOne('SELECT * FROM catalog_services WHERE id = ?', [res.lastInsertRowid]);
}

export async function updateService(serviceId, catalogId, { name, description, price, image_path, audio_path }) {
  await execute(`
    UPDATE catalog_services
    SET name = ?,
        description = ?,
        price = ?,
        image_path = COALESCE(?, image_path),
        audio_path = COALESCE(?, audio_path)
    WHERE id = ? AND catalog_id = ?
  `, [name, description || '', price, image_path || null, audio_path || null, serviceId, catalogId]);
  return await queryOne('SELECT * FROM catalog_services WHERE id = ?', [serviceId]);
}

export async function deleteService(serviceId, catalogId) {
  await execute('DELETE FROM catalog_services WHERE id = ? AND catalog_id = ?', [serviceId, catalogId]);
  return { id: serviceId, deleted: true };
}

export async function getContactsByUser(userId) {
  return await queryAll('SELECT * FROM contacts WHERE user_id = ? ORDER BY name ASC', [userId]);
}

export async function upsertContact({ user_id, name, mobile, shop_name, is_excluded = 0 }) {
  if (isPg()) {
    await execute(`
      INSERT INTO contacts (user_id, name, mobile, shop_name, is_excluded)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id, mobile) DO UPDATE SET
        name = EXCLUDED.name,
        shop_name = COALESCE(EXCLUDED.shop_name, contacts.shop_name),
        is_excluded = COALESCE(EXCLUDED.is_excluded, contacts.is_excluded)
    `, [user_id, name, mobile, shop_name || null, is_excluded]);
  } else {
    await execute(`
      INSERT INTO contacts (user_id, name, mobile, shop_name, is_excluded)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, mobile) DO UPDATE SET
        name = excluded.name,
        shop_name = COALESCE(excluded.shop_name, shop_name),
        is_excluded = COALESCE(excluded.is_excluded, is_excluded)
    `, [user_id, name, mobile, shop_name || null, is_excluded]);
  }
  return await queryOne('SELECT * FROM contacts WHERE user_id = ? AND mobile = ?', [user_id, mobile]);
}

export async function getContactByMobile(userId, mobile) {
  return await queryOne('SELECT * FROM contacts WHERE user_id = ? AND mobile = ?', [userId, mobile]);
}

export async function deleteContact(contactId, userId) {
  await execute('DELETE FROM contacts WHERE id = ? AND user_id = ?', [contactId, userId]);
  return { id: contactId, deleted: true };
}

export async function toggleContactExclude(contactId, userId, isExcluded) {
  invalidateCache(`excluded_${userId}_`);
  await execute('UPDATE contacts SET is_excluded = ? WHERE id = ? AND user_id = ?', [isExcluded ? 1 : 0, contactId, userId]);
  return await queryOne('SELECT * FROM contacts WHERE id = ?', [contactId]);
}

export async function isContactExcluded(userId, mobile) {
  const cacheKey = `excluded_${userId}_${mobile}`;
  const cached = getCached(cacheKey, 30000);
  if (cached !== undefined) return cached;

  const row = await queryOne('SELECT is_excluded FROM contacts WHERE user_id = ? AND mobile = ?', [userId, mobile]);
  const res = row ? parseInt(row.is_excluded) === 1 : false;
  setCached(cacheKey, res);
  return res;
}

export async function getContactGroupsByUser(userId) {
  return await queryAll(`
    SELECT cg.*,
      COUNT(DISTINCT cgm.contact_id) as member_count
    FROM contact_groups cg
    LEFT JOIN contact_group_members cgm ON cgm.group_id = cg.id
    WHERE cg.user_id = ?
    GROUP BY cg.id
    ORDER BY cg.created_at DESC
  `, [userId]);
}

export async function getContactGroupById(groupId, userId) {
  return await queryOne('SELECT * FROM contact_groups WHERE id = ? AND user_id = ?', [groupId, userId]);
}

export async function createContactGroup(userId, { name, description }) {
  const res = await execute(`
    INSERT INTO contact_groups (user_id, name, description)
    VALUES (?, ?, ?)
  `, [userId, name.trim(), description ? description.trim() : '']);
  return await queryOne(`
    SELECT cg.*, COUNT(DISTINCT cgm.contact_id) as member_count
    FROM contact_groups cg
    LEFT JOIN contact_group_members cgm ON cgm.group_id = cg.id
    WHERE cg.id = ?
    GROUP BY cg.id
  `, [res.lastInsertRowid]);
}

export async function updateContactGroup(groupId, userId, { name, description }) {
  await execute(`
    UPDATE contact_groups
    SET name = ?, description = ?
    WHERE id = ? AND user_id = ?
  `, [name.trim(), description ? description.trim() : '', groupId, userId]);
  return await getContactGroupById(groupId, userId);
}

export async function deleteContactGroup(groupId, userId) {
  await execute('DELETE FROM contact_groups WHERE id = ? AND user_id = ?', [groupId, userId]);
  return { id: groupId, deleted: true };
}

export async function getContactGroupMembers(groupId, userId) {
  const group = await getContactGroupById(groupId, userId);
  if (!group) return null;
  return await queryAll(`
    SELECT c.*, cgm.id as membership_id
    FROM contact_group_members cgm
    JOIN contacts c ON c.id = cgm.contact_id
    WHERE cgm.group_id = ?
    ORDER BY c.name ASC
  `, [groupId]);
}

export async function addContactsToGroup(groupId, userId, contactIds) {
  const group = await getContactGroupById(groupId, userId);
  if (!group) throw new Error('Group not found');

  let added = 0;
  for (const contactId of contactIds) {
    const res = await execute(`
      INSERT INTO contact_group_members (group_id, contact_id)
      VALUES (?, ?)
      ON CONFLICT DO NOTHING
    `, [groupId, contactId]);
    if (res.changes > 0) added++;
  }
  return { added, groupId };
}

export async function removeContactFromGroup(groupId, contactId, userId) {
  const group = await getContactGroupById(groupId, userId);
  if (!group) throw new Error('Group not found');
  await execute('DELETE FROM contact_group_members WHERE group_id = ? AND contact_id = ?', [groupId, contactId]);
  return { groupId, contactId, removed: true };
}

export async function getContactsNotInGroup(groupId, userId) {
  return await queryAll(`
    SELECT c.*
    FROM contacts c
    WHERE c.user_id = ?
      AND c.id NOT IN (
        SELECT contact_id FROM contact_group_members WHERE group_id = ?
      )
    ORDER BY c.name ASC
  `, [userId, groupId]);
}

export async function getAutoRepliesByUser(userId) {
  return await queryAll('SELECT * FROM auto_replies WHERE user_id = ? ORDER BY created_at DESC', [userId]);
}

export async function createAutoReply({ user_id, keyword, match_type = 'contains', reply_text, media_path, media_type }) {
  const res = await execute(`
    INSERT INTO auto_replies (user_id, keyword, match_type, reply_text, media_path, media_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [user_id, keyword, match_type, reply_text || null, media_path || null, media_type || null]);
  return await queryOne('SELECT * FROM auto_replies WHERE id = ?', [res.lastInsertRowid]);
}

export async function deleteAutoReply(replyId, userId) {
  await execute('DELETE FROM auto_replies WHERE id = ? AND user_id = ?', [replyId, userId]);
  return { id: replyId, deleted: true };
}

export async function toggleAutoReplyActive(replyId, userId, isActive) {
  await execute('UPDATE auto_replies SET is_active = ? WHERE id = ? AND user_id = ?', [isActive ? 1 : 0, replyId, userId]);
  return await queryOne('SELECT * FROM auto_replies WHERE id = ?', [replyId]);
}

export async function getRemindersByUser(userId) {
  return await queryAll(`
    SELECT r.*, c.name as contact_name
    FROM reminders r
    LEFT JOIN contacts c ON c.id = r.contact_id
    WHERE r.user_id = ?
    ORDER BY r.scheduled_at DESC
  `, [userId]);
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
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  const fromIst = new Date(fromDate.getTime() + IST_OFFSET_MS);

  const startYear = fromIst.getUTCFullYear();
  const startMonth = fromIst.getUTCMonth();
  const startDate = fromIst.getUTCDate();

  for (let offsetDays = 0; offsetDays <= 7; offsetDays++) {
    const candidateIstMs = Date.UTC(startYear, startMonth, startDate + offsetDays, targetHour, targetMin, 0, 0);
    const candidateUtcMs = candidateIstMs - IST_OFFSET_MS;

    if (candidateUtcMs <= fromDate.getTime()) continue;

    const candidateIstDate = new Date(candidateIstMs);
    const candidateDayOfWeek = candidateIstDate.getUTCDay();

    if (isAllDays) return new Date(candidateUtcMs).toISOString();

    const matchesDay = dayList.some(dayStr => {
      const targetDayNum = dayNameMap[dayStr];
      return targetDayNum !== undefined && targetDayNum === candidateDayOfWeek;
    });

    if (matchesDay) return new Date(candidateUtcMs).toISOString();
  }

  const fallbackIstMs = Date.UTC(startYear, startMonth, startDate + 1, targetHour, targetMin, 0, 0);
  return new Date(fallbackIstMs - IST_OFFSET_MS).toISOString();
}

export async function createReminder({ user_id, contact_id, recipient_mobile, recipient_name, shop_name, message_template, scheduled_at, repeat_option, selected_days, send_time }) {
  const res = await execute(`
    INSERT INTO reminders (user_id, contact_id, recipient_mobile, recipient_name, shop_name, message_template, scheduled_at, repeat_option, selected_days, send_time, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `, [user_id, contact_id || null, recipient_mobile, recipient_name || null, shop_name || null, message_template, scheduled_at, repeat_option || 'once', selected_days || null, send_time || null]);
  return await queryOne('SELECT * FROM reminders WHERE id = ?', [res.lastInsertRowid]);
}

export async function deleteReminder(reminderId, userId) {
  await execute('DELETE FROM reminders WHERE id = ? AND user_id = ?', [reminderId, userId]);
  return { id: reminderId, deleted: true };
}

export async function getPendingReminders() {
  const now = new Date().toISOString();
  return await queryAll(`
    SELECT r.*, u.id as user_id, u.name as user_name
    FROM reminders r
    JOIN users u ON u.id = r.user_id
    WHERE r.status = 'pending' AND r.scheduled_at <= ?
  `, [now]);
}

export async function updateReminderStatus(reminderId, status, errorMsg = null) {
  await execute(`
    UPDATE reminders
    SET status = ?,
        sent_at = CASE WHEN ? = 'sent' THEN NOW() ELSE sent_at END,
        error_message = ?
    WHERE id = ?
  `, [status, status, errorMsg || null, reminderId]);
}

export async function getTemplatesByUser(userId) {
  return await queryAll('SELECT * FROM message_templates WHERE user_id = ? ORDER BY created_at DESC', [userId]);
}

export async function createTemplate({ user_id, title, content, category }) {
  const res = await execute(`
    INSERT INTO message_templates (user_id, title, content, category)
    VALUES (?, ?, ?, ?)
  `, [user_id, title, content, category || 'General']);
  return await queryOne('SELECT * FROM message_templates WHERE id = ?', [res.lastInsertRowid]);
}

export async function updateTemplate(templateId, userId, { title, content, category }) {
  await execute(`
    UPDATE message_templates
    SET title = ?, content = ?, category = ?
    WHERE id = ? AND user_id = ?
  `, [title, content, category || 'General', templateId, userId]);
  return await queryOne('SELECT * FROM message_templates WHERE id = ? AND user_id = ?', [templateId, userId]);
}

export async function deleteTemplate(templateId, userId) {
  await execute('DELETE FROM message_templates WHERE id = ? AND user_id = ?', [templateId, userId]);
  return { id: templateId, deleted: true };
}

export async function getAutomationSettings(userId) {
  const cacheKey = `auto_settings_${userId}`;
  const cached = getCached(cacheKey, 30000);
  if (cached !== undefined) return cached;

  const settings = await queryOne('SELECT * FROM automation_settings WHERE user_id = ?', [userId]);
  const result = settings || {
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

  setCached(cacheKey, result);
  return result;
}

export async function upsertAutomationSettings(userId, settings) {
  invalidateCache(`auto_settings_${userId}`);
  const existing = await queryOne('SELECT id FROM automation_settings WHERE user_id = ?', [userId]);
  if (existing) {
    await execute(`
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
          updated_at = NOW()
      WHERE user_id = @user_id
    `, {
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
    await execute(`
      INSERT INTO automation_settings (
        user_id, welcome_active, welcome_text, welcome_media_path, welcome_media_type,
        away_active, away_text, away_schedule_type, away_start_time, away_end_time
      ) VALUES (
        @user_id, @welcome_active, @welcome_text, @welcome_media_path, @welcome_media_type,
        @away_active, @away_text, @away_schedule_type, @away_start_time, @away_end_time
      )
    `, {
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
  return await getAutomationSettings(userId);
}

export async function getCampaignsByUser(userId) {
  return await queryAll('SELECT * FROM campaigns WHERE user_id = ? ORDER BY created_at DESC', [userId]);
}

export async function getCampaignRecipients(campaignId) {
  return await queryAll('SELECT * FROM campaign_recipients WHERE campaign_id = ?', [campaignId]);
}

export async function getCampaignById(campaignId) {
  return await queryOne('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
}

export async function createCampaign(userId, { name, message_text, media_path, media_type, scheduled_at, contacts }) {
  const res = await execute(`
    INSERT INTO campaigns (user_id, name, message_text, media_path, media_type, scheduled_at, total_contacts, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
  `, [userId, name, message_text, media_path, media_type, scheduled_at || null, contacts.length]);
  
  const campaignId = res.lastInsertRowid;

  for (const c of contacts) {
    await execute(`
      INSERT INTO campaign_recipients (campaign_id, contact_id, mobile, name, shop_name)
      VALUES (?, ?, ?, ?, ?)
    `, [campaignId, c.id || null, c.mobile, c.name, c.shop_name]);
  }

  return await queryOne('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
}

export async function updateCampaignStatus(campaignId, status) {
  await execute('UPDATE campaigns SET status = ? WHERE id = ?', [status, campaignId]);
  return await queryOne('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
}

export async function updateCampaignRecipientStatus(recipientId, status, errorMsg = null) {
  await execute(`
    UPDATE campaign_recipients 
    SET status = ?, error_message = ?, sent_at = NOW() 
    WHERE id = ?
  `, [status, errorMsg, recipientId]);
}

export async function incrementCampaignSuccess(campaignId) {
  await execute('UPDATE campaigns SET successful_deliveries = successful_deliveries + 1 WHERE id = ?', [campaignId]);
}

export async function incrementCampaignFailure(campaignId) {
  await execute('UPDATE campaigns SET failed_deliveries = failed_deliveries + 1 WHERE id = ?', [campaignId]);
}

export async function getPendingCampaigns() {
  const now = new Date().toISOString();
  return await queryAll(`
    SELECT * FROM campaigns 
    WHERE status = 'running' 
       OR (status = 'pending' AND (scheduled_at IS NULL OR scheduled_at <= ?))
  `, [now]);
}

export async function getPendingRecipients(campaignId, limit = 50) {
  return await queryAll(`
    SELECT * FROM campaign_recipients 
    WHERE campaign_id = ? AND status = 'pending'
    LIMIT ?
  `, [campaignId, limit]);
}

export async function getBirthdayWishesByUser(userId) {
  return await queryAll(`
    SELECT bw.*, c.name AS contact_name
    FROM birthday_wishes bw
    LEFT JOIN contacts c ON c.id = bw.contact_id
    WHERE bw.user_id = ?
    ORDER BY bw.birthday_date ASC
  `, [userId]);
}

export async function createBirthdayWish(userId, data) {
  const res = await execute(`
    INSERT INTO birthday_wishes (user_id, contact_id, recipient_name, recipient_phone,
      birthday_date, birth_year, message_text, media_path, media_type, send_time, active)
    VALUES (@user_id, @contact_id, @recipient_name, @recipient_phone,
      @birthday_date, @birth_year, @message_text, @media_path, @media_type, @send_time, 1)
  `, {
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
  return await queryOne('SELECT * FROM birthday_wishes WHERE id = ?', [res.lastInsertRowid]);
}

export async function updateBirthdayWish(id, userId, data) {
  await execute(`
    UPDATE birthday_wishes SET
      recipient_name = COALESCE(@recipient_name, recipient_name),
      recipient_phone = COALESCE(@recipient_phone, recipient_phone),
      birthday_date = COALESCE(@birthday_date, birthday_date),
      birth_year = @birth_year,
      message_text = COALESCE(@message_text, message_text),
      send_time = COALESCE(@send_time, send_time),
      active = COALESCE(@active, active)
    WHERE id = @id AND user_id = @user_id
  `, { id, user_id: userId, ...data, birth_year: data.birth_year || null });
  return await queryOne('SELECT * FROM birthday_wishes WHERE id = ?', [id]);
}

export async function deleteBirthdayWish(id, userId) {
  await execute('DELETE FROM birthday_wishes WHERE id = ? AND user_id = ?', [id, userId]);
  return { id, deleted: true };
}

export async function getDueBirthdayWishes() {
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  const month  = String(istNow.getUTCMonth() + 1).padStart(2, '0');
  const day    = String(istNow.getUTCDate()).padStart(2, '0');
  const mmdd   = `${month}-${day}`;
  const currentYear = istNow.getUTCFullYear();
  return await queryAll(`
    SELECT bw.*, u.id AS owner_user_id
    FROM birthday_wishes bw
    JOIN users u ON u.id = bw.user_id
    WHERE bw.active = 1
      AND bw.birthday_date = ?
      AND (bw.last_sent_year IS NULL OR bw.last_sent_year < ?)
  `, [mmdd, currentYear]);
}

export async function markBirthdayWishSent(id, year) {
  await execute(`
    UPDATE birthday_wishes
    SET last_sent_year = ?, status = 'sent', last_error = NULL, last_sent_at = NOW()
    WHERE id = ?
  `, [year, id]);
}

export async function markBirthdayWishFailed(id, errorMessage) {
  await execute(`
    UPDATE birthday_wishes
    SET status = 'failed', last_error = ?
    WHERE id = ?
  `, [errorMessage || 'Unknown error', id]);
}

export async function getPaymentRemindersByUser(userId) {
  return await queryAll(`
    SELECT pr.*, c.name AS contact_name
    FROM payment_reminders pr
    LEFT JOIN contacts c ON c.id = pr.contact_id
    WHERE pr.user_id = ?
    ORDER BY pr.due_date ASC
  `, [userId]);
}

export async function createPaymentReminder(userId, data) {
  const res = await execute(`
    INSERT INTO payment_reminders (user_id, contact_id, recipient_name, recipient_phone,
      amount, currency, due_date, message_text, media_path, media_type, remind_days_before, status, active)
    VALUES (@user_id, @contact_id, @recipient_name, @recipient_phone,
      @amount, @currency, @due_date, @message_text, @media_path, @media_type, @remind_days_before, 'pending', 1)
  `, {
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
  return await queryOne('SELECT * FROM payment_reminders WHERE id = ?', [res.lastInsertRowid]);
}

export async function updatePaymentReminderStatus(id, userId, status) {
  await execute('UPDATE payment_reminders SET status = ? WHERE id = ? AND user_id = ?', [status, id, userId]);
  return await queryOne('SELECT * FROM payment_reminders WHERE id = ?', [id]);
}

export async function deletePaymentReminder(id, userId) {
  await execute('DELETE FROM payment_reminders WHERE id = ? AND user_id = ?', [id, userId]);
  return { id, deleted: true };
}

export async function getOrderNotificationsByUser(userId) {
  return await queryAll(`
    SELECT orn.*, c.name AS contact_name
    FROM order_notifications orn
    LEFT JOIN contacts c ON c.id = orn.contact_id
    WHERE orn.user_id = ?
    ORDER BY orn.created_at DESC
  `, [userId]);
}

export async function createOrderNotification(userId, data) {
  const res = await execute(`
    INSERT INTO order_notifications (user_id, contact_id, recipient_name, recipient_phone,
      order_id, order_status, product_name, amount, currency, message_text,
      media_path, media_type, send_immediately, scheduled_at, status)
    VALUES (@user_id, @contact_id, @recipient_name, @recipient_phone,
      @order_id, @order_status, @product_name, @amount, @currency, @message_text,
      @media_path, @media_type, @send_immediately, @scheduled_at, 'pending')
  `, {
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
  return await queryOne('SELECT * FROM order_notifications WHERE id = ?', [res.lastInsertRowid]);
}

export async function updateOrderNotificationStatus(id, userId, status, sentAt) {
  await execute('UPDATE order_notifications SET status = ?, sent_at = ? WHERE id = ? AND user_id = ?', [status, sentAt || null, id, userId]);
  return await queryOne('SELECT * FROM order_notifications WHERE id = ?', [id]);
}

export async function deleteOrderNotification(id, userId) {
  await execute('DELETE FROM order_notifications WHERE id = ? AND user_id = ?', [id, userId]);
  return { id, deleted: true };
}

export async function getPendingOrderNotifications() {
  const now = new Date().toISOString();
  return await queryAll(`
    SELECT * FROM order_notifications
    WHERE status = 'pending'
      AND (send_immediately = 1 OR (scheduled_at IS NOT NULL AND scheduled_at <= ?))
  `, [now]);
}

export async function getFollowupAutomationsByUser(userId) {
  return await queryAll(`
    SELECT fa.*,
      COUNT(CASE WHEN fsl.status = 'sent' THEN 1 END) AS sent_count,
      COUNT(CASE WHEN fsl.status = 'failed' THEN 1 END) AS failed_count,
      MAX(fsl.sent_at) AS last_sent_at
    FROM followup_automations fa
    LEFT JOIN followup_sent_log fsl ON fsl.automation_id = fa.id
    WHERE fa.user_id = ?
    GROUP BY fa.id
    ORDER BY fa.created_at DESC
  `, [userId]);
}

export async function createFollowupAutomation(userId, data) {
  const res = await execute(`
    INSERT INTO followup_automations (user_id, name, trigger_event, delay_days,
      message_text, media_path, media_type, active, apply_to)
    VALUES (@user_id, @name, @trigger_event, @delay_days,
      @message_text, @media_path, @media_type, 1, @apply_to)
  `, {
    user_id: userId,
    name: data.name,
    trigger_event: data.trigger_event || 'no_response',
    delay_days: data.delay_days || 3,
    message_text: data.message_text,
    media_path: data.media_path || null,
    media_type: data.media_type || null,
    apply_to: data.apply_to || 'all'
  });
  return await queryOne('SELECT * FROM followup_automations WHERE id = ?', [res.lastInsertRowid]);
}

export async function updateFollowupAutomation(id, userId, data) {
  await execute(`
    UPDATE followup_automations SET
      name = COALESCE(@name, name),
      trigger_event = COALESCE(@trigger_event, trigger_event),
      delay_days = COALESCE(@delay_days, delay_days),
      message_text = COALESCE(@message_text, message_text),
      active = COALESCE(@active, active),
      apply_to = COALESCE(@apply_to, apply_to)
    WHERE id = @id AND user_id = @user_id
  `, { id, user_id: userId, name: data.name || null, trigger_event: data.trigger_event || null,
    delay_days: data.delay_days || null, message_text: data.message_text || null,
    active: data.active ?? null, apply_to: data.apply_to || null });
  return await queryOne('SELECT * FROM followup_automations WHERE id = ?', [id]);
}

export async function deleteFollowupAutomation(id, userId) {
  await execute('DELETE FROM followup_automations WHERE id = ? AND user_id = ?', [id, userId]);
  return { id, deleted: true };
}

export async function getFollowupLogsByUser(userId) {
  return await queryAll(`
    SELECT fsl.*, fa.name AS automation_name, c.name AS contact_name, c.mobile AS contact_mobile
    FROM followup_sent_log fsl
    JOIN followup_automations fa ON fa.id = fsl.automation_id
    LEFT JOIN contacts c ON c.id = fsl.contact_id
    WHERE fsl.user_id = ?
    ORDER BY fsl.sent_at DESC
    LIMIT 50
  `, [userId]);
}

export async function deleteFollowupLog(id, userId) {
  await execute('DELETE FROM followup_sent_log WHERE id = ? AND user_id = ?', [id, userId]);
  return { id, deleted: true };
}

// ─── WhatsApp Multi-Session Auth Persistence (Cloud DB Sync) ─────────────────

export async function saveSessionFile(userId, fileName, fileData) {
  return saveSessionFilesBatch(userId, [{ fileName, fileData }]);
}

export async function saveSessionFilesBatch(userId, files) {
  if (!files || files.length === 0) return;
  const uid = String(userId);

  if (isPg()) {
    // Process in chunks of 50 to stay well within Postgres parameter limits
    const CHUNK_SIZE = 50;
    for (let i = 0; i < files.length; i += CHUNK_SIZE) {
      const chunk = files.slice(i, i + CHUNK_SIZE);
      const values = [];
      const placeholders = [];
      let idx = 1;
      for (const item of chunk) {
        placeholders.push(`($${idx++}, $${idx++}, $${idx++}, NOW())`);
        values.push(uid, item.fileName, item.fileData);
      }
      const sql = `
        INSERT INTO whatsapp_session_auth (user_id, file_name, file_data, updated_at)
        VALUES ${placeholders.join(', ')}
        ON CONFLICT (user_id, file_name)
        DO UPDATE SET file_data = EXCLUDED.file_data, updated_at = NOW()
      `;
      await getPgPool().query(sql, values);
    }
  } else {
    const db = getDb();
    const insertStmt = db.prepare(`
      INSERT INTO whatsapp_session_auth (user_id, file_name, file_data, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT (user_id, file_name)
      DO UPDATE SET file_data = excluded.file_data, updated_at = datetime('now')
    `);
    const insertMany = db.transaction((items) => {
      for (const item of items) {
        insertStmt.run(uid, item.fileName, item.fileData);
      }
    });
    insertMany(files);
  }
}

export async function deleteSessionFilesSpecific(userId, fileNames) {
  if (!fileNames || fileNames.length === 0) return;
  const uid = String(userId);
  if (isPg()) {
    const CHUNK_SIZE = 100;
    for (let i = 0; i < fileNames.length; i += CHUNK_SIZE) {
      const chunk = fileNames.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map((_, idx) => `$${idx + 2}`).join(', ');
      await getPgPool().query(`DELETE FROM whatsapp_session_auth WHERE user_id = $1 AND file_name IN (${placeholders})`, [uid, ...chunk]);
    }
  } else {
    const db = getDb();
    const placeholders = fileNames.map(() => '?').join(', ');
    db.prepare(`DELETE FROM whatsapp_session_auth WHERE user_id = ? AND file_name IN (${placeholders})`).run(uid, ...fileNames);
  }
}

export async function getSessionFiles(userId) {
  return await queryAll('SELECT file_name, file_data FROM whatsapp_session_auth WHERE user_id = ?', [String(userId)]);
}

export async function deleteSessionFiles(userId) {
  await execute('DELETE FROM whatsapp_session_auth WHERE user_id = ?', [String(userId)]);
}

export async function getAllSessionUserIdsFromDb() {
  const rows = await queryAll('SELECT DISTINCT user_id FROM whatsapp_session_auth');
  return (rows || []).map(r => String(r.user_id));
}

