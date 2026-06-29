import xlsx from 'xlsx';
import { activatePlan } from '../db.js';

const BASE_URL = 'http://localhost:3005';

// 1. Generate in-memory Excel Workbook
console.log('Generating test Excel workbook in-memory...');
const testData = [
  { Name: 'Alice Smith', Phone: '919876543210', Code: 'A123' },
  { Name: 'Bob Jones', Phone: '919876543211', Code: 'B456' },
  { Name: 'Dev Kumar', Phone: '9876543212', Code: 'D012' }, // 10-digit phone (should auto-prepend 91)
  { Name: 'Charlie Invalid', Phone: '999', Code: 'C789' } // Invalid phone (should be filtered out)
];

const worksheet = xlsx.utils.json_to_sheet(testData);
const workbook = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
const excelBuffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

async function runTest() {
  console.log('\n--- Starting Excel Parse Integration Test ---');

  // Let's get an admin token to log in or register a new user
  const email = `excel_test_${Date.now()}@domain.com`;
  const password = 'testpassword123';

  console.log(`Registering user: ${email}...`);
  const regRes = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Excel Tester',
      email,
      phone: '919999999999',
      password
    })
  });
  const regData = await regRes.json();
  if (!regRes.ok) throw new Error(`Registration failed: ${regData.error}`);
  
  const token = regData.token;
  console.log('User registered and token acquired.');

  console.log('Activating plan for the user...');
  activatePlan(regData.user.id);
  console.log('Plan activated.');

  // Create multipart body
  const form = new FormData();
  
  // Create File object from buffer (Node.js 20+ has global File and FormData)
  const file = new File([excelBuffer], 'recipients.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  form.append('file', file);
  form.append('message', 'Hello {Name}, your activation code is {Code}. Please keep it secure!');

  console.log('\nUploading Excel file to /api/message/parse-excel...');
  const uploadRes = await fetch(`${BASE_URL}/api/message/parse-excel`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: form
  });

  const uploadData = await uploadRes.json();
  console.log('Response Status:', uploadRes.status);
  console.log('Response Data:', JSON.stringify(uploadData, null, 2));

  if (!uploadRes.ok) {
    throw new Error(`Upload failed: ${uploadData.error}`);
  }

  // Assertions
  console.log('\nPerforming Assertions...');
  console.log('Phone column auto-detected:', uploadData.phoneColumnUsed === 'Phone' ? 'PASS' : 'FAIL');
  console.log('Recipient count (should be 3):', uploadData.recipientCount === 3 ? 'PASS' : 'FAIL');
  
  const tasks = uploadData.tasks;
  const aliceTask = tasks.find(t => t.phone === '919876543210');
  const bobTask = tasks.find(t => t.phone === '919876543211');
  const devTask = tasks.find(t => t.phone === '919876543212');
  const charlieTask = tasks.find(t => t.phone === '999');

  console.log('Alice task found:', !!aliceTask ? 'PASS' : 'FAIL');
  console.log('Alice message matches template:', aliceTask?.message === 'Hello Alice Smith, your activation code is A123. Please keep it secure!' ? 'PASS' : 'FAIL');
  
  console.log('Bob task found:', !!bobTask ? 'PASS' : 'FAIL');
  console.log('Bob message matches template:', bobTask?.message === 'Hello Bob Jones, your activation code is B456. Please keep it secure!' ? 'PASS' : 'FAIL');

  console.log('Dev task found (10-digit number auto-prepending):', !!devTask ? 'PASS' : 'FAIL');
  console.log('Dev original phone was 10-digit:', devTask?.originalPhone === '9876543212' ? 'PASS' : 'FAIL');
  console.log('Dev clean phone has 91 prefix:', devTask?.phone === '919876543212' ? 'PASS' : 'FAIL');

  console.log('Charlie task excluded (should be undefined):', charlieTask === undefined ? 'PASS' : 'FAIL');

  if (
    uploadData.phoneColumnUsed !== 'Phone' ||
    uploadData.recipientCount !== 3 ||
    !aliceTask ||
    aliceTask.message !== 'Hello Alice Smith, your activation code is A123. Please keep it secure!' ||
    !bobTask ||
    bobTask.message !== 'Hello Bob Jones, your activation code is B456. Please keep it secure!' ||
    !devTask ||
    devTask.phone !== '919876543212' ||
    charlieTask !== undefined
  ) {
    throw new Error('Some test assertions failed!');
  }

  console.log('\n--- Excel Bulk Message Parsing Verification Completed Successfully! ---');
}

runTest().catch(e => {
  console.error('Integration test failed:', e);
  process.exit(1);
});
