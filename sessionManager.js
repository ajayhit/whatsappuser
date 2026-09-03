import makeWASocket, { useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import {
  isContactExcluded,
  getContactByMobile,
  getUserById,
  getAutomationSettings,
  saveSessionFile,
  saveSessionFilesBatch,
  deleteSessionFilesSpecific,
  getSessionFiles,
  deleteSessionFiles,
  getAllSessionUserIdsFromDb
} from './db.js';


// Memory stores for active connections and statuses
export const sessions = new Map();
export const sessionStatus = new Map();
export const qrCodes = new Map();
export const pairingCodes = new Map();
const reconnectCount = new Map();
const lastWelcomeSentMap = new Map();
const lastAwaySentMap = new Map();
const dbSyncTimers = new Map();
// Cache of synced files: Map<userId, Map<fileName, { mtimeMs: number, size: number }>>
const sessionFilesSyncedState = new Map();

const sessionsDir = process.env.SESSION_DIR || './sessions';

// Filter out noisy Baileys libsignal Bad MAC decryption logs from clogging stdout/stderr
const originalConsoleError = console.error;
console.error = function (...args) {
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  if (msg.includes('Bad MAC Error') || msg.includes('Failed to decrypt message')) {
    return; // Ignore harmless libsignal session key desync logs
  }
  originalConsoleError.apply(console, args);
};

/**
 * Synchronously checks whether session credential files exist on disk for a user.
 * Returns true  → session files present (session is restoring or previously authenticated).
 * Returns false → no files, user has never scanned a QR code (or files were wiped).
 * @param {string} userId
 * @returns {boolean}
 */
export function hasSessionFiles(userId) {
  const sessionDir = path.join(sessionsDir, `session_${userId}`);
  const credsFile = path.join(sessionDir, 'creds.json');
  return fsSync.existsSync(credsFile) || fsSync.existsSync(sessionDir);
}

/**
 * Downloads session auth credentials from PostgreSQL into the local filesystem if missing.
 * This guarantees sessions survive Render deploys, container restarts, and ephemeral disk wipes.
 */
export async function syncSessionFromDb(userId) {
  const uid = String(userId);
  const sessionDir = path.join(sessionsDir, `session_${uid}`);
  const credsFile = path.join(sessionDir, 'creds.json');

  if (fsSync.existsSync(credsFile)) {
    // If files already exist locally, cache their stats so we don't re-sync unchanged files to DB
    try {
      let userState = sessionFilesSyncedState.get(uid);
      if (!userState) {
        userState = new Map();
        sessionFilesSyncedState.set(uid, userState);
        const diskFiles = await fs.readdir(sessionDir);
        for (const file of diskFiles) {
          try {
            const stat = await fs.stat(path.join(sessionDir, file));
            if (stat.isFile()) {
              userState.set(file, { mtimeMs: stat.mtimeMs, size: stat.size });
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
    return true; // Already cached on disk
  }

  try {
    const dbFiles = await getSessionFiles(uid);
    if (!dbFiles || dbFiles.length === 0) {
      return false;
    }

    await fs.mkdir(sessionDir, { recursive: true });
    const userState = new Map();
    for (const f of dbFiles) {
      const filePath = path.join(sessionDir, f.file_name);
      await fs.writeFile(filePath, f.file_data, 'utf-8');
      try {
        const stat = await fs.stat(filePath);
        userState.set(f.file_name, { mtimeMs: stat.mtimeMs, size: stat.size });
      } catch (e) {}
    }
    sessionFilesSyncedState.set(uid, userState);
    console.log(`[Session DB Sync] Restored ${dbFiles.length} auth file(s) for user ${uid} from PostgreSQL.`);
    return true;
  } catch (err) {
    console.error(`[Session DB Sync Error] Failed restoring session ${uid} from DB:`, err.message);
    return false;
  }
}

/**
 * Safely cleans up obsolete pre-keys (keeping the most recent 150 pre-keys)
 * to prevent disk and database explosion over time.
 */
async function pruneObsoletePreKeys(sessionDir, userId, files) {
  try {
    const credsPath = path.join(sessionDir, 'creds.json');
    if (!files.includes('creds.json')) return [];

    let nextPreKeyId = null;
    try {
      const credsRaw = await fs.readFile(credsPath, 'utf-8');
      const creds = JSON.parse(credsRaw);
      nextPreKeyId = creds.nextPreKeyId || creds.firstUnuploadedPreKeyId;
    } catch (e) {
      return [];
    }

    if (!nextPreKeyId || typeof nextPreKeyId !== 'number' || nextPreKeyId <= 150) {
      return [];
    }

    const cutoffId = nextPreKeyId - 150;
    const deletedFiles = [];

    for (const file of files) {
      const match = file.match(/^pre-key-(\d+)\.json$/);
      if (match) {
        const keyId = parseInt(match[1], 10);
        if (keyId < cutoffId) {
          try {
            await fs.unlink(path.join(sessionDir, file));
            deletedFiles.push(file);
          } catch (e) {}
        }
      }
    }

    if (deletedFiles.length > 0) {
      await deleteSessionFilesSpecific(userId, deletedFiles);
      const userState = sessionFilesSyncedState.get(String(userId));
      if (userState) {
        for (const df of deletedFiles) {
          userState.delete(df);
        }
      }
      console.log(`[Session Cleanup] Pruned ${deletedFiles.length} obsolete pre-key file(s) for user ${userId} (< id ${cutoffId}).`);
    }
    return deletedFiles;
  } catch (err) {
    console.error(`[Session Cleanup Error] User ${userId}:`, err.message);
    return [];
  }
}

/**
 * Debounced differential sync of local session files up to PostgreSQL.
 * Batches file updates to prevent keeping Neon PostgreSQL awake 24/7.
 * @param {string|number} userId
 * @param {number} delayMs - Debounce time (default: 60,000ms / 1 min for background creds, 1,000ms for connection events)
 */
export function queueSessionDbSync(userId, delayMs = 60000) {
  const uid = String(userId);
  if (dbSyncTimers.has(uid)) {
    clearTimeout(dbSyncTimers.get(uid));
  }

  const timer = setTimeout(async () => {
    dbSyncTimers.delete(uid);
    const sessionDir = path.join(sessionsDir, `session_${uid}`);
    if (!fsSync.existsSync(sessionDir)) return;

    try {
      let userState = sessionFilesSyncedState.get(uid);
      if (!userState) {
        userState = new Map();
        sessionFilesSyncedState.set(uid, userState);
      }

      let files = await fs.readdir(sessionDir);

      // Prune old prekeys if there are too many
      if (files.length > 180) {
        const deleted = await pruneObsoletePreKeys(sessionDir, uid, files);
        if (deleted && deleted.length > 0) {
          const deletedSet = new Set(deleted);
          files = files.filter(f => !deletedSet.has(f));
        }
      }

      const modifiedFiles = [];

      for (const file of files) {
        const filePath = path.join(sessionDir, file);
        try {
          const stat = await fs.stat(filePath);
          if (stat.isFile()) {
            const lastState = userState.get(file);
            // Only sync if file is new, modified, or changed in size
            if (!lastState || stat.mtimeMs > lastState.mtimeMs || stat.size !== lastState.size) {
              const content = await fs.readFile(filePath, 'utf-8');
              modifiedFiles.push({ fileName: file, fileData: content, mtimeMs: stat.mtimeMs, size: stat.size });
            }
          }
        } catch (fileErr) {}
      }

      if (modifiedFiles.length > 0) {
        await saveSessionFilesBatch(uid, modifiedFiles);
        for (const item of modifiedFiles) {
          userState.set(item.fileName, { mtimeMs: item.mtimeMs, size: item.size });
        }
        const skipped = files.length - modifiedFiles.length;
        console.log(`[Session DB Sync] Synced ${modifiedFiles.length} modified auth file(s) for user ${uid} to PostgreSQL (${skipped} unchanged skipped).`);
      }
    } catch (err) {
      console.error(`[Session DB Sync Error] Failed saving session ${uid} to DB:`, err.message);
    }
  }, delayMs);

  dbSyncTimers.set(uid, timer);
}

function normalizeTargetJid(to) {
  let jid = to.trim();
  if (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@g.us') && !jid.endsWith('@lid')) {
    let cleanNumber = jid.replace(/\D/g, '');
    if (cleanNumber.length === 10) {
      cleanNumber = '91' + cleanNumber;
    }
    jid = `${cleanNumber}@s.whatsapp.net`;
  }
  return jid;
}

async function prepareDirectMessageSession(sock, jid) {
  if (jid.endsWith('@g.us')) return;

  try {
    const lookup = await sock.onWhatsApp(jid);
    const matched = lookup?.find(item => item.exists);
    if (!matched) {
      console.log(`[Warning] Recipient ${jid.split('@')[0]} not verified by onWhatsApp lookup. Proceeding to send anyway.`);
    }
  } catch (err) {
    console.log(`[Warning] onWhatsApp check failed for ${jid.split('@')[0]}: ${err.message}. Proceeding to send anyway.`);
  }

  try {
    await sock.presenceSubscribe(jid);
  } catch (e) {}

  try {
    await sock.assertSessions([jid], true);
  } catch (e) {
    console.log(`[Warning] assertSessions failed for ${jid.split('@')[0]}: ${e.message}`);
  }
}

let cachedBaileysVersion = [2, 3000, 1017539728];
let versionLastFetchedAt = 0;

async function getCachedBaileysVersion() {
  if (Date.now() - versionLastFetchedAt < 3600000 && versionLastFetchedAt !== 0) {
    return cachedBaileysVersion;
  }
  try {
    const fetched = await fetchLatestBaileysVersion();
    if (fetched?.version) {
      cachedBaileysVersion = fetched.version;
      versionLastFetchedAt = Date.now();
    }
  } catch (err) {
    console.log(`[WhatsApp Version Warning] Failed to fetch latest web version, using fallback: ${err.message}`);
  }
  return cachedBaileysVersion;
}

// Cleanup socket resources and event listeners to prevent memory leaks
export function cleanupSocket(userId) {
  const sock = sessions.get(userId);
  if (sock) {
    try { sock.ev.removeAllListeners(); } catch (e) {}
    try { sock.ws?.close(); } catch (e) {}
    try { sock.end(); } catch (e) {}
    sessions.delete(userId);
  }
}

// Periodic memory cleanup for rate limit maps and stale QR codes (every 30 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, time] of lastWelcomeSentMap.entries()) {
    if (now - time > 86400000) lastWelcomeSentMap.delete(key);
  }
  for (const [key, time] of lastAwaySentMap.entries()) {
    if (now - time > 3600000) lastAwaySentMap.delete(key);
  }
  for (const [userId] of qrCodes.entries()) {
    if (sessionStatus.get(userId) !== 'QR') qrCodes.delete(userId);
  }
}, 30 * 60 * 1000);

/**
 * Initializes a new WhatsApp Web session or returns the state of an existing one.
 * @param {string} userId - Unique identifier for the user
 * @returns {Promise<{status: string, qr?: string}>}
 */
export async function initSession(userId) {
  // Check if active session socket already exists
  if (sessions.has(userId)) {
    const status = sessionStatus.get(userId) || 'CONNECTING';
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

  // Sync existing session credentials from PostgreSQL if Render container was redeployed
  await syncSessionFromDb(userId);

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const version = await getCachedBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }), // Suppress Baileys verbose logs
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'), // Standard tested browser profile compatible with mobile pairing code & QR
    syncFullHistory: false, // CRITICAL: Disable full chat history sync to drastically reduce RAM usage
    markOnlineOnConnect: false, // Save CPU and keepalive bandwidth
    generateHighQualityLinkPreview: false,
    fireInitQueries: false, // Prevents loading all chat/contact records into memory on connect
    emitOwnEvents: false, // Reduces event loop object allocations
    cachedGroupMetadata: async () => undefined, // Prevents buffering large group metadata in memory
    appStateMacVerification: { patch: false, snapshot: false }, // Avoids storing crypto patch verification buffers
    shouldIgnoreJid: (jid) => !jid || jid.endsWith('@broadcast') || jid.includes('newsletter') || jid.endsWith('@call'),
    getMessage: async () => undefined, // Prevent buffering messages in Node memory
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 60000, // Increased from 30s to 60s to reduce constant I/O
  });

  sessions.set(userId, sock);

  sock.ev.on('creds.update', async () => {
    await saveCreds();
    // Batch background credential changes to once every 60s to avoid waking PostgreSQL continuously
    queueSessionDbSync(userId, 60000);
  });

  sock.ev.on('messages.upsert', async (m) => {
    if (m.type !== 'notify') return;
    for (const msg of m.messages) {
      try {
        console.log(`[Message Received] from: ${msg.key.remoteJid}, isFromMe: ${msg.key.fromMe}`);
        await handleIncomingAutoResponse(userId, sock, msg);
      } catch (err) {
        console.error(`[AutoResponse Error] Failed for user ${userId}:`, err);
      }
    }
  });


  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Handle QR Code emission
    if (qr) {
      // Do not overwrite PAIRING_CODE status if user is waiting for mobile pairing
      if (sessionStatus.get(userId) !== 'PAIRING_CODE' && !pairingCodes.has(userId)) {
        sessionStatus.set(userId, 'QR');
      }
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
      pairingCodes.delete(userId);
      reconnectCount.delete(userId);
      // Sync immediately on connection open
      queueSessionDbSync(userId, 1000);
      console.log(`[Session Connected] userId: ${userId}, phone: ${sock.user.id.split(':')[0]}`);
    }

    // Handle connection closures
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const isRestartRequired = statusCode === 515 || statusCode === DisconnectReason.restartRequired;
      
      // 440 means connection replaced by another client (e.g. user opened web.whatsapp.com elsewhere)
      if (statusCode === 440 || statusCode === DisconnectReason.connectionReplaced) {
        console.log(`[Session Replaced] Another WhatsApp Web session opened elsewhere for userId: ${userId}. Halting socket to prevent collision loop.`);
        sessionStatus.set(userId, 'DISCONNECTED');
        cleanupSocket(userId);
        pairingCodes.delete(userId);
        return;
      }

      // 405 means Method Not Allowed / Rejected connection (frequently due to corrupted credentials or ban check)
      // 401 means Logged Out
      // 403 means Forbidden
      const isCriticalError = [401, 403, 405].includes(statusCode);
      const shouldReconnect = !isCriticalError && statusCode !== DisconnectReason.loggedOut;

      console.log(`[Session Closed] userId: ${userId}, statusCode: ${statusCode}, shouldReconnect: ${shouldReconnect}, isRestart: ${isRestartRequired}`);

      if (shouldReconnect) {
        const retries = reconnectCount.get(userId) || 0;
        if (retries < 8) {
          reconnectCount.set(userId, retries + 1);
          const delayMs = isRestartRequired ? 600 : 2500;
          console.log(`[Reconnecting] userId: ${userId}, attempt: ${retries + 1}, delay: ${delayMs}ms...`);
          
          setTimeout(() => {
            cleanupSocket(userId);
            initSession(userId).catch(err => {
              console.error(`Reconnection initialization failed for ${userId}:`, err);
            });
          }, delayMs);
        } else {
          console.log(`[Max Reconnects Reached] userId: ${userId}`);
          sessionStatus.set(userId, 'DISCONNECTED');
          cleanupSocket(userId);
          pairingCodes.delete(userId);
        }
      } else {
        // Manual or forced logout, or a critical error (like 405 / corrupted credentials)
        console.log(`[Session Terminated] Cleaning up credentials for userId: ${userId} due to statusCode: ${statusCode}`);
        sessionStatus.set(userId, 'DISCONNECTED');
        cleanupSocket(userId);
        qrCodes.delete(userId);
        pairingCodes.delete(userId);
        try {
          await fs.rm(sessionDir, { recursive: true, force: true });
        } catch (e) {
          console.error(`Error deleting auth directory for ${userId}:`, e);
        }
        sessionFilesSyncedState.delete(String(userId));
        // Also wipe DB session so syncSessionFromDb doesn't restore stale creds on next connect
        try {
          await deleteSessionFiles(userId);
          console.log(`[Session Terminated] Deleted stale DB session files for userId: ${userId}`);
        } catch (e) {
          console.error(`Error deleting DB session files for ${userId}:`, e);
        }
      }
    }
  });

  return { status: 'CONNECTING' };
}

export function formatPairingCode(code) {
  if (!code) return '';
  const clean = String(code).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (clean.length === 8) {
    return `${clean.slice(0, 4)}-${clean.slice(4)}`;
  }
  return clean;
}

/**
 * Retrieves the current status details of a WhatsApp session.
 * @param {string} userId 
 * @returns {{status: string, qr?: string, pairingCode?: string, formattedCode?: string, user?: {id: string, name: string, phone: string}}}
 */
export function getSessionStatus(userId) {
  const status = sessionStatus.get(userId);
  const activePairingCode = pairingCodes.get(userId);

  // If the socket isn't in the map yet (initSession still running its awaits),
  // still report the real status (CONNECTING / QR / PAIRING_CODE) so the frontend keeps polling.
  if (!sessions.has(userId)) {
    if (status && status !== 'DISCONNECTED') {
      return {
        status,
        qr: status === 'QR' ? qrCodes.get(userId) : undefined,
        pairingCode: activePairingCode || undefined,
        formattedCode: activePairingCode ? formatPairingCode(activePairingCode) : undefined
      };
    }
    return { status: 'DISCONNECTED' };
  }

  const sock = sessions.get(userId);
  const details = (status === 'CONNECTED' && sock?.user) ? {
    id: sock.user.id,
    name: sock.user.name || 'WhatsApp User',
    phone: sock.user.id.split(':')[0]
  } : null;

  return {
    status: status || 'DISCONNECTED',
    qr: status === 'QR' ? qrCodes.get(userId) : undefined,
    pairingCode: activePairingCode || undefined,
    formattedCode: activePairingCode ? formatPairingCode(activePairingCode) : undefined,
    user: details
  };
}

/**
 * Request an 8-character pairing code for linking with a mobile phone number.
 * @param {string} userId
 * @param {string} phoneNumber
 */
export async function requestPairingCode(userId, phoneNumber) {
  const uid = String(userId);
  let cleanPhone = String(phoneNumber || '').replace(/\D/g, '');
  // Strip leading zeros common in local phone number typing
  cleanPhone = cleanPhone.replace(/^0+/, '');
  if (!cleanPhone) {
    throw new Error('Valid mobile phone number is required to generate a pairing code.');
  }
  if (cleanPhone.length === 10) {
    cleanPhone = '91' + cleanPhone; // Auto prepend 91 for 10-digit Indian numbers
  }
  if (cleanPhone.length < 10 || cleanPhone.length > 15) {
    throw new Error('Invalid mobile phone number length. Must be 10-15 digits with country code.');
  }

  // If already connected, return connected status
  if (sessions.has(uid) && sessionStatus.get(uid) === 'CONNECTED') {
    return getSessionStatus(uid);
  }

  // Ensure socket session is initialized
  if (!sessions.has(uid) || sessionStatus.get(uid) === 'DISCONNECTED') {
    initSession(uid).catch(err => console.error(`[PairingCode Init Async] user ${uid}:`, err));
  }

  // Wait for socket instance to be initialized
  for (let i = 0; i < 60; i++) {
    if (sessions.has(uid)) break;
    await new Promise(r => setTimeout(r, 100));
  }

  const sock = sessions.get(uid);
  if (!sock) {
    throw new Error('Unable to initialize WhatsApp connection. Please try again.');
  }

  // Give socket event loop a brief moment to stabilize connection
  await new Promise(r => setTimeout(r, 800));

  if (sock.authState?.creds?.registered) {
    return getSessionStatus(uid);
  }

  try {
    const rawCode = await sock.requestPairingCode(cleanPhone);
    pairingCodes.set(uid, rawCode);
    sessionStatus.set(uid, 'PAIRING_CODE');
    const formatted = formatPairingCode(rawCode);
    console.log(`[Pairing Code] Generated code for user ${uid} (${cleanPhone}): ${formatted}`);
    return {
      status: 'PAIRING_CODE',
      pairingCode: rawCode,
      formattedCode: formatted,
      phoneNumber: cleanPhone
    };
  } catch (err) {
    console.error(`[Pairing Code Error] Failed for user ${uid}:`, err.message);
    throw new Error(`Failed to generate WhatsApp pairing code: ${err.message}`);
  }
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
  pairingCodes.delete(userId);
  sessionFilesSyncedState.delete(String(userId));

  if (sock && status === 'CONNECTED') {
    try {
      // Calling logout will trigger connection closure with statusCode: 401
      // The event listener in connection.update will automatically clean up the files and sessions map
      await sock.logout();
    } catch (err) {
      console.error(`Error logging out session ${userId} from WhatsApp:`, err.message);
    }
  }

  cleanupSocket(userId);

  try {
    await fs.rm(sessionDir, { recursive: true, force: true });
  } catch (err) {
    console.error(`Failed to delete session state folder for ${userId}:`, err.message);
  }

  try {
    await deleteSessionFiles(userId);
    console.log(`[Session DB Sync] Deleted PostgreSQL session auth records for user ${userId}`);
  } catch (dbErr) {
    console.error(`Failed to delete DB session state for ${userId}:`, dbErr.message);
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
 * Helper: extracts text content from Baileys message
 */
function getMessageText(message) {
  if (!message) return '';
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  if (message.ephemeralMessage?.message) return getMessageText(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message) return getMessageText(message.viewOnceMessage.message);
  return '';
}

/**
 * Helper: checks if current time falls within start and end time (supports overnight HH:MM)
 */
function isTimeInSchedule(startTimeStr, endTimeStr) {
  if (!startTimeStr || !endTimeStr) return true;
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [sH, sM] = startTimeStr.split(':').map(Number);
  const [eH, eM] = endTimeStr.split(':').map(Number);
  const startMinutes = sH * 60 + sM;
  const endMinutes = eH * 60 + eM;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  } else {
    // Overnight schedule (e.g. 19:00 to 09:00)
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }
}

/**
 * Helper: replaces placeholders {Name}, {ShopName}, {Mobile}, {Email}
 */
async function resolveAutoPlaceholders(text, userId, fromPhone) {
  if (!text) return '';
  const contact = await getContactByMobile(userId, fromPhone);
  const user = await getUserById(userId);

  const nameVal = contact?.name || 'Customer';
  const shopVal = contact?.shop_name || 'Store';
  const mobileVal = contact?.mobile || fromPhone;
  const emailVal = contact?.email || user?.email || '';

  let res = text;
  res = res.replace(/\{name\}/gi, nameVal).replace(/\[name\]/gi, nameVal);
  res = res.replace(/\{shopname\}/gi, shopVal).replace(/\[shopname\]/gi, shopVal);
  res = res.replace(/\{shop\}/gi, shopVal).replace(/\[shop\]/gi, shopVal);
  res = res.replace(/\{mobile\}/gi, mobileVal).replace(/\[mobile\]/gi, mobileVal);
  res = res.replace(/\{email\}/gi, emailVal).replace(/\[email\]/gi, emailVal);
  return res;
}

/**
 * Processes incoming WhatsApp messages for Welcome & Away auto-responses
 */
async function handleIncomingAutoResponse(userId, sock, msg) {
  if (!userId || isNaN(Number(userId))) {
    return;
  }
  const fromJid = msg.key.remoteJid;
  if (!fromJid || fromJid.endsWith('@g.us') || fromJid === 'status@broadcast' || msg.key.fromMe) {
    return;
  }

  const fromPhone = fromJid.split('@')[0];

  // 1. Check if contact is excluded/blocked
  if (await isContactExcluded(userId, fromPhone)) {
    return;
  }

  // 2. We don't block entirely here, we check rate limits specifically per feature.
  const rateLimitKey = `${userId}_${fromPhone}`;

  // 3. Fetch automation settings
  const settings = await getAutomationSettings(userId);
  let repliedWelcome = false;

  // 4. Welcome Message check (Once per 24 hours per user)
  if (settings.welcome_active === 1 && settings.welcome_text) {
    const lastWelcomeTime = lastWelcomeSentMap.get(rateLimitKey) || 0;
    // 24 hours cooldown (86400000 ms)
    if (Date.now() - lastWelcomeTime >= 86400000) {
      const welcomeMsg = await resolveAutoPlaceholders(settings.welcome_text, userId, fromPhone);
      console.log(`[AutoResponse Welcome] User ${userId} sending Welcome Message to ${fromPhone}`);
      
      lastWelcomeSentMap.set(rateLimitKey, Date.now());

      if (settings.welcome_media_path && settings.welcome_media_type) {
        await sendMediaToJid(userId, fromJid, settings.welcome_media_path, settings.welcome_media_type, welcomeMsg);
      } else {
        await sendMessageToJid(userId, fromJid, welcomeMsg);
      }
      repliedWelcome = true;
    }
  }

  // 5. Away Message check (60-second rate limit to prevent spam loops)
  if (settings.away_active === 1 && settings.away_text) {
    // If it's a schedule, the away time is when it's NOT in the schedule (NOT in business hours)
    const isAwayTime = settings.away_schedule_type === 'schedule'
      ? !isTimeInSchedule(settings.away_start_time, settings.away_end_time)
      : true;

    if (isAwayTime) {
      const lastAwayTime = lastAwaySentMap.get(rateLimitKey) || 0;
      // 60 seconds cooldown for away messages
      if (Date.now() - lastAwayTime >= 60000) {
        const awayMsg = await resolveAutoPlaceholders(settings.away_text, userId, fromPhone);
        console.log(`[AutoResponse Away] User ${userId} sending Away Message to ${fromPhone}`);
        
        lastAwaySentMap.set(rateLimitKey, Date.now());
        await sendMessageToJid(userId, fromJid, awayMsg);
      }
    }
  }
}


/**
 * Scans directories on server start and restores previous sessions in throttled batches.
 * Batches session initialization to prevent OOM / CPU thrashing when handling 200+ users.
 */
export async function restoreAllSessions() {
  try {
    await fs.mkdir(sessionsDir, { recursive: true });
    
    // 1. Get session IDs from local disk
    const diskFiles = await fs.readdir(sessionsDir);
    const diskUserIds = diskFiles
      .filter(file => file.startsWith('session_'))
      .map(file => file.substring('session_'.length));

    // 2. Get session IDs from PostgreSQL (preserves sessions across Render container redeploys)
    let dbUserIds = [];
    try {
      dbUserIds = await getAllSessionUserIdsFromDb();
    } catch (dbErr) {
      console.error('[Auto-Restore] Failed fetching session user IDs from DB:', dbErr.message);
    }

    const allUserIds = Array.from(new Set([...diskUserIds, ...dbUserIds]));

    if (allUserIds.length === 0) return;

    console.log(`[Auto-Restore] Found ${allUserIds.length} session(s) to restore (${dbUserIds.length} in DB, ${diskUserIds.length} on disk). Starting throttled restore queue...`);
    
    // Restore in small batches of 3 with 1.5s delay to keep RAM and network usage smooth
    const BATCH_SIZE = 3;
    for (let i = 0; i < allUserIds.length; i += BATCH_SIZE) {
      const batch = allUserIds.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (userId) => {
        try {
          console.log(`[Auto-Restore] Restoring background session for userId: ${userId}`);
          await initSession(userId);
        } catch (err) {
          console.error(`[Auto-Restore Failed] userId: ${userId}, error:`, err.message);
        }
      }));
      if (i + BATCH_SIZE < allUserIds.length) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    console.log(`[Auto-Restore] Completed background session restoration for all ${allUserIds.length} sessions.`);
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
  // Check immediately — already in target state?
  const current = sessionStatus.get(userId);
  if (targetStates.includes(current)) {
    return getSessionStatus(userId);
  }

  // Event-driven: subscribe to connection.update on the socket (zero CPU while waiting)
  return new Promise((resolve) => {
    let timer;
    const sock = sessions.get(userId);

    const cleanup = () => {
      clearTimeout(timer);
      if (sock) sock.ev.off('connection.update', onUpdate);
    };

    const onUpdate = () => {
      const status = sessionStatus.get(userId);
      if (targetStates.includes(status)) {
        cleanup();
        resolve(getSessionStatus(userId));
      }
    };

    // Fallback timeout
    timer = setTimeout(() => {
      cleanup();
      resolve(getSessionStatus(userId));
    }, timeoutMs);

    if (sock) {
      sock.ev.on('connection.update', onUpdate);
    } else {
      // No socket yet, fall back to a single delayed check
      clearTimeout(timer);
      timer = setTimeout(() => resolve(getSessionStatus(userId)), timeoutMs);
    }
  });
}

