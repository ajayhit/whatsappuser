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
import { authMiddleware } from './middleware/authMiddleware.js';
import { planMiddleware } from './middleware/planMiddleware.js';
import multer from 'multer';
import xlsx from 'xlsx';
import path from 'path';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

// Helper: normalize phone number - auto-prepend 91 if 10 digits
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return '91' + digits;
  return digits;
}

// All WhatsApp API routes require a valid JWT token + active plan
router.use(authMiddleware);
router.use(planMiddleware);

/**
 * Route: POST /api/session/login
 * Starts or returns state of a WhatsApp Web session for the authenticated user.
 */
router.post('/session/login', async (req, res) => {
  const userId = String(req.user.id);
  try {
    await initSession(userId);
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
 * Returns the current WhatsApp connection status.
 * Accepts optional ?userId=<id> in query (falls back to JWT user id).
 */
router.get('/session/status', (req, res) => {
  const userId = String(req.query.userId || req.user.id);
  try {
    const statusInfo = getSessionStatus(userId);
    return res.json({ userId, ...statusInfo });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Route: POST /api/session/logout
 * Disconnects the WhatsApp session.
 * Body: { userId? }  — falls back to JWT user id.
 */
router.post('/session/logout', async (req, res) => {
  const userId = String(req.body.userId || req.user.id);
  try {
    const result = await logoutSession(userId);
    return res.json({ message: 'Session logged out and cleaned up', userId, ...result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Route: POST /api/message/send
 * Body: { userId?, to, message, mediaUrl, mediaType, caption, fileName, mimetype }
 * Sends a text message or media message. `to` can be a 10-digit number (auto-prepends 91).
 */
router.post('/message/send', async (req, res) => {
  const userId = String(req.body.userId || req.user.id);
  const { to, message, mediaUrl, mediaType, caption, fileName, mimetype } = req.body;

  if (!to)      return res.status(400).json({ error: '"to" (recipient mobile number) is required' });
  if (!message && !(mediaUrl && mediaType)) {
    return res.status(400).json({ error: 'Either "message" or media attachment details are required' });
  }

  const recipientPhone = normalizePhone(to);
  if (recipientPhone.length < 10) {
    return res.status(400).json({ error: 'Invalid mobile number. Must be at least 10 digits.' });
  }

  try {
    const result = mediaUrl && mediaType
      ? await sendMediaToJid(userId, recipientPhone, mediaUrl, mediaType, caption || message || '', fileName, mimetype)
      : await sendMessageToJid(userId, recipientPhone, message);
    return res.json({
      success: true,
      message: mediaUrl && mediaType ? 'Media sent successfully' : 'Message sent successfully',
      userId,
      to: recipientPhone,
      messageId: result?.key?.id || null,
      status: 'SENT'
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Route: POST /api/message/send-media
 * Multipart form-data: { userId?, to, message?, file }
 * Sends a media file (image, video, audio, document) to a phone number.
 * `to` can be a 10-digit number (auto-prepends 91).
 */
router.post('/message/send-media', upload.single('file'), async (req, res) => {
  const userId = String(req.body.userId || req.user.id);
  const { to, message } = req.body;

  if (!to)       return res.status(400).json({ error: '"to" (recipient mobile number) is required' });
  if (!req.file) return res.status(400).json({ error: '"file" media attachment is required' });

  const recipientPhone = normalizePhone(to);
  if (recipientPhone.length < 10) {
    return res.status(400).json({ error: 'Invalid mobile number. Must be at least 10 digits.' });
  }

  // Determine media type from mime type
  const mimeType = req.file.mimetype;
  let mediaType = 'document';
  if (mimeType.startsWith('image/'))       mediaType = 'image';
  else if (mimeType.startsWith('video/')) mediaType = 'video';
  else if (mimeType.startsWith('audio/')) mediaType = 'audio';

  // Convert buffer to base64 data URL so sendMediaToJid can resolve it
  const base64Data = req.file.buffer.toString('base64');
  const dataUrl    = `data:${mimeType};base64,${base64Data}`;
  const fileName   = req.file.originalname || 'attachment';

  try {
    const result = await sendMediaToJid(userId, recipientPhone, dataUrl, mediaType, message || '', fileName, mimeType);
    return res.json({
      success: true,
      message: 'Media sent successfully',
      userId,
      to: recipientPhone,
      mediaType,
      fileName,
      messageId: result?.key?.id || null,
      status: 'SENT'
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Route: GET /api/groups
 * Lists all groups the authenticated user is participating in.
 */
router.get('/groups', async (req, res) => {
  const userId = String(req.user.id);
  try {
    const groups = await getGroupsList(userId);
    return res.json({ userId, groups });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Route: POST /api/groups/send
 * Body: { groupId, message, mediaUrl?, mediaType?, caption?, fileName?, mimetype? }
 * Sends a text or media message to a group.
 */
router.post('/groups/send', async (req, res) => {
  const userId = String(req.user.id);
  const { groupId, message, mediaUrl, mediaType, caption, fileName, mimetype } = req.body;
  if (!groupId) return res.status(400).json({ error: 'groupId is required' });

  try {
    let result;
    if (mediaUrl && mediaType) {
      result = await sendMediaToJid(userId, groupId, mediaUrl, mediaType, caption || message, fileName, mimetype);
    } else {
      if (!message) return res.status(400).json({ error: 'message is required for text-only messages' });
      result = await sendMessageToJid(userId, groupId, message);
    }
    return res.json({ success: true, message: 'Group message sent successfully', messageId: result?.key?.id || null, status: 'SENT' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Route: GET /api/profile
 * Query: ?phone=... (optional, defaults to own profile)
 */
router.get('/profile', async (req, res) => {
  const userId = String(req.user.id);
  const { phone } = req.query;
  try {
    const profile = await getProfileInfo(userId, phone);
    return res.json({ userId, ...profile });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Route: POST /api/message/parse-excel
 * Body: file (multipart form-data), message (template text)
 * Parses Excel file in-memory and returns templated sending tasks.
 */
router.post('/message/parse-excel', upload.single('file'), (req, res) => {
  const { message } = req.body;
  if (!req.file) {
    return res.status(400).json({ error: 'Excel file is required' });
  }
  if (!message) {
    return res.status(400).json({ error: 'Message template is required' });
  }

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON with empty strings for empty cells
    const rows = xlsx.utils.sheet_to_json(worksheet, { defval: '' });

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Excel sheet is empty' });
    }

    // Auto-detect the phone number column
    const sampleRow = rows[0];
    const keys = Object.keys(sampleRow);
    const phoneKeys = ['phone', 'mobile', 'number', 'contact', 'phonenumber', 'mobilenumber', 'recipient', 'to'];
    const phoneKey = keys.find(k => {
      const normalized = k.toLowerCase().replace(/[\s_-]/g, '');
      return phoneKeys.includes(normalized);
    });

    if (!phoneKey) {
      return res.status(400).json({
        error: 'Could not find a phone number column in the Excel file. Please ensure you have a column named "phone", "mobile", or "number".'
      });
    }

    // Generate tasks
    const tasks = rows.map((row, idx) => {
      const rawPhone = String(row[phoneKey] || '').trim();
      const cleanPhone = normalizePhone(rawPhone);

      // Format custom message template
      let formattedMsg = message;
      Object.keys(row).forEach(k => {
        const val = row[k] === undefined || row[k] === null ? '' : String(row[k]);
        const escapedKey = k.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(`\\{${escapedKey}\\}`, 'gi');
        formattedMsg = formattedMsg.replace(regex, val);
      });

      return {
        id: idx + 1,
        phone: cleanPhone,
        originalPhone: rawPhone,
        message: formattedMsg,
        rowData: row
      };
    }).filter(t => t.phone.length >= 10);

    if (tasks.length === 0) {
      return res.status(400).json({ error: 'No valid phone numbers (at least 10 digits) found under the detected phone column.' });
    }

    return res.json({
      success: true,
      phoneColumnUsed: phoneKey,
      recipientCount: tasks.length,
      tasks
    });
  } catch (err) {
    console.error('[Excel Parse Error]', err);
    return res.status(500).json({ error: `Failed to parse Excel file: ${err.message}` });
  }
});

export default router;
