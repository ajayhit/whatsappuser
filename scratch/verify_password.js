import { 
  createUser, 
  getUserByEmail, 
  createPasswordResetToken, 
  getValidResetToken, 
  invalidateResetToken, 
  updateUserPassword,
  verifyPassword,
  initDb 
} from '../db.js';

async function runTests() {
  console.log('--- Starting Password Reset DB Helpers Verification ---');
  initDb();
  
  const testEmail = `test_reset_${Date.now()}@domain.com`;
  console.log(`Creating test user: ${testEmail}`);
  const userResult = createUser({
    name: 'Test Reset User',
    email: testEmail,
    phone: '919999999999',
    password: 'initialpassword123'
  });
  const user = getUserByEmail(testEmail);
  console.log('User created:', user);

  console.log('\nCreating password reset token...');
  const tokenObj = createPasswordResetToken(user.id);
  console.log('Token object created:', tokenObj);

  console.log('\nVerifying token search for valid token...');
  const foundToken = getValidResetToken(testEmail, tokenObj.token);
  console.log('Token found & verified valid:', foundToken);

  if (!foundToken) {
    throw new Error('Failed to find valid reset token');
  }

  console.log('\nUpdating password with token...');
  updateUserPassword(user.id, 'newpassword456');
  console.log('Password updated successfully in database.');

  console.log('\nInvalidating reset token...');
  invalidateResetToken(foundToken.id);
  console.log('Token invalidated.');

  console.log('\nAttempting to query invalid/used token...');
  const usedToken = getValidResetToken(testEmail, tokenObj.token);
  console.log('Query output for used token (should be undefined):', usedToken);

  if (usedToken) {
    throw new Error('Used token is still active/valid!');
  }

  console.log('\nVerifying new password authentication...');
  const updatedUser = getUserByEmail(testEmail);
  const authOld = verifyPassword('initialpassword123', updatedUser.password_hash);
  const authNew = verifyPassword('newpassword456', updatedUser.password_hash);

  console.log(`Auth verification - Old password match (should be false): ${authOld}`);
  console.log(`Auth verification - New password match (should be true): ${authNew}`);

  if (authOld || !authNew) {
    throw new Error('Password verification results mismatch');
  }

  console.log('\n--- All Password Reset DB Helper Tests Passed! ---');
}

runTests().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
