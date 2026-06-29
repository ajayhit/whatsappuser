import makeWASocket, { useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'fs/promises';
import path from 'path';

// Memory stores for active connections and statuses
export const sessions = new Map();
export const sessionStatus = new Map();
export const qrCodes = new Map();
const reconnectCount = new Map();
const sessionsDir = process.env.SESSION_DIR || './sessions';

function normalizeTargetJid(to) {
  let jid = to.trim();
  if (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@g.us')) {
    const cleanNumber = jid.replace(/\D/g, '');
    jid = `${cleanNumber}@s.whatsapp.net`;
  }
  return jid;
}

async function prepareDirectMessageSession(sock, jid) {
  if (jid.endsWith('@g.us')) return;

  const lookup = await sock.onWhatsApp(jid);
  const matched = lookup?.find(item => item.exists);
  if (!matched) {
    throw new Error(`Recipient is not available on WhatsApp: ${jid.split('@')[0]}`);
  }

  await sock.presenceSubscribe(jid).catch(() => {});
  await sock.assertSessions([jid], true);
}

/**
 * Initializes a new WhatsApp Web session or returns the state of an existing one.
 * @param {string} userId - Unique identifier for the user
 * @returns {Promise<{status: string, qr?: string}>}
 */
export async function initSession(userId) {
  // Check if session already exists
  if (sessions.has(userId)) {
    const status = sessionStatus.get(userId);
    if (status === 'CONNECTED') {
      return { status: 'CONNECTED' };
    }
    if (status === 'QR') {
      return { status: 'QR', qr: qrCodes.get(userId) };
    }
    return { status };
  }

  sessionStatus.set(userId, 'CONNECTING');

  const sessionDir = path.join(sessionsDir, `session_${userId}`);
  
  // Ensure the sessions directory structure exists
  await fs.mkdir(sessionsDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  // Dynamically fetch the latest WhatsApp Web client version to avoid 405 handshake errors
  let version = [2, 3000, 1017539728]; // Fallback version
  try {
    const fetched = await fetchLatestBaileysVersion();
    version = fetched.version;
    console.log(`[WhatsApp Version] Dynamically fetched latest: v${version.join('.')}, isLatest: ${fetched.isLatest}`);
  } catch (err) {
    console.log(`[WhatsApp Version Warning] Failed to fetch latest web version, using fallback v${version.join('.')}. Error: ${err.message}`);
  }

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }), // Suppress Baileys verbose logs
    printQRInTerminal: false,
    browser: Browsers.macOS('Desktop'), // Mimic a standard desktop client to prevent 405 blocks
  });

  sessions.set(userId, sock);

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Handle QR Code emission
    if (qr) {
      sessionStatus.set(userId, 'QR');
      try {
        const qrImage = await QRCode.toDataURL(qr);
        qrCodes.set(userId, qrImage);
      } catch (err) {
        console.error(`Error generating QR code for user ${userId}:`, err);
      }
    }

    // Handle successful connection
    if (connection === 'open') {
      sessionStatus.set(userId, 'CONNECTED');
      qrCodes.delete(userId);
      reconnectCount.delete(userId);
      console.log(`[Session Connected] userId: ${userId}, phone: ${sock.user.id.split(':')[0]}`);
    }

    // Handle connection closures
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      
      // 405 means Method Not Allowed / Rejected connection (frequently due to corrupted credentials or ban check)
      // 401 means Logged Out
      // 403 means Forbidden
      const isCriticalError = [401, 403, 405].includes(statusCode);
      const shouldReconnect = !isCriticalError && statusCode !== DisconnectReason.loggedOut;

      console.log(`[Session Closed] userId: ${userId}, statusCode: ${statusCode}, shouldReconnect: ${shouldReconnect}`);

      if (shouldReconnect) {
        const retries = reconnectCount.get(userId) || 0;
        if (retries < 5) {
          reconnectCount.set(userId, retries + 1);
          console.log(`[Reconnecting] userId: ${userId}, attempt: ${retries + 1}...`);
          
          setTimeout(() => {
            // Check if the session wasn't explicitly logged out/deleted in the meantime
            if (sessions.has(userId)) {
              sessions.delete(userId);
              initSession(userId).catch(err => {
                console.error(`Reconnection initialization failed for ${userId}:`, err);
              });
            }
          }, 3000);
        } else {
          console.log(`[Max Reconnects Reached] userId: ${userId}`);
          sessionStatus.set(userId, 'DISCONNECTED');
          sessions.delete(userId);
        }
      } else {
        // Manual or forced logout, or a critical error (like 405 / corrupted credentials)
        console.log(`[Session Terminated] Cleaning up credentials for userId: ${userId} due to statusCode: ${statusCode}`);
        sessionStatus.set(userId, 'DISCONNECTED');
        sessions.delete(userId);
        qrCodes.delete(userId);
        try {
          await fs.rm(sessionDir, { recursive: true, force: true });
        } catch (e) {
          console.error(`Error deleting auth directory for ${userId}:`, e);
        }
      }
    }
  });

  return { status: 'CONNECTING' };
}

/**
 * Retrieves the current status details of a WhatsApp session.
 * @param {string} userId 
 * @returns {{status: string, qr?: string, user?: {id: string, name: string, phone: string}}}
 */
export function getSessionStatus(userId) {
  if (!sessions.has(userId)) {
    return { status: 'DISCONNECTED' };
  }
  const status = sessionStatus.get(userId);
  const sock = sessions.get(userId);
  const details = (status === 'CONNECTED' && sock?.user) ? {
    id: sock.user.id,
    name: sock.user.name || 'WhatsApp User',
    phone: sock.user.id.split(':')[0]
  } : null;

  return {
    status,
    qr: status === 'QR' ? qrCodes.get(userId) : undefined,
    user: details
  };
}

/**
 * Logs out and cleans up session resources.
 * @param {string} userId 
 * @returns {Promise<{status: string}>}
 */
export async function logoutSession(userId) {
  const sock = sessions.get(userId);
  const status = sessionStatus.get(userId);
  const sessionDir = path.join(sessionsDir, `session_${userId}`);

  sessionStatus.set(userId, 'DISCONNECTED');
  qrCodes.delete(userId);

  if (sock && status === 'CONNECTED') {
    try {
      // Calling logout will trigger connection closure with statusCode: 401
      // The event listener in connection.update will automatically clean up the files and sessions map
      await sock.logout();
    } catch (err) {
      console.error(`Error logging out session ${userId} from WhatsApp:`, err.message);
      // Fallback manual cleanup if logout call fails
      try { sock.end(); } catch (e) {}
      sessions.delete(userId);
      try {
        await fs.rm(sessionDir, { recursive: true, force: true });
      } catch (e) {}
    }
  } else {
    // If not connected, clean up files and session immediately
    if (sock) {
      try { sock.end(); } catch (e) {}
      sessions.delete(userId);
    }
    try {
      await fs.rm(sessionDir, { recursive: true, force: true });
    } catch (err) {
      console.error(`Failed to delete session state folder for ${userId}:`, err.message);
    }
  }

  return { status: 'DISCONNECTED' };
}

/**
 * Sends a text message to a specific number or group.
 * @param {string} userId 
 * @param {string} to 
 * @param {string} message 
 */
export async function sendMessageToJid(userId, to, message) {
  const sock = sessions.get(userId);
  const status = sessionStatus.get(userId);

  if (!sock || status !== 'CONNECTED') {
    throw new Error('WhatsApp session is not connected or initialized.');
  }

  const jid = normalizeTargetJid(to);
  await prepareDirectMessageSession(sock, jid);

  const result = await sock.sendMessage(jid, { text: message }, { useUserDevicesCache: false });
  return result;
}

/**
 * Guesses the mime type of a file from its extension or media type.
 */
function getMimeType(urlOrPath, mediaType) {
  if (mediaType === 'image') return 'image/jpeg';
  if (mediaType === 'audio') return 'audio/mp3';
  if (mediaType === 'video') return 'video/mp4';
  
  const ext = path.extname(urlOrPath).toLowerCase();
  switch (ext) {
    case '.pdf': return 'application/pdf';
    case '.doc':
    case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.xls':
    case '.xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.zip': return 'application/zip';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    default: return 'application/octet-stream';
  }
}

/**
 * Sends a media message (image, document, audio, video) to a phone number or group.
 * Supports external HTTP URLs or base64 Data URLs.
 */
export async function sendMediaToJid(userId, to, mediaUrl, mediaType, caption, fileName, mimetype) {
  const sock = sessions.get(userId);
  const status = sessionStatus.get(userId);

  if (!sock || status !== 'CONNECTED') {
    throw new Error('WhatsApp session is not connected or initialized.');
  }

  const jid = normalizeTargetJid(to);
  await prepareDirectMessageSession(sock, jid);

  const resolvedMimeType = mimetype || getMimeType(mediaUrl, mediaType);
  
  // Resolve media content (base64 data URL, local file path, or external HTTP URL)
  let mediaContent;
  if (mediaUrl.startsWith('data:')) {
    const [header, base64Data] = mediaUrl.split(';base64,');
    mediaContent = Buffer.from(base64Data, 'base64');
  } else if (!mediaUrl.startsWith('http://') && !mediaUrl.startsWith('https://')) {
    // Treat as local file path: read from local file system
    try {
      mediaContent = await fs.readFile(mediaUrl);
      console.log(`[WhatsApp Connection] Loaded local file attachment for user ${userId}: ${mediaUrl}`);
    } catch (err) {
      throw new Error(`Failed to read local file at path "${mediaUrl}". Error: ${err.message}`);
    }
  } else {
    // External HTTP/HTTPS URL
    mediaContent = { url: mediaUrl };
  }

  const messageContent = {};

  if (mediaType === 'image') {
    messageContent.image = mediaContent;
    if (caption) messageContent.caption = caption;
  } else if (mediaType === 'document') {
    messageContent.document = mediaContent;
    messageContent.mimetype = resolvedMimeType;
    messageContent.fileName = fileName || (typeof mediaUrl === 'string' && !mediaUrl.startsWith('data:') ? path.basename(mediaUrl) : 'document');
    if (caption) messageContent.caption = caption;
  } else if (mediaType === 'audio') {
    messageContent.audio = mediaContent;
    messageContent.mimetype = resolvedMimeType;
  } else if (mediaType === 'video') {
    messageContent.video = mediaContent;
    if (caption) messageContent.caption = caption;
  } else {
    throw new Error(`Unsupported mediaType: ${mediaType}`);
  }

  const result = await sock.sendMessage(jid, messageContent, { useUserDevicesCache: false });
  return result;
}

/**
 * Fetches all groups the user is participating in.
 * @param {string} userId 
 */
export async function getGroupsList(userId) {
  const sock = sessions.get(userId);
  const status = sessionStatus.get(userId);

  if (!sock || status !== 'CONNECTED') {
    throw new Error('WhatsApp session is not connected or initialized.');
  }

  const groups = await sock.groupFetchAllParticipating();
  return Object.values(groups).map(group => ({
    id: group.id,
    name: group.subject,
    owner: group.owner || null,
    creation: group.creation || null,
    participantsCount: group.participants?.length || 0
  }));
}

/**
 * Fetches profile info (picture and number) for own account or a specific contact.
 * @param {string} userId 
 * @param {string} [targetJid] - Optional number or JID
 */
export async function getProfileInfo(userId, targetJid) {
  const sock = sessions.get(userId);
  const status = sessionStatus.get(userId);

  if (!sock || status !== 'CONNECTED') {
    throw new Error('WhatsApp session is not connected or initialized.');
  }

  let jid = targetJid ? targetJid.trim() : sock.user.id;
  if (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@g.us')) {
    const cleanNumber = jid.replace(/\D/g, '');
    jid = `${cleanNumber}@s.whatsapp.net`;
  }

  let profilePictureUrl = null;
  try {
    profilePictureUrl = await sock.profilePictureUrl(jid, 'image');
  } catch (err) {
    // Fails if profile picture is restricted or not set
    console.log(`Profile picture not accessible for ${jid}: ${err.message}`);
  }

  return {
    phone: jid.split('@')[0],
    profilePictureUrl
  };
}

/**
 * Scans directories on server start and restores previous sessions in the background.
 */
export async function restoreAllSessions() {
  try {
    await fs.mkdir(sessionsDir, { recursive: true });
    const files = await fs.readdir(sessionsDir);
    
    for (const file of files) {
      if (file.startsWith('session_')) {
        const userId = file.substring('session_'.length);
        console.log(`[Auto-Restore] Restoring background session for userId: ${userId}`);
        
        // Initialize in background
        initSession(userId).catch(err => {
          console.error(`[Auto-Restore Failed] userId: ${userId}, error:`, err);
        });
      }
    }
  } catch (err) {
    console.error('[Auto-Restore] Error reading sessions directory:', err);
  }
}

/**
 * Helper to wait for a session to reach one of the target states.
 * @param {string} userId 
 * @param {string[]} targetStates 
 * @param {number} timeoutMs 
 * @returns {Promise<object>}
 */
export async function waitForSessionState(userId, targetStates, timeoutMs = 8000) {
  const startTime = Date.now();
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      const currentStatus = sessionStatus.get(userId);
      const isTarget = targetStates.includes(currentStatus);
      const isTimeout = (Date.now() - startTime) > timeoutMs;

      if (isTarget || isTimeout) {
        clearInterval(interval);
        resolve(getSessionStatus(userId));
      }
    }, 200);
  });
}
