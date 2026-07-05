const BASE_URL = 'http://localhost:3005';

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runIntegrationTest() {
  console.log('--- Starting Endpoint Integration Tests ---');

  const testEmail = `integration_${Date.now()}@domain.com`;
  const initialPassword = 'initial123Password';
  const resetPassword = 'reset456Password';
  const finalPassword = 'final789Password';

  // 1. Register User
  console.log(`\n[1] Fetching captcha and registering user: ${testEmail}...`);
  const captchaRes = await fetch(`${BASE_URL}/auth/captcha`);
  const captchaData = await captchaRes.json();
  const expression = captchaData.question.split(' =')[0]; // e.g. "3 + 5"
  const captchaAnswer = String(eval(expression));

  const regRes = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Integration Test User',
      email: testEmail,
      phone: '919999999999',
      password: initialPassword,
      captchaId: captchaData.id,
      captchaAnswer
    })
  });
  const regData = await regRes.json();
  console.log('Registration Response Status:', regRes.status);
  console.log('Registration Response Data:', regData);
  if (!regRes.ok) throw new Error('Registration failed');

  // 2. Login User (Initial)
  console.log('\n[2] Logging in user with initial password...');
  const login1Res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: initialPassword })
  });
  const login1Data = await login1Res.json();
  console.log('Login 1 Response Status:', login1Res.status);
  console.log('Token exists:', !!login1Data.token);
  if (!login1Res.ok) throw new Error('Login 1 failed');

  // 3. Forgot Password Request
  console.log('\n[3] Triggering Forgot Password flow...');
  const forgotRes = await fetch(`${BASE_URL}/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail })
  });
  const forgotData = await forgotRes.json();
  console.log('Forgot Password Status:', forgotRes.status);
  console.log('Forgot Password Data:', forgotData);
  if (!forgotRes.ok) throw new Error('Forgot password request failed');
  if (!forgotData.otp) throw new Error('No OTP returned in response');

  const otp = forgotData.otp;

  // 4. Reset Password using OTP
  console.log(`\n[4] Resetting password using OTP: ${otp}...`);
  const resetRes = await fetch(`${BASE_URL}/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testEmail,
      otp: otp,
      newPassword: resetPassword
    })
  });
  const resetData = await resetRes.json();
  console.log('Reset Password Status:', resetRes.status);
  console.log('Reset Password Data:', resetData);
  if (!resetRes.ok) throw new Error('Password reset failed');

  // 5. Login User (Reset Password)
  console.log('\n[5] Logging in with reset password...');
  const login2Res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: resetPassword })
  });
  const login2Data = await login2Res.json();
  console.log('Login 2 Response Status:', login2Res.status);
  console.log('Token exists:', !!login2Data.token);
  if (!login2Res.ok) throw new Error('Login 2 failed');

  const userToken = login2Data.token;

  // 6. Change Password (Authenticated)
  console.log('\n[6] Changing password via authenticated endpoint...');
  const changeRes = await fetch(`${BASE_URL}/auth/change-password`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${userToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      currentPassword: resetPassword,
      newPassword: finalPassword
    })
  });
  const changeData = await changeRes.json();
  console.log('Change Password Status:', changeRes.status);
  console.log('Change Password Data:', changeData);
  if (!changeRes.ok) throw new Error('Change password failed');

  // 7. Login User (Final Password)
  console.log('\n[7] Logging in with final password...');
  const login3Res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: finalPassword })
  });
  const login3Data = await login3Res.json();
  console.log('Login 3 Response Status:', login3Res.status);
  console.log('Token exists:', !!login3Data.token);
  if (!login3Res.ok) throw new Error('Login 3 failed');

  // 8. Attempt login with old reset password (should fail)
  console.log('\n[8] Confirming old reset password fails to authenticate...');
  const loginOldRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: resetPassword })
  });
  console.log('Login with Old Password Status (should be 401):', loginOldRes.status);
  if (loginOldRes.status !== 401) {
    throw new Error('Old password was still accepted after change!');
  }

  console.log('\n--- All Endpoint Integration Tests Passed! ---');
}

runIntegrationTest().catch(e => {
  console.error('Integration test failed:', e);
  process.exit(1);
});
