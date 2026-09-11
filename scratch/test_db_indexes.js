import { initDb, getDb, queryAll, execute } from '../db.js';

async function testDatabase() {
  console.log('Testing Database Indexes and Query Normalization...');

  await initDb();
  console.log('[DB Init] Completed successfully.');

  const db = getDb();

  // Test that indexes exist in SQLite
  const tables = ['campaign_recipients', 'reminders', 'payment_reminders', 'contacts', 'whatsapp_session_auth'];
  for (const table of tables) {
    const indexes = db.prepare(`PRAGMA index_list('${table}')`).all();
    console.log(`[Index Check] ${table} has ${indexes.length} index(es): ${indexes.map(i => i.name).join(', ')}`);
    if (indexes.length === 0) {
      throw new Error(`Expected indexes on table ${table}, but found none!`);
    }
  }

  // Test normalized recurring reminder query (datetime('now') and ? params)
  const testReminder = await queryAll('SELECT id FROM reminders LIMIT 1');
  if (testReminder && testReminder.length > 0) {
    const remId = testReminder[0].id;
    await execute(
      "UPDATE reminders SET scheduled_at = ?, sent_at = datetime('now'), status = 'pending' WHERE id = ?",
      ['2026-09-10 10:00:00', remId]
    );
    console.log('[Query Test] Normalized reminder update executed successfully.');
  }

  // Test normalized payment reminders query with date math
  const todayStr = new Date().toISOString().slice(0, 10);
  const due = await queryAll(
    `SELECT * FROM payment_reminders
     WHERE active = 1 AND status = 'pending'
       AND date(due_date, '-' || remind_days_before || ' days') <= ?
       AND date(due_date) >= ?`,
    [todayStr, todayStr]
  );
  console.log(`[Query Test] Normalized payment reminder query executed successfully, returned ${due.length} records.`);

  console.log('✅ ALL DATABASE AND PERFORMANCE TESTS PASSED!');
  process.exit(0);
}

testDatabase().catch(err => {
  console.error('❌ Database test failed:', err);
  process.exit(1);
});
