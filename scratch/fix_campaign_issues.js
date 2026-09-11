import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '..', 'database.db'));

const now = new Date().toISOString();

// 1. Fix plans that have expires_at in the future but are marked 'expired'
const fixedPlans = db.prepare(`
  UPDATE plans SET status = 'active' WHERE expires_at > ? AND status = 'expired'
`).run(now);
console.log(`✅ Fixed ${fixedPlans.changes} plan(s): set status='active' where expires_at is still in the future`);

// 2. Show current plan state
const plans = db.prepare(`SELECT id, user_id, status, expires_at FROM plans ORDER BY user_id, expires_at DESC`).all();
console.log('\n📋 All Plans:');
plans.forEach(p => {
  const expired = new Date(p.expires_at) < new Date() ? '❌ EXPIRED' : '✅ VALID';
  console.log(`  Plan #${p.id} | user_id=${p.user_id} | status=${p.status} | expires=${p.expires_at} | ${expired}`);
});

// 3. Check if campaigns table is missing message_interval column
const campCols = db.prepare("PRAGMA table_info(campaigns)").all().map(c => c.name);
console.log('\n📋 Campaign columns:', campCols.join(', '));

const missing = [];
if (!campCols.includes('message_interval')) missing.push('message_interval INTEGER DEFAULT 15');
if (!campCols.includes('daily_limit'))      missing.push('daily_limit INTEGER DEFAULT 200');

for (const colDef of missing) {
  const colName = colDef.split(' ')[0];
  db.prepare(`ALTER TABLE campaigns ADD COLUMN ${colDef}`).run();
  console.log(`✅ Added missing column: campaigns.${colName}`);
}

if (missing.length === 0) {
  console.log('✅ campaigns table already has message_interval and daily_limit columns');
}

// 4. Check automation_settings for user 3
const settings = db.prepare("SELECT * FROM automation_settings WHERE user_id = 3").get();
console.log('\n📋 Automation settings for user 3:', JSON.stringify(settings, null, 2));

// 5. Show recent campaign_recipients 
const recipients = db.prepare("SELECT * FROM campaign_recipients ORDER BY id DESC LIMIT 10").all();
console.log('\n📋 Recent Campaign Recipients:');
console.log(JSON.stringify(recipients, null, 2));

db.close();
console.log('\n✅ Done! Restart your server for changes to take effect.');
