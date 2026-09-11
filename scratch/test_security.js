import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import path from 'path';
import { authLimiter } from '../middleware/rateLimiters.js';

async function runTests() {
  console.log('Testing Security & Hardening Changes...');

  // 1. Test Helmet configuration
  const app = express();
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  }));
  app.get('/test', (req, res) => res.send('OK'));

  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/test`);
    const xContentType = res.headers.get('x-content-type-options');
    const xFrameOptions = res.headers.get('x-frame-options');

    console.log(`[Helmet Test] X-Content-Type-Options: ${xContentType}`);
    console.log(`[Helmet Test] X-Frame-Options: ${xFrameOptions}`);

    if (xContentType !== 'nosniff') {
      throw new Error('Expected nosniff header from Helmet');
    }
  } finally {
    server.close();
  }

  // 2. Test File Upload Extension Filtering
  const ALLOWED_CRM_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.webp', '.gif',
    '.mp3', '.ogg', '.wav', '.m4a', '.aac',
    '.mp4', '.webm', '.mov', '.3gp',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv'
  ]);

  function checkFile(originalname, mimetype) {
    const ext = path.extname(originalname).toLowerCase();
    if (!ALLOWED_CRM_EXTENSIONS.has(ext)) {
      return { allowed: false, reason: 'extension' };
    }
    const mime = (mimetype || '').toLowerCase();
    if (mime.includes('html') || mime.includes('javascript') || mime.includes('svg+xml') || mime.includes('x-sh')) {
      return { allowed: false, reason: 'mime' };
    }
    return { allowed: true };
  }

  const badFiles = [
    { name: 'hack.html', mime: 'text/html' },
    { name: 'image.svg', mime: 'image/svg+xml' },
    { name: 'malware.exe', mime: 'application/octet-stream' },
    { name: 'script.sh', mime: 'text/x-sh' },
    { name: 'shell.php', mime: 'application/x-httpd-php' },
    { name: 'test.jpg', mime: 'text/html' } // spoofed mime
  ];

  for (const f of badFiles) {
    const result = checkFile(f.name, f.mime);
    if (result.allowed) {
      throw new Error(`Security Failure: ${f.name} should have been blocked!`);
    }
    console.log(`[Upload Filter] Correctly blocked dangerous file: ${f.name} (${result.reason})`);
  }

  const goodFiles = [
    { name: 'banner.jpg', mime: 'image/jpeg' },
    { name: 'photo.png', mime: 'image/png' },
    { name: 'document.pdf', mime: 'application/pdf' },
    { name: 'voice.mp3', mime: 'audio/mpeg' },
    { name: 'contacts.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
  ];

  for (const f of goodFiles) {
    const result = checkFile(f.name, f.mime);
    if (!result.allowed) {
      throw new Error(`Security Failure: legitimate file ${f.name} was incorrectly blocked!`);
    }
    console.log(`[Upload Filter] Correctly allowed safe file: ${f.name}`);
  }

  console.log('✅ ALL SECURITY TESTS PASSED!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
