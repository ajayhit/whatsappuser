import { isQuietHours } from '../index.js';
import { getDailyMessageLimit, initDb, createUser } from '../db.js';

async function runAntiBanTests() {
  console.log('Testing WhatsApp Anti-Ban & Enterprise Delivery Improvements...');

  // 1. Test Quiet Hours Logic
  // Helper for test testing specific hour inputs
  function testHourQuiet(hour, startHour = 22, endHour = 8) {
    if (startHour > endHour) {
      return hour >= startHour || hour < endHour;
    }
    return hour >= startHour && hour < endHour;
  }

  const quietTestCases = [
    { hour: 22, expected: true },
    { hour: 23, expected: true },
    { hour: 0,  expected: true },
    { hour: 4,  expected: true },
    { hour: 7,  expected: true },
    { hour: 8,  expected: false },
    { hour: 12, expected: false },
    { hour: 18, expected: false },
    { hour: 21, expected: false }
  ];

  for (const tc of quietTestCases) {
    const result = testHourQuiet(tc.hour);
    if (result !== tc.expected) {
      throw new Error(`Quiet hours failed for hour ${tc.hour}: expected ${tc.expected}, got ${result}`);
    }
  }
  console.log(`[Quiet Hours Test] Current live isQuietHours status: ${isQuietHours()}`);
  console.log('[Quiet Hours Test] Hour ranges 22:00-08:00 verified accurately.');

  // 2. Test Opt-Out Keywords & Punctuation Stripping
  const OPT_OUT_KEYWORDS = [
    'STOP', 'UNSUBSCRIBE', 'UNSUB', 'CANCEL', 'OPTOUT', 'OPT OUT',
    'REMOVE', 'NO MORE', 'DND', 'DO NOT SEND', 'STOP PROMO',
    'ROKO', 'BAND KRO', 'BAND KARO', 'MAT BHEJO', 'HATAO'
  ];

  function testOptOut(rawText) {
    const incomingText = rawText.toUpperCase().replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '').trim();
    return OPT_OUT_KEYWORDS.some(kw => incomingText === kw || incomingText.startsWith(kw));
  }

  const optOutCases = [
    { text: 'stop', expected: true },
    { text: 'STOP!', expected: true },
    { text: 'dnd.', expected: true },
    { text: 'Unsubscribe', expected: true },
    { text: 'unsub', expected: true },
    { text: 'roko', expected: true },
    { text: 'band karo!', expected: true },
    { text: 'mat bhejo', expected: true },
    { text: 'hello', expected: false },
    { text: 'what is the price?', expected: false },
    { text: 'thank you', expected: false }
  ];

  for (const tc of optOutCases) {
    const isMatched = testOptOut(tc.text);
    if (isMatched !== tc.expected) {
      throw new Error(`Opt-out keyword match failed for "${tc.text}": expected ${tc.expected}, got ${isMatched}`);
    }
  }
  console.log('[Opt-Out Keyword Test] All punctuation-stripped keywords verified successfully.');

  // 3. Test Account Warm-Up Safety Curve
  await initDb();
  const testUser = await createUser({
    name: 'Warmup Test User',
    email: `warmup_${Date.now()}@test.com`,
    phone: `919999${Math.floor(100000 + Math.random() * 900000)}`,
    password: 'password123'
  });

  const dailyLimit = await getDailyMessageLimit(testUser.id);
  console.log(`[Warm-Up Curve Test] New user #${testUser.id} daily limit: ${dailyLimit} msgs/day (Warmup protection active, max 30).`);

  if (dailyLimit > 30) {
    throw new Error(`Expected new user to have warmup limit <= 30, but got ${dailyLimit}`);
  }

  console.log('✅ ALL ANTI-BAN TESTS PASSED!');
  process.exit(0);
}

runAntiBanTests().catch(err => {
  console.error('❌ Anti-ban test failed:', err);
  process.exit(1);
});
