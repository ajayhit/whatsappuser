import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '..', 'database.db'));

// List all tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('=== ALL TABLES ===');
console.log(JSON.stringify(tables.map(t => t.name), null, 2));

// PRAGMA for campaigns
const campcols = db.prepare("PRAGMA table_info(campaigns)").all();
console.log('\n=== CAMPAIGNS COLUMNS ===');
console.log(JSON.stringify(campcols.map(c => c.name), null, 2));

// PRAGMA for campaign_recipients
try {
  const recipcols = db.prepare("PRAGMA table_info(campaign_recipients)").all();
  console.log('\n=== CAMPAIGN_RECIPIENTS COLUMNS ===');
  console.log(JSON.stringify(recipcols.map(c => c.name), null, 2));

  // Count per status for today
  const today = new Date().toISOString().split('T')[0];
  const statusCounts = db.prepare("SELECT status, COUNT(*) as cnt FROM campaign_recipients GROUP BY status").all();
  console.log('\n=== RECIPIENT STATUS COUNTS (all time) ===');
  console.log(JSON.stringify(statusCounts, null, 2));

  const todaySent = db.prepare("SELECT COUNT(*) as cnt FROM campaign_recipients WHERE status='sent' AND date(updated_at)=?").get(today);
  console.log('\n=== RECIPIENTS SENT TODAY (' + today + ') ===');
  console.log(JSON.stringify(todaySent, null, 2));
} catch(e) { console.log('campaign_recipients error:', e.message); }

// PRAGMA for users
const usercols = db.prepare("PRAGMA table_info(users)").all();
console.log('\n=== USERS COLUMNS ===');
console.log(JSON.stringify(usercols.map(c => c.name), null, 2));

// Show users
const users = db.prepare("SELECT * FROM users LIMIT 5").all();
console.log('\n=== USERS ===');
console.log(JSON.stringify(users, null, 2));

// Check for subscriptions / active_plans table
for (const t of tables.map(x => x.name)) {
  if (/plan|subscri|limit/i.test(t)) {
    console.log(`\n=== TABLE: ${t} ===`);
    const cols2 = db.prepare(`PRAGMA table_info(${t})`).all();
    console.log('Columns:', JSON.stringify(cols2.map(c => c.name)));
    const rows = db.prepare(`SELECT * FROM ${t} LIMIT 5`).all();
    console.log('Rows:', JSON.stringify(rows, null, 2));
  }
}

db.close();
