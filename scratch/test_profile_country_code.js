import { initDb } from '../db.js';
import express from 'express';
import authRouter from '../authRouter.js';
import http from 'http';

async function runTests() {
  console.log('--- Starting User Profile Country Code & Mobile Number Tests ---');
  await initDb();

  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const BASE_URL = `http://127.0.0.1:${port}`;

  try {
    // 1. Get captcha for registration
    const getCaptcha = async () => {
      const res = await fetch(`${BASE_URL}/auth/captcha`);
      const data = await res.json();
      const testRes = await fetch(`${BASE_URL}/auth/test-captcha`);
      const answers = await testRes.json();
      return { id: data.id, answer: answers[data.id].answer };
    };

    const stamp = Date.now();
    const randSuffix = String(stamp).slice(-6);

    // 1. Create a new user with +91
    const testEmail = `profile_test_${stamp}@example.com`;
    const c1 = await getCaptcha();
    const registerRes = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Profile Tester',
        email: testEmail,
        phone: `9198${randSuffix}10`,
        countryCode: '+91',
        localPhone: `98${randSuffix}10`,
        password: 'password123',
        captchaId: c1.id,
        captchaAnswer: c1.answer
      })
    });
    const regData = await registerRes.json();
    const token = regData.token;
    console.log('✓ Registered test user with phone:', regData.user.phone);

    // 2. Update profile to US country code (+1) and 10-digit number
    console.log('\n[Test 1] Update profile to US (+1) with local phone...');
    const updateRes1 = await fetch(`${BASE_URL}/auth/profile`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Profile Tester US',
        phone: `1415${randSuffix}`,
        countryCode: '+1',
        localPhone: `415${randSuffix}`
      })
    });
    const updateData1 = await updateRes1.json();
    console.log('Status:', updateRes1.status, 'User phone:', updateData1.user.phone);
    if (updateData1.user.phone === `1415${randSuffix}`) {
      console.log(`✓ PASS: Profile updated with +1 country code correctly as 1415${randSuffix}`);
    } else {
      throw new Error(`Expected 1415${randSuffix}, got ${updateData1.user.phone}`);
    }

    // 3. Update profile to custom country code (+355) Albania
    console.log('\n[Test 2] Update profile to custom country code (+355) Albania...');
    const updateRes2 = await fetch(`${BASE_URL}/auth/profile`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Profile Tester Albania',
        phone: `35569${randSuffix}`,
        countryCode: '+355',
        localPhone: `69${randSuffix}`
      })
    });
    const updateData2 = await updateRes2.json();
    console.log('Status:', updateRes2.status, 'User phone:', updateData2.user.phone);
    if (updateData2.user.phone === `35569${randSuffix}`) {
      console.log(`✓ PASS: Profile updated with custom country code +355 correctly as 35569${randSuffix}`);
    } else {
      throw new Error(`Expected 35569${randSuffix}, got ${updateData2.user.phone}`);
    }

    // 4. Fetch /auth/me to verify database persistence
    console.log('\n[Test 3] Verify DB persistence via /auth/me...');
    const meRes = await fetch(`${BASE_URL}/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const meData = await meRes.json();
    console.log('Status:', meRes.status, 'Persisted phone in DB:', meData.user.phone);
    if (meData.user.phone === `35569${randSuffix}`) {
      console.log(`✓ PASS: Profile phone persisted in database verified!`);
    } else {
      throw new Error(`Expected persisted phone 35569${randSuffix}, got ${meData.user.phone}`);
    }

    console.log('\n=========================================');
    console.log('🎉 ALL USER PROFILE COUNTRY CODE TESTS PASSED!');
    console.log('=========================================');
  } finally {
    server.close();
  }
}

runTests().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
