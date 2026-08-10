import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRouter from './apiRouter.js';
import authRouter from './authRouter.js';
import adminRouter from './adminRouter.js';
import crmRouter from './crmRouter.js';
import { restoreAllSessions, getSessionStatus, sendMessageToJid, sendMediaToJid } from './sessionManager.js';
import {
  initDb, getDb, getUserByEmail, createUser, getUserById,
  getCatalogByUserId, getServicesByCatalogId,
  getPendingReminders, updateReminderStatus, isContactExcluded, getActivePlan, calculateNextScheduleDate,
  getPendingCampaigns, getPendingRecipients, updateCampaignStatus, updateCampaignRecipientStatus,
  incrementCampaignSuccess, incrementCampaignFailure, getCampaignById,
  getContactsByUser,
  getDueBirthdayWishes, markBirthdayWishSent, markBirthdayWishFailed,
  updatePaymentReminderStatus,
  getAllUsers, getPlansByUser, canSendExpiryNotification, logExpiryNotification
} from './db.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize SQLite database
initDb();

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

// Mount the CRM API endpoints at /api/crm
app.use('/api/crm', crmRouter);

// Public Digital Catalog View
app.get('/catalog/view/:userId', (req, res) => {
  const userId = parseInt(req.params.userId);
  try {
    const catalog = getCatalogByUserId(userId);
    if (!catalog) {
      return res.status(404).send(`
        <html>
          <body style="background:#0f172a; color:#f8fafc; font-family:sans-serif; text-align:center; padding-top:5rem;">
            <h2>Catalog not found or not set up yet.</h2>
          </body>
        </html>
      `);
    }

    const services = getServicesByCatalogId(catalog.id);

    const logoHtml = catalog.logo_path 
      ? `<img class="logo" src="/${catalog.logo_path}" alt="${catalog.brand_name}">`
      : `<div class="logo" style="display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.05);color:#a5b4fc;font-size:2.5rem;font-weight:800;">${catalog.brand_name.charAt(0).toUpperCase()}</div>`;

    const audioHtml = catalog.catalog_audio_path
      ? `<audio class="catalog-audio" controls src="/${catalog.catalog_audio_path}"></audio>`
      : '';

    const servicesHtml = services.length > 0 
      ? services.map(s => {
          const serviceImg = s.image_path
            ? `<img class="card-img" src="/${s.image_path}" alt="${s.name}">`
            : `<div class="card-img" style="display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.02);color:#94a3b8;font-size:1.5rem;font-weight:600;">Service</div>`;

          const serviceAudio = s.audio_path
            ? `<audio class="card-audio" controls src="/${s.audio_path}"></audio>`
            : '';

          return `
            <div class="card">
              ${serviceImg}
              <div class="card-content">
                <div class="card-info">
                  <h3 class="card-title">${s.name}</h3>
                  <p class="card-desc">${s.description || ''}</p>
                </div>
                <div style="margin-top:0.75rem;">
                  <div class="card-price">₹${s.price}</div>
                  ${serviceAudio}
                </div>
              </div>
            </div>
          `;
        }).join('')
      : '<div style="grid-column:1/-1;text-align:center;color:#94a3b8;padding:2rem;">No services listed yet.</div>';

    return res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${catalog.brand_name} - Digital Catalog</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
        <style>
          :root {
            --bg: #0f172a;
            --card-bg: rgba(30, 41, 59, 0.4);
            --border: rgba(99, 102, 241, 0.15);
            --accent: #6366f1;
            --text: #f8fafc;
            --text-muted: #94a3b8;
          }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            background: var(--bg);
            color: var(--text);
            font-family: 'Outfit', sans-serif;
            min-height: 100vh;
            padding: 2rem 1rem;
            display: flex;
            flex-direction: column;
            align-items: center;
          }
          .container {
            max-width: 800px;
            width: 100%;
            display: flex;
            flex-direction: column;
            gap: 2rem;
          }
          .header {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 20px;
            padding: 2rem;
            backdrop-filter: blur(10px);
            text-align: center;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 1rem;
          }
          .logo {
            width: 100px;
            height: 100px;
            border-radius: 50%;
            object-fit: cover;
            border: 2px solid var(--accent);
          }
          .title { font-size: 2rem; font-weight: 800; color: #a5b4fc; }
          .desc { color: var(--text-muted); font-size: 1rem; max-width: 500px; line-height: 1.6; }
          .catalog-audio { margin-top: 1rem; width: 100%; max-width: 350px; }
          .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 1.5rem;
          }
          .card {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 16px;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            backdrop-filter: blur(10px);
          }
          .card-img {
            width: 100%;
            height: 180px;
            object-fit: cover;
            border-bottom: 1px solid var(--border);
          }
          .card-content {
            padding: 1.25rem;
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
            flex: 1;
            justify-content: space-between;
          }
          .card-info { display: flex; flex-direction: column; gap: 0.25rem; }
          .card-title { font-size: 1.2rem; font-weight: 600; }
          .card-desc { font-size: 0.85rem; color: var(--text-muted); line-height: 1.4; }
          .card-price { font-size: 1.3rem; font-weight: 800; color: #60a5fa; }
          .card-audio { width: 100%; margin-top: 0.5rem; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            ${logoHtml}
            <h1 class="title">${catalog.brand_name}</h1>
            <p class="desc">${catalog.description || ''}</p>
            ${audioHtml}
          </div>
          
          <h2 style="font-size: 1.5rem; font-weight: 600; border-bottom: 2px solid var(--border); padding-bottom: 0.5rem; margin-top: 1rem;">Our Services</h2>
          
          <div class="grid">
            ${servicesHtml}
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    return res.status(500).send('Error rendering catalog');
  }
});

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

  // Start Background Reminders Poller
  startRemindersPoller();
  
  // Start Background Campaigns Poller
  startCampaignsPoller();

  // Start Background Follow-up Automation Poller
  startFollowUpPoller();

  // Start Background Birthday Wishes Poller
  startBirthdayPoller();

  // Start Background Payment Reminders Poller
  startPaymentReminderPoller();

  // Start Background Plan Expiry Poller
  startPlanExpiryPoller();
});

// Background reminders polling handler
function startRemindersPoller() {
  setInterval(async () => {
    try {
      const pending = getPendingReminders();
      if (pending.length === 0) return;

      console.log(`[Reminders Poller] Found ${pending.length} pending reminders to process.`);

      for (const rem of pending) {
        try {
          // 1. Check user subscription status
          const plan = getActivePlan(rem.user_id);
          if (!plan || new Date(plan.expires_at) < new Date()) {
            throw new Error('User subscription is inactive or expired');
          }

          // 2. Check if recipient contact is blocked
          const isExcluded = isContactExcluded(rem.user_id, rem.recipient_mobile);
          if (isExcluded) {
            throw new Error('Recipient contact is excluded/blocked');
          }

          // 3. Check WhatsApp session status
          const session = getSessionStatus(String(rem.user_id));
          if (session.status !== 'CONNECTED') {
            throw new Error('WhatsApp session is disconnected');
          }

          // 4. Resolve placeholders — supports both {Name} and [Name] style
          let text = rem.message_template;
          const user = getUserById(rem.user_id);
          const emailVal = user?.email || '';
          text = text.replace(/\{name\}/gi, rem.recipient_name || '');
          text = text.replace(/\[name\]/gi, rem.recipient_name || '');
          text = text.replace(/\{shopname\}/gi, rem.shop_name || '');
          text = text.replace(/\[shopname\]/gi, rem.shop_name || '');
          text = text.replace(/\{shop\}/gi, rem.shop_name || '');
          text = text.replace(/\[shop\]/gi, rem.shop_name || '');
          text = text.replace(/\{mobile\}/gi, rem.recipient_mobile || '');
          text = text.replace(/\[mobile\]/gi, rem.recipient_mobile || '');
          text = text.replace(/\{email\}/gi, emailVal);
          text = text.replace(/\[email\]/gi, emailVal);

          // 5. Send message
          await sendMessageToJid(String(rem.user_id), rem.recipient_mobile, text);

          // 6. Update status or reschedule if recurring
          if (rem.repeat_option === 'weekly' && rem.selected_days) {
            const nextScheduledAt = calculateNextScheduleDate(rem.selected_days, rem.send_time || '09:00');
            getDb().prepare(`
              UPDATE reminders
              SET scheduled_at = ?, sent_at = datetime('now'), status = 'pending', error_message = NULL
              WHERE id = ?
            `).run(nextScheduledAt, rem.id);
            console.log(`[Reminders Poller] Sent recurring reminder #${rem.id} to ${rem.recipient_mobile}. Rescheduled for ${nextScheduledAt}`);
          } else {
            updateReminderStatus(rem.id, 'sent');
            console.log(`[Reminders Poller] Successfully sent reminder #${rem.id} to ${rem.recipient_mobile}`);
          }
        } catch (err) {
          console.error(`[Reminders Poller Failed] Reminder #${rem.id} failed: ${err.message}`);
          updateReminderStatus(rem.id, 'failed', err.message);
        }
      }
    } catch (e) {
      console.error('[Reminders Poller Error]', e);
    }
  }, 60000); // Poll every minute
}

// Background campaigns polling handler
function startCampaignsPoller() {
  setInterval(async () => {
    try {
      const campaigns = getPendingCampaigns();
      if (campaigns.length === 0) return;

      for (const campaign of campaigns) {
        // If it was pending and it's time to run, mark it as running
        if (campaign.status === 'pending') {
          updateCampaignStatus(campaign.id, 'running');
        }

        // Double check status in case user paused it
        const currentCampaign = getCampaignById(campaign.id);
        if (currentCampaign.status !== 'running') continue;

        // Fetch up to 50 pending recipients per cycle to prevent blocking
        const recipients = getPendingRecipients(campaign.id, 50);
        
        if (recipients.length === 0) {
          // No more recipients = completed!
          updateCampaignStatus(campaign.id, 'completed');
          console.log(`[Campaigns Poller] Campaign #${campaign.id} completed!`);
          continue;
        }

        for (const rec of recipients) {
          // Re-check status inside loop to allow rapid pausing
          const reCheck = getCampaignById(campaign.id);
          if (reCheck.status !== 'running') {
            break;
          }

          try {
            // 1. Check user subscription status
            const plan = getActivePlan(campaign.user_id);
            if (!plan || new Date(plan.expires_at) < new Date()) {
              throw new Error('User subscription is inactive or expired');
            }

            // 2. Check if recipient contact is blocked
            const isExcluded = isContactExcluded(campaign.user_id, rec.mobile);
            if (isExcluded) {
              throw new Error('Recipient contact is excluded/blocked');
            }

            // 3. Check WhatsApp session status
            const session = getSessionStatus(String(campaign.user_id));
            if (session.status !== 'CONNECTED') {
              throw new Error('WhatsApp session is disconnected');
            }

            // 4. Resolve placeholders
            let text = campaign.message_text;
            const user = getUserById(campaign.user_id);
            const emailVal = user?.email || '';
            text = text.replace(/\{name\}/gi, rec.name || '');
            text = text.replace(/\[name\}/gi, rec.name || '');
            text = text.replace(/\{shopname\}/gi, rec.shop_name || '');
            text = text.replace(/\[shopname\]/gi, rec.shop_name || '');
            text = text.replace(/\{mobile\}/gi, rec.mobile || '');
            text = text.replace(/\[mobile\]/gi, rec.mobile || '');
            text = text.replace(/\{email\}/gi, emailVal);
            text = text.replace(/\[email\]/gi, emailVal);

            // 5. Send message
            if (campaign.media_path && campaign.media_type) {
              await sendMediaToJid(String(campaign.user_id), rec.mobile, campaign.media_path, campaign.media_type, text);
            } else {
              await sendMessageToJid(String(campaign.user_id), rec.mobile, text);
            }

            // 6. Update status
            updateCampaignRecipientStatus(rec.id, 'sent');
            incrementCampaignSuccess(campaign.id);
            console.log(`[Campaigns Poller] Sent campaign #${campaign.id} message to ${rec.mobile}`);
          } catch (err) {
            console.error(`[Campaigns Poller Failed] Campaign #${campaign.id} recipient #${rec.id} failed: ${err.message}`);
            updateCampaignRecipientStatus(rec.id, 'failed', err.message);
            incrementCampaignFailure(campaign.id);
          }

          // Small delay between sends to prevent rate-limiting by Baileys/WhatsApp
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    } catch (e) {
      console.error('[Campaigns Poller Error]', e);
    }
  }, 10000); // Poll every 10 seconds for campaigns for faster execution
}

// ─── Follow-up Automation Poller ─────────────────────────────────────────────
function startFollowUpPoller() {
  setInterval(async () => {
    try {
      const dbConn = getDb();

      // Fetch all active automations grouped by user
      const automations = dbConn.prepare(`
        SELECT fa.*, u.id AS owner_id
        FROM followup_automations fa
        JOIN users u ON u.id = fa.user_id
        WHERE fa.active = 1
      `).all();

      if (!automations || automations.length === 0) return;

      // Group by user
      const byUser = {};
      for (const auto of automations) {
        if (!byUser[auto.user_id]) byUser[auto.user_id] = [];
        byUser[auto.user_id].push(auto);
      }

      for (const [userId, rules] of Object.entries(byUser)) {
        try {
          const plan = getActivePlan(parseInt(userId));
          if (!plan || new Date(plan.expires_at) < new Date()) continue;

          const session = getSessionStatus(String(userId));
          if (session.status !== 'CONNECTED') continue;

          const user = getUserById(parseInt(userId));
          const contacts = getContactsByUser(parseInt(userId));

          for (const rule of rules) {
            const nowMs = Date.now();
            const delayMs = rule.delay_days * 24 * 60 * 60 * 1000;

            for (const contact of contacts) {
              if (contact.is_excluded) continue;

              try {
                // Check if this contact already received a follow-up for this rule recently
                const lastSentRow = dbConn.prepare(`
                  SELECT sent_at FROM followup_sent_log
                  WHERE user_id = ? AND automation_id = ? AND contact_id = ?
                  ORDER BY sent_at DESC LIMIT 1
                `).get(parseInt(userId), rule.id, contact.id);

                if (lastSentRow) {
                  // Don't re-send if already sent within delay period
                  const lastSentMs = new Date(lastSentRow.sent_at).getTime();
                  if ((nowMs - lastSentMs) < delayMs) continue;
                }

                // For 'no_response' trigger — check if contact has been in DB longer than delay_days
                if (rule.trigger_event === 'no_response') {
                  const createdMs = new Date(contact.created_at).getTime();
                  if ((nowMs - createdMs) < delayMs) continue;
                }

                // Build message with placeholder replacements
                let text = rule.message_text;
                text = text.replace(/\{name\}/gi, contact.name || '');
                text = text.replace(/\{shopname\}/gi, contact.shop_name || '');
                text = text.replace(/\{mobile\}/gi, contact.mobile || '');

                await sendMessageToJid(String(userId), contact.mobile, text);

                // Log this send so we don't re-send immediately
                dbConn.prepare(`
                  INSERT INTO followup_sent_log (user_id, automation_id, contact_id, status, sent_at)
                  VALUES (?, ?, ?, 'sent', datetime('now'))
                `).run(parseInt(userId), rule.id, contact.id);

                console.log(`[FollowUp Poller] Sent '${rule.name}' to ${contact.mobile} for user ${userId}`);

                await new Promise(r => setTimeout(r, 1000));
              } catch (contactErr) {
                console.error(`[FollowUp Poller] Failed for contact ${contact.mobile}: ${contactErr.message}`);
                try {
                  dbConn.prepare(`
                    INSERT INTO followup_sent_log (user_id, automation_id, contact_id, status, error_message, sent_at)
                    VALUES (?, ?, ?, 'failed', ?, datetime('now'))
                  `).run(parseInt(userId), rule.id, contact.id, contactErr.message || 'Send error');
                } catch (logErr) {}
              }
            }
          }
        } catch (userErr) {
          console.error(`[FollowUp Poller] User ${userId} error: ${userErr.message}`);
        }
      }
    } catch (e) {
      console.error('[FollowUp Poller Error]', e);
    }
  }, 10 * 60 * 1000); // Poll every 10 minutes
}

// ─── Birthday Wishes Poller ───────────────────────────────────────────────────
function startBirthdayPoller() {
  setInterval(async () => {
    try {
      const dueWishes = getDueBirthdayWishes();
      if (!dueWishes || dueWishes.length === 0) return;

      // IST is UTC + 5 hours 30 minutes
      const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
      const istNow = new Date(Date.now() + IST_OFFSET_MS);

      const currentYear   = istNow.getUTCFullYear();
      const currentHour   = istNow.getUTCHours();
      const currentMinute = istNow.getUTCMinutes();
      const nowInMinutes  = currentHour * 60 + currentMinute;

      console.log(`[Birthday Poller] ${dueWishes.length} due wish(es). Local time (IST): ${String(currentHour).padStart(2,'0')}:${String(currentMinute).padStart(2,'0')}`);

      for (const wish of dueWishes) {
        try {
          // Only send within a 2-minute window of the configured send_time (local time).
          const [sendHour, sendMin] = (wish.send_time || '09:00').split(':').map(Number);
          const sendInMinutes = sendHour * 60 + sendMin;
          const WINDOW = 2; // minutes — matches the poll interval
          if (nowInMinutes < sendInMinutes || nowInMinutes > sendInMinutes + WINDOW) {
            if (nowInMinutes < sendInMinutes) {
              console.log(`[Birthday Poller] Wish #${wish.id} — not yet time (send at ${wish.send_time}, now ${String(currentHour).padStart(2,'0')}:${String(currentMinute).padStart(2,'0')})`);
            }
            continue;
          }

          const plan = getActivePlan(wish.user_id);
          if (!plan || new Date(plan.expires_at) < new Date()) continue;

          const session = getSessionStatus(String(wish.user_id));
          if (session.status !== 'CONNECTED') continue;

          const user = getUserById(wish.user_id);

          let text = wish.message_text;
          text = text.replace(/\{name\}/gi, wish.recipient_name || '');
          text = text.replace(/\{shopname\}/gi, user?.name || '');

          if (wish.media_path && wish.media_type) {
            await sendMediaToJid(String(wish.user_id), wish.recipient_phone, wish.media_path, wish.media_type, text);
          } else {
            await sendMessageToJid(String(wish.user_id), wish.recipient_phone, text);
          }

          markBirthdayWishSent(wish.id, currentYear);
          console.log(`[Birthday Poller] ✅ Sent birthday wish #${wish.id} to ${wish.recipient_phone}`);
        } catch (err) {
          console.error(`[Birthday Poller] Failed for wish #${wish.id}: ${err.message}`);
          markBirthdayWishFailed(wish.id, err.message);
        }
      }
    } catch (e) {
      console.error('[Birthday Poller Error]', e);
    }
  }, 1 * 60 * 1000); // Poll every 1 minute for accurate send-time delivery
}


// ─── Payment Reminder Poller ──────────────────────────────────────────────────
function startPaymentReminderPoller() {
  setInterval(async () => {
    try {
      const dbConn = getDb();
      const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
      const istDateStr = new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);

      // Find active pending reminders due today (factoring in remind_days_before offset)
      const dueReminders = dbConn.prepare(`
        SELECT * FROM payment_reminders
        WHERE active = 1 AND status = 'pending'
          AND date(due_date, '-' || remind_days_before || ' days') <= ?
          AND date(due_date) >= ?
      `).all(istDateStr, istDateStr);

      if (!dueReminders || dueReminders.length === 0) return;

      for (const rem of dueReminders) {
        try {
          const plan = getActivePlan(rem.user_id);
          if (!plan || new Date(plan.expires_at) < new Date()) continue;

          const session = getSessionStatus(String(rem.user_id));
          if (session.status !== 'CONNECTED') continue;

          let text = rem.message_text;
          text = text.replace(/\{name\}/gi, rem.recipient_name || '');
          text = text.replace(/\{amount\}/gi, rem.amount ? `₹${rem.amount}` : '');
          text = text.replace(/\{duedate\}/gi, rem.due_date || '');
          text = text.replace(/\{shopname\}/gi, '');

          if (rem.media_path && rem.media_type) {
            await sendMediaToJid(String(rem.user_id), rem.recipient_phone, rem.media_path, rem.media_type, text);
          } else {
            await sendMessageToJid(String(rem.user_id), rem.recipient_phone, text);
          }

          updatePaymentReminderStatus(rem.id, rem.user_id, 'sent');
          console.log(`[Payment Reminder Poller] Sent reminder #${rem.id} to ${rem.recipient_phone}`);
        } catch (err) {
          console.error(`[Payment Reminder Poller] Failed for #${rem.id}: ${err.message}`);
        }
      }
    } catch (e) {
      console.error('[Payment Reminder Poller Error]', e);
    }
  }, 10 * 60 * 1000); // Poll every 10 minutes
}

// ─── Plan Expiry Notification Poller ─────────────────────────────────────────

function startPlanExpiryPoller() {
  setInterval(async () => {
    try {
      // 1. Check if Admin WhatsApp session is connected
      const adminStatus = getSessionStatus('admin');
      if (adminStatus.status !== 'CONNECTED') return;

      const users = getAllUsers();
      if (!users || users.length === 0) return;

      const now = Date.now();

      for (const user of users) {
        if (user.role === 'admin') continue;
        if (!user.phone) continue;

        // Get user's latest plan (active or most recent)
        const plan = getActivePlan(user.id) || getPlansByUser(user.id)?.[0];
        if (!plan || !plan.expires_at) continue;

        const expiresAtMs = new Date(plan.expires_at).getTime();
        const diffMs = expiresAtMs - now;
        const diffHours = diffMs / (1000 * 60 * 60);

        let category = null;
        let minIntervalMinutes = 0;
        let maxPer24h = 0;
        let message = '';

        const formattedExpiryDate = new Date(expiresAtMs).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        });

        // ── FREQUENCY & TIME WINDOW RULES ──────────────────────────────────────
        if (diffHours > 48 && diffHours <= 72) {
          // 3 Days Remaining: 2 times a day (every 12 hours)
          category = '3_days';
          minIntervalMinutes = 12 * 60; // 720 min
          maxPer24h = 2;
          message =
            `⏳ *Subscription Expiring Soon!*\n\n` +
            `Hi ${user.name || 'there'},\n` +
            `Your WhatsApp Automation Plan will expire in *3 Days* (on ${formattedExpiryDate}).\n\n` +
            `To ensure uninterrupted automated messaging and API access, please renew your subscription.\n\n` +
            `📋 Plan: ${plan.plan_type || 'Monthly'}\n` +
            `💰 Price: ₹${plan.price || 199}\n\n` +
            `Log in to your account dashboard to submit deposit or renew plan. Thank you! 🙏`;
        } else if (diffHours > 24 && diffHours <= 48) {
          // 2 Days Remaining: 3 times a day (every 8 hours)
          category = '2_days';
          minIntervalMinutes = 8 * 60; // 480 min
          maxPer24h = 3;
          message =
            `⚠️ *Subscription Alert: 2 Days Left*\n\n` +
            `Hi ${user.name || 'there'},\n` +
            `Your WhatsApp Automation Plan expires in *2 Days* (on ${formattedExpiryDate}).\n\n` +
            `Please renew your subscription today to keep your WhatsApp automation running smoothly!\n\n` +
            `📋 Plan: ${plan.plan_type || 'Monthly'}\n` +
            `💰 Price: ₹${plan.price || 199}\n\n` +
            `Submit your deposit reference in the portal. Thank you! 🙏`;
        } else if (diffHours >= 0 && diffHours <= 24) {
          // Due Date / 1 Day Left: 4 times a day (every 6 hours)
          category = 'due_date';
          minIntervalMinutes = 6 * 60; // 360 min
          maxPer24h = 4;
          message =
            `🚨 *Subscription Expiring TODAY!*\n\n` +
            `Hi ${user.name || 'there'},\n` +
            `Your WhatsApp Automation Plan expires *TODAY* (${formattedExpiryDate}).\n\n` +
            `⚡ *Action Required*: Renew now to prevent interruption of your automated messages and campaigns!\n\n` +
            `📋 Plan: ${plan.plan_type || 'Monthly'}\n` +
            `💰 Price: ₹${plan.price || 199}\n\n` +
            `Please transfer funds and submit deposit UTR in your portal. 🙏`;
        } else if (diffHours < 0 && diffHours >= -96) {
          // Expired within last 4 days: 4 times a day (every 6 hours) for up to 4 days post-expiry
          category = 'expired_4d';
          minIntervalMinutes = 6 * 60; // 360 min
          maxPer24h = 4;
          const daysAgo = Math.floor(Math.abs(diffHours) / 24) || 1;
          message =
            `❌ *Subscription Expired*\n\n` +
            `Hi ${user.name || 'there'},\n` +
            `Your WhatsApp Automation Plan expired ${daysAgo} day(s) ago (on ${formattedExpiryDate}).\n\n` +
            `Your WhatsApp automated sessions and campaign APIs are currently paused.\n\n` +
            `To reactivate all services instantly, please submit your payment deposit in the portal.\n\n` +
            `📋 Plan: ${plan.plan_type || 'Monthly'}\n` +
            `💰 Price: ₹${plan.price || 199}\n\n` +
            `Thank you! 🙏`;
        } else {
          // Active > 3 days left OR Expired > 4 days ago OR Plan renewed -> DO NOT SEND
          continue;
        }

        // Check if notification can be sent based on frequency rules
        if (!canSendExpiryNotification(user.id, minIntervalMinutes, maxPer24h)) {
          continue;
        }

        // Dispatch WhatsApp message via Admin Session
        try {
          const digits = String(user.phone).replace(/\D/g, '');
          if (digits && digits.length >= 10) {
            await sendMessageToJid('admin', digits, message);
            logExpiryNotification(user.id, category);
            console.log(`[Expiry Poller] Sent '${category}' notification to user #${user.id} (${digits})`);
          }
        } catch (sendErr) {
          console.error(`[Expiry Poller] Failed to send to user #${user.id}: ${sendErr.message}`);
        }
      }
    } catch (e) {
      console.error('[Plan Expiry Poller Error]', e);
    }
  }, 10 * 60 * 1000); // Check every 10 minutes
}
