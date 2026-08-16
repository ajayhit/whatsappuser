import Database from 'better-sqlite3';
import pg from 'pg';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

import { initDb } from '../db.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const sqliteDbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : (fs.existsSync(path.join(projectRoot, 'database.db'))
      ? path.join(projectRoot, 'database.db')
      : path.join(projectRoot, 'database.seed.db'));

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('[Migration Error] DATABASE_URL is not set in environment variables.');
  process.exit(1);
}

if (!fs.existsSync(sqliteDbPath)) {
  console.error(`[Migration Error] SQLite database file not found at ${sqliteDbPath}`);
  process.exit(1);
}

console.log(`[Migration] Connecting to SQLite source: ${sqliteDbPath}`);
const sqlite = new Database(sqliteDbPath);

const isLocalhost = databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1');
const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: isLocalhost ? false : { rejectUnauthorized: false }
});

const tablesToMigrate = [
  'users',
  'banks',
  'settings',
  'plans',
  'orders',
  'wallet_transactions',
  'password_resets',
  'paytm_account',
  'digital_catalog',
  'catalog_services',
  'contacts',
  'contact_groups',
  'contact_group_members',
  'auto_replies',
  'reminders',
  'message_templates',
  'automation_settings',
  'campaigns',
  'campaign_recipients',
  'expiry_notification_logs',
  'birthday_wishes',
  'payment_reminders',
  'order_notifications',
  'followup_automations',
  'followup_sent_log'
];

async function migrate() {
  let client;
  try {
    await initDb();
    client = await pool.connect();
    console.log('[Migration] Connected to PostgreSQL destination.');

    for (const tableName of tablesToMigrate) {
      // Check if table exists in SQLite
      const tableCheck = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
      if (!tableCheck) {
        console.log(`[Migration] Table '${tableName}' does not exist in SQLite, skipping.`);
        continue;
      }

      const rows = sqlite.prepare(`SELECT * FROM ${tableName}`).all();
      if (rows.length === 0) {
        console.log(`[Migration] Table '${tableName}' is empty, skipping data transfer.`);
        continue;
      }

      console.log(`[Migration] Transferring ${rows.length} row(s) for '${tableName}'...`);

      const columns = Object.keys(rows[0]);
      const colList = columns.map(c => `"${c}"`).join(', ');

      for (const row of rows) {
        const values = columns.map(col => row[col]);
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');

        const insertQuery = `
          INSERT INTO "${tableName}" (${colList})
          VALUES (${placeholders})
          ON CONFLICT DO NOTHING
        `;

        try {
          await client.query(insertQuery, values);
        } catch (rowErr) {
          console.warn(`[Migration Warning] Failed row insert into '${tableName}': ${rowErr.message}`);
        }
      }

      // Reset auto-increment sequence in PostgreSQL if primary key 'id' exists
      if (columns.includes('id')) {
        try {
          await client.query(`
            SELECT setval(pg_get_serial_sequence('${tableName}', 'id'), COALESCE(MAX(id), 1)) FROM "${tableName}"
          `);
        } catch (seqErr) {
          // Ignore sequence reset error for non-serial ID tables like paytm_account
        }
      }
    }

    console.log('\n[Migration Success] All data migrated from SQLite to PostgreSQL successfully!');
  } catch (err) {
    console.error('[Migration Error]', err);
  } finally {
    if (client) client.release();
    await pool.end();
    sqlite.close();
  }
}

migrate();
