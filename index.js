import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRouter from './apiRouter.js';
import authRouter from './authRouter.js';
import adminRouter from './adminRouter.js';
import { restoreAllSessions } from './sessionManager.js';
import { initDb, getUserByEmail, createUser } from './db.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize SQLite database
initDb();

// Seed admin user on startup if it doesn't exist
const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
try {
  const existingAdmin = getUserByEmail(adminEmail);
  if (!existingAdmin) {
    createUser({
      name: 'System Admin',
      email: adminEmail,
      phone: '0000000000',
      password: adminPassword,
      role: 'admin'
    });
    console.log(`[Admin Seed] Created default admin account: ${adminEmail}`);
  } else {
    console.log(`[Admin Seed] Admin account already exists: ${adminEmail}`);
  }
} catch (err) {
  console.error('[Admin Seed] Error seeding admin:', err);
}

// Enable CORS and JSON body parser
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static control panel assets from the 'public' folder
app.use(express.static('public'));

// Serve uploaded payment screenshots
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Mount the Auth Router at /auth
app.use('/auth', authRouter);

// Mount the Admin Router at /admin
app.use('/admin', adminRouter);

// Mount the WhatsApp API endpoints at /api
app.use('/api', apiRouter);

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'Uploaded media is too large. Please use a smaller file or send it using a public URL.'
    });
  }
  console.error('Unhandled server error:', err);
  return res.status(500).json({ error: err.message || 'Internal server error' });
});

// Start the Express server
app.listen(PORT, async () => {
  console.log(`==================================================`);
  console.log(` WhatsApp Automation API Server is starting up...`);
  console.log(` Port: ${PORT}`);
  console.log(` Env: ${process.env.NODE_ENV || 'development'}`);
  console.log(`==================================================`);
  
  // Automatically restore previously authenticated sessions in the background
  try {
    await restoreAllSessions();
  } catch (err) {
    console.error('Error restoring sessions:', err);
  }
});
