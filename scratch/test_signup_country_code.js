import { initDb, getDb, getUserByEmail, getUserByPhone, queryOne } from '../db.js';
import express from 'express';
import authRouter from '../authRouter.js';
import http from 'http';

async function runTests() {
  console.log('--- Starting Signup Country Code & Validation Tests ---');
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

    // Test 1: Register Indian user with +91
    console.log('\n[Test 1] Register user with +91 (India) and 10-digit number...');
    const c1 = await getCaptcha();
    const indEmail = `test_ind_${stamp}@example.com`;
    const indLocalPhone = `98${randSuffix}10`;
    const regRes1 = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'India User',
        email: indEmail,
        countryCode: '+91',
        localPhone: indLocalPhone,
        phone: '91' + indLocalPhone,
        password: 'password123',
        captchaId: c1.id,
        captchaAnswer: c1.answer
      })
    });
    const regData1 = await regRes1.json();
    console.log('Status:', regRes1.status);
    console.log('Response:', regData1);
    if (regRes1.status !== 201) throw new Error('Test 1 failed: ' + JSON.stringify(regData1));
    if (regData1.user.phone !== '91' + indLocalPhone) throw new Error(`Expected phone 91${indLocalPhone} but got ${regData1.user.phone}`);
    console.log(`✓ PASS: Registered successfully with phone saved as 91${indLocalPhone}`);

    // Test 2: Register US user with +1
    console.log('\n[Test 2] Register user with +1 (USA) and 10-digit number...');
    const c2 = await getCaptcha();
    const usEmail = `test_us_${stamp}@example.com`;
    const usLocalPhone = `41${randSuffix}1`;
    const regRes2 = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'US User',
        email: usEmail,
        countryCode: '+1',
        localPhone: usLocalPhone,
        phone: '1' + usLocalPhone,
        password: 'password123',
        captchaId: c2.id,
        captchaAnswer: c2.answer
      })
    });
    const regData2 = await regRes2.json();
    console.log('Status:', regRes2.status);
    console.log('Response:', regData2);
    if (regRes2.status !== 201) throw new Error('Test 2 failed: ' + JSON.stringify(regData2));
    if (regData2.user.phone !== '1' + usLocalPhone) throw new Error(`Expected phone 1${usLocalPhone} but got ${regData2.user.phone}`);
    console.log(`✓ PASS: Registered successfully with phone saved as 1${usLocalPhone}`);

    // Test 3: Login using full phone with country code
    console.log(`\n[Test 3] Login using full phone with country code (91${indLocalPhone})...`);
    const loginRes1 = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: '91' + indLocalPhone,
        password: 'password123'
      })
    });
    const loginData1 = await loginRes1.json();
    console.log('Status:', loginRes1.status);
    if (loginRes1.status !== 200 || !loginData1.token) throw new Error('Test 3 failed: ' + JSON.stringify(loginData1));
    console.log(`✓ PASS: Logged in with full phone 91${indLocalPhone}`);

    // Test 4: Login using 10-digit local phone number
    console.log(`\n[Test 4] Login using 10-digit local phone number (${indLocalPhone})...`);
    const loginRes2 = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: indLocalPhone,
        password: 'password123'
      })
    });
    const loginData2 = await loginRes2.json();
    console.log('Status:', loginRes2.status);
    if (loginRes2.status !== 200 || !loginData2.token) throw new Error('Test 4 failed: ' + JSON.stringify(loginData2));
    console.log(`✓ PASS: Logged in with 10-digit phone ${indLocalPhone}`);

    // Test 5: Validation for duplicate phone number
    console.log('\n[Test 5] Reject duplicate phone number registration...');
    const c3 = await getCaptcha();
    const dupRes = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Duplicate User',
        email: `dup_${stamp}@example.com`,
        countryCode: '+91',
        localPhone: indLocalPhone,
        phone: '91' + indLocalPhone,
        password: 'password123',
        captchaId: c3.id,
        captchaAnswer: c3.answer
      })
    });
    const dupData = await dupRes.json();
    console.log('Status:', dupRes.status, 'Response:', dupData);
    if (dupRes.status !== 409) throw new Error('Test 5 failed: Duplicate phone should return 409');
    console.log('✓ PASS: Duplicate phone rejected with 409');

    // Test 6: Validation for invalid / short phone number
    console.log('\n[Test 6] Reject short phone number (< 7 digits)...');
    const c4 = await getCaptcha();
    const invalidRes = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Invalid User',
        email: `invalid_${stamp}@example.com`,
        countryCode: '+91',
        localPhone: '123',
        phone: '91123',
        password: 'password123',
        captchaId: c4.id,
        captchaAnswer: c4.answer
      })
    });
    const invalidData = await invalidRes.json();
    console.log('Status:', invalidRes.status, 'Response:', invalidData);
    if (invalidRes.status !== 400) throw new Error('Test 6 failed: Short phone should return 400');
    console.log('✓ PASS: Short phone rejected with 400');

    // Test 7: Register user with custom manual country code +355
    const customLocalPhone = `69${randSuffix}`;
    console.log(`\n[Test 7] Register user with custom manual country code +355 and phone ${customLocalPhone}...`);
    const c5 = await getCaptcha();
    const customEmail = `test_custom_${stamp}@example.com`;
    const regRes7 = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Custom Country User',
        email: customEmail,
        countryCode: '+355',
        localPhone: customLocalPhone,
        phone: '355' + customLocalPhone,
        password: 'password123',
        captchaId: c5.id,
        captchaAnswer: c5.answer
      })
    });
    const regData7 = await regRes7.json();
    console.log('Status:', regRes7.status, 'Response:', regData7);
    if (regRes7.status !== 201) throw new Error('Test 7 failed: ' + JSON.stringify(regData7));
    if (regData7.user.phone !== '355' + customLocalPhone) throw new Error(`Expected phone 355${customLocalPhone} but got ${regData7.user.phone}`);
    console.log(`✓ PASS: Registered successfully with custom manual country code as 355${customLocalPhone}`);

    console.log('\n=========================================');
    console.log('🎉 ALL SIGNUP COUNTRY CODE TESTS PASSED!');
    console.log('=========================================');
  } finally {
    server.close();
  }
}

runTests().catch(err => {
  console.error('FATAL TEST ERROR:', err);
  process.exit(1);
});
