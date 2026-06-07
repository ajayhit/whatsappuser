import express from 'express';
import {
  initSession,
  getSessionStatus,
  logoutSession,
  sendMessageToJid,
  getProfileInfo,
  getGroupsList,
  waitForSessionState,
  sendMediaToJid
} from './sessionManager.js';

const router = express.Router();

/**
 * Route: POST /api/session/login
 * Body: { userId }
 * Starts or returns state of a WhatsApp Web session. If needing QR, returns it as base64 PNG data.
 */
router.post('/session/login', async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required in the request body' });
  }

  try {
    // Initialize session (runs connection in background)
    await initSession(userId);
    
    // Wait for the connection to be established or the QR code to be generated
    const sessionInfo = await waitForSessionState(userId, ['CONNECTED', 'QR'], 8000);

    return res.json({
      message: sessionInfo.status === 'CONNECTED'
        ? 'Session connected successfully'
        : sessionInfo.status === 'QR'
        ? 'Scan the QR code to log in'
        : 'Session is initializing in background',
      userId,
      ...sessionInfo
    });
  } catch (err) {
    console.error(`Login error for user ${userId}:`, err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Route: GET /api/session/status
 * Query: ?userId=...
 * Checks the status of a specific session and returns details, including QR if scanner-ready.
 */
router.get('/session/status', (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'userId query parameter is required' });
  }

  try {
    const statusInfo = getSessionStatus(userId);
    return res.json({
      userId,
      ...statusInfo
    });
  } catch (err) {
    console.error(`Status error for user ${userId}:`, err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Route: POST /api/session/logout
 * Body: { userId }
 * Disconnects session and purges local auth credentials.
 */
router.post('/session/logout', async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required in the request body' });
  }

  try {
    const result = await logoutSession(userId);
    return res.json({
      message: 'Session logged out and cleaned up',
      userId,
      ...result
    });
  } catch (err) {
    console.error(`Logout error for user ${userId}:`, err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Route: POST /api/message/send
 * Body: { userId, to, message, mediaUrl, mediaType, caption, fileName, mimetype }
 * Sends a text message or media attachment (image, document, audio, video) to a phone number or group JID.
 */
router.post('/message/send', async (req, res) => {
  const { userId, to, message, mediaUrl, mediaType, caption, fileName, mimetype } = req.body;
  if (!userId || !to) {
    return res.status(400).json({ error: 'userId and to are required' });
  }

  try {
    let result;
    if (mediaUrl && mediaType) {
      const resolvedCaption = caption || message;
      result = await sendMediaToJid(userId, to, mediaUrl, mediaType, resolvedCaption, fileName, mimetype);
    } else {
      if (!message) {
        return res.status(400).json({ error: 'message is required for text-only messages' });
      }
      result = await sendMessageToJid(userId, to, message);
    }

    return res.json({
      success: true,
      message: 'Message sent successfully',
      messageId: result?.key?.id || null,
      status: 'SENT'
    });
  } catch (err) {
    console.error(`Send message error for user ${userId}:`, err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Route: GET /api/groups
 * Query: ?userId=...
 * Lists all participating groups.
 */
router.get('/groups', async (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'userId query parameter is required' });
  }

  try {
    const groups = await getGroupsList(userId);
    return res.json({
      userId,
      groups
    });
  } catch (err) {
    console.error(`Fetch groups error for user ${userId}:`, err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Route: POST /api/groups/send
 * Body: { userId, groupId, message, mediaUrl, mediaType, caption, fileName, mimetype }
 * Sends a text message or media attachment (image, document, audio, video) to a group JID.
 */
router.post('/groups/send', async (req, res) => {
  const { userId, groupId, message, mediaUrl, mediaType, caption, fileName, mimetype } = req.body;
  if (!userId || !groupId) {
    return res.status(400).json({ error: 'userId and groupId are required' });
  }

  try {
    let result;
    if (mediaUrl && mediaType) {
      const resolvedCaption = caption || message;
      result = await sendMediaToJid(userId, groupId, mediaUrl, mediaType, resolvedCaption, fileName, mimetype);
    } else {
      if (!message) {
        return res.status(400).json({ error: 'message is required for text-only messages' });
      }
      result = await sendMessageToJid(userId, groupId, message);
    }

    return res.json({
      success: true,
      message: 'Group message sent successfully',
      messageId: result?.key?.id || null,
      status: 'SENT'
    });
  } catch (err) {
    console.error(`Send group message error for user ${userId}:`, err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Route: GET /api/profile
 * Query: ?userId=...&phone=...
 * Fetches profile info (phone and profile picture URL). If phone parameter is empty, fetches own profile.
 */
router.get('/profile', async (req, res) => {
  const { userId, phone } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'userId query parameter is required' });
  }

  try {
    const profile = await getProfileInfo(userId, phone);
    return res.json({
      userId,
      ...profile
    });
  } catch (err) {
    console.error(`Fetch profile error for user ${userId}:`, err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
