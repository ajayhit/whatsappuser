import { initDb, createUser, getUserByEmail, getActivePlan, activatePlan } from '../db.js';

async function runTests() {
  console.log('--- Starting Accumulative Plan Expiry Verification ---');
  initDb();

  const testEmail = `expiry_test_${Date.now()}@domain.com`;
  console.log(`Creating test user: ${testEmail}`);
  createUser({
    name: 'Expiry Test User',
    email: testEmail,
    phone: '919999999999',
    password: 'testpassword123'
  });
  const user = getUserByEmail(testEmail);
  console.log('User created with ID:', user.id);

  // Test 1: First activation (should give 28 days from now)
  console.log('\n[Test 1] Activating first plan...');
  const plan1 = activatePlan(user.id);
  const now = Date.now();
  const diffDays1 = Math.round((new Date(plan1.expires_at).getTime() - now) / (24 * 60 * 60 * 1000));
  console.log(`First plan expires at: ${plan1.expires_at}`);
  console.log(`Remaining days (should be approx 28): ${diffDays1}`);
  if (diffDays1 < 27 || diffDays1 > 29) {
    throw new Error(`Expected approx 28 days, got ${diffDays1}`);
  }

  // Test 2: Second activation while first is active (should add 28 days to plan1.expires_at)
  console.log('\n[Test 2] Activating second plan (should accumulate)...');
  const plan2 = activatePlan(user.id);
  const diffDays2 = Math.round((new Date(plan2.expires_at).getTime() - now) / (24 * 60 * 60 * 1000));
  console.log(`Second plan expires at: ${plan2.expires_at}`);
  console.log(`Remaining days (should be approx 56): ${diffDays2}`);
  if (diffDays2 < 55 || diffDays2 > 57) {
    throw new Error(`Expected approx 56 days, got ${diffDays2}`);
  }

  // Double check actual difference between plan2 expiry and plan1 expiry
  const actualDiffMs = new Date(plan2.expires_at).getTime() - new Date(plan1.expires_at).getTime();
  const actualDiffDays = Math.round(actualDiffMs / (24 * 60 * 60 * 1000));
  console.log(`Difference between second and first plan expiration (should be exactly 28 days): ${actualDiffDays}`);
  if (actualDiffDays !== 28) {
    throw new Error(`Expected exactly 28 days difference, got ${actualDiffDays}`);
  }

  console.log('\n--- All Accumulative Plan Expiry Tests Passed! ---');
}

runTests().catch(e => {
  console.error('Accumulative expiry test failed:', e);
  process.exit(1);
});
