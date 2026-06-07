import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRouter from './apiRouter.js';
import { restoreAllSessions } from './sessionManager.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON body parser
app.use(cors());
app.use(express.json());

// Serve static control panel assets from the 'public' folder
app.use(express.static('public'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Mount the API endpoints at /api
app.use('/api', apiRouter);

// Start the Express server
app.listen(PORT, async () => {
  console.log(`==================================================`);
  console.log(` WhatsApp Automation API Server is starting up...`);
  console.log(` Port: ${PORT}`);
  console.log(` Env: ${process.env.NODE_ENV || 'development'}`);
  console.log(`==================================================`);
  
  // Automatically restore previously authenticated sessions in the background
  await restoreAllSessions();
});
