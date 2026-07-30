import express from 'express';
import { authMiddleware } from './middleware/authMiddleware.js';
import { planMiddleware } from './middleware/planMiddleware.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import xlsx from 'xlsx';
import { sendMessageToJid, getSessionStatus } from './sessionManager.js';
import {
  getCatalogByUserId, getServicesByCatalogId, upsertCatalog,
  createService, updateService, deleteService,
  getContactsByUser, upsertContact, deleteContact, toggleContactExclude,
  getRemindersByUser, createReminder, deleteReminder,
  getTemplatesByUser, createTemplate, updateTemplate, deleteTemplate,
  getUserById, getAutomationSettings, upsertAutomationSettings,
  getCampaignsByUser, getCampaignRecipients, createCampaign, updateCampaignStatus, getCampaignById
} from './db.js';

const router = express.Router();
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `crm_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

// Helper: normalize phone number
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return '91' + digits;
  return digits;
}

// Helper: guess media type from mimetype
function getMediaType(mimetype) {
  if (!mimetype) return null;
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('audio/')) return 'audio';
  if (mimetype.startsWith('video/')) return 'video';
  return 'document';
}

// All CRM routes require auth + active subscription plan
router.use(authMiddleware);
router.use(planMiddleware);

// ─── Digital Catalog Endpoints ───────────────────────────────────────────────

router.get('/catalog', (req, res) => {
  try {
    let catalog = getCatalogByUserId(req.user.id);
    let services = [];
    if (catalog) {
      services = getServicesByCatalogId(catalog.id);
    }
    return res.json({ catalog: catalog || null, services });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/catalog', upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'catalog_audio', maxCount: 1 }
]), (req, res) => {
  const { brand_name, description } = req.body;
  if (!brand_name) {
    return res.status(400).json({ error: 'brand_name is required' });
  }

  const logo_path = req.files?.['logo']?.[0]?.path || null;
  const catalog_audio_path = req.files?.['catalog_audio']?.[0]?.path || null;

  try {
    const catalog = upsertCatalog(req.user.id, {
      brand_name,
      logo_path,
      description: description || '',
      catalog_audio_path
    });
    return res.json({ message: 'Catalog updated successfully', catalog });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/catalog/services', upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'audio', maxCount: 1 }
]), (req, res) => {
  const { name, description, price } = req.body;
  if (!name || price === undefined) {
    return res.status(400).json({ error: 'name and price are required' });
  }

  try {
    const catalog = getCatalogByUserId(req.user.id);
    if (!catalog) {
      return res.status(400).json({ error: 'Please create your catalog settings first before adding services.' });
    }

    const image_path = req.files?.['image']?.[0]?.path || null;
    const audio_path = req.files?.['audio']?.[0]?.path || null;

    const service = createService(catalog.id, {
      name,
      description: description || '',
      price: parseFloat(price),
      image_path,
      audio_path
    });
    return res.json({ message: 'Service added successfully', service });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/catalog/services/:id', upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'audio', maxCount: 1 }
]), (req, res) => {
  const { name, description, price } = req.body;
  const serviceId = parseInt(req.params.id);

  if (!name || price === undefined) {
    return res.status(400).json({ error: 'name and price are required' });
  }

  try {
    const catalog = getCatalogByUserId(req.user.id);
    if (!catalog) {
      return res.status(400).json({ error: 'Catalog not found' });
    }

    const image_path = req.files?.['image']?.[0]?.path || null;
    const audio_path = req.files?.['audio']?.[0]?.path || null;

    const service = updateService(serviceId, catalog.id, {
      name,
      description: description || '',
      price: parseFloat(price),
      image_path,
      audio_path
    });
    return res.json({ message: 'Service updated successfully', service });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/catalog/services/:id', (req, res) => {
  const serviceId = parseInt(req.params.id);
  try {
    const catalog = getCatalogByUserId(req.user.id);
    if (!catalog) {
      return res.status(400).json({ error: 'Catalog not found' });
    }
    const result = deleteService(serviceId, catalog.id);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Contacts Directory Endpoints ────────────────────────────────────────────

router.get('/contacts', (req, res) => {
  try {
    const contacts = getContactsByUser(req.user.id);
    return res.json({ contacts });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/contacts', (req, res) => {
  const { name, mobile, shop_name } = req.body;
  if (!name || !mobile) {
    return res.status(400).json({ error: 'name and mobile are required' });
  }

  const phone = normalizePhone(mobile);
  if (phone.length < 10) {
    return res.status(400).json({ error: 'Invalid phone number. Must be at least 10 digits.' });
  }

  try {
    const contact = upsertContact({
      user_id: req.user.id,
      name,
      mobile: phone,
      shop_name: shop_name || ''
    });
    return res.json({ message: 'Contact saved successfully', contact });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/contacts/toggle-exclude', (req, res) => {
  const { contactId, isExcluded } = req.body;
  if (!contactId || isExcluded === undefined) {
    return res.status(400).json({ error: 'contactId and isExcluded are required' });
  }

  try {
    const contact = toggleContactExclude(contactId, req.user.id, isExcluded);
    return res.json({ message: 'Blocklist status updated', contact });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/contacts/:id', (req, res) => {
  const contactId = parseInt(req.params.id);
  try {
    const result = deleteContact(contactId, req.user.id);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/contacts/import', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Excel file is required' });
  }

  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(worksheet, { defval: '' });

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Excel sheet is empty' });
    }

    // Auto-detect columns
    const sampleRow = rows[0];
    const keys = Object.keys(sampleRow);

    const nameKeys = ['name', 'fullname', 'username', 'customername', 'contactname'];
    const phoneKeys = ['phone', 'mobile', 'number', 'contact', 'phonenumber', 'mobilenumber', 'recipient', 'to'];
    const shopKeys = ['shop', 'shopname', 'store', 'storename', 'business', 'businessname'];

    const nameKey = keys.find(k => nameKeys.includes(k.toLowerCase().replace(/[\s_-]/g, '')));
    const phoneKey = keys.find(k => phoneKeys.includes(k.toLowerCase().replace(/[\s_-]/g, '')));
    const shopKey = keys.find(k => shopKeys.includes(k.toLowerCase().replace(/[\s_-]/g, '')));

    if (!phoneKey) {
      return res.status(400).json({ error: 'Could not find a phone number column in the Excel file (e.g. phone, mobile, number)' });
    }

    let importCount = 0;
    for (const row of rows) {
      const rawPhone = String(row[phoneKey] || '').trim();
      const phone = normalizePhone(rawPhone);
      if (phone.length < 10) continue;

      const name = String(row[nameKey] || phone).trim();
      const shopName = shopKey ? String(row[shopKey] || '').trim() : '';

      upsertContact({
        user_id: req.user.id,
        name,
        mobile: phone,
        shop_name: shopName
      });
      importCount++;
    }

    // Clean up uploaded file
    try { fs.unlinkSync(req.file.path); } catch (e) {}

    return res.json({ success: true, message: `Successfully imported ${importCount} contacts!`, count: importCount });
  } catch (err) {
    // Clean up uploaded file in case of error
    try { fs.unlinkSync(req.file.path); } catch (e) {}
    return res.status(500).json({ error: `Import failed: ${err.message}` });
  }
});

// ─── Scheduled Reminders Endpoints ───────────────────────────────────────────

router.get('/reminders', (req, res) => {
  try {
    const reminders = getRemindersByUser(req.user.id);
    return res.json({ reminders });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/reminders', (req, res) => {
  const { contact_id, recipient_mobile, recipient_name, shop_name, message_template, scheduled_at, send_after_days } = req.body;

  if (!recipient_mobile || !message_template) {
    return res.status(400).json({ error: 'recipient_mobile and message_template are required' });
  }

  const phone = normalizePhone(recipient_mobile);
  if (phone.length < 10) {
    return res.status(400).json({ error: 'Invalid recipient mobile number.' });
  }

  let finalScheduledAt = scheduled_at;
  if (send_after_days !== undefined && send_after_days !== null) {
    const days = parseInt(send_after_days);
    if (isNaN(days) || days < 0) {
      return res.status(400).json({ error: 'send_after_days must be a non-negative integer' });
    }
    finalScheduledAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  if (!finalScheduledAt) {
    return res.status(400).json({ error: 'Either scheduled_at or send_after_days must be provided' });
  }

  try {
    // Validate datetime string
    new Date(finalScheduledAt);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid scheduled_at date/time format' });
  }

  try {
    const reminder = createReminder({
      user_id: req.user.id,
      contact_id: contact_id ? parseInt(contact_id) : null,
      recipient_mobile: phone,
      recipient_name: recipient_name || '',
      shop_name: shop_name || '',
      message_template,
      scheduled_at: finalScheduledAt
    });
    return res.json({ message: 'Reminder scheduled successfully', reminder });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/reminders/:id', (req, res) => {
  const reminderId = parseInt(req.params.id);
  try {
    const result = deleteReminder(reminderId, req.user.id);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Personalized Message Templates Endpoints ───────────────────────────────

router.get('/templates', (req, res) => {
  try {
    const templates = getTemplatesByUser(req.user.id);
    return res.json({ templates });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/templates', (req, res) => {
  const { title, content, category } = req.body;
  if (!title || !content) {
    return res.status(400).json({ error: 'Title and content are required' });
  }

  try {
    const template = createTemplate({
      user_id: req.user.id,
      title: title.trim(),
      content: content.trim(),
      category: category ? category.trim() : 'General'
    });
    return res.json({ message: 'Template saved successfully', template });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/templates/:id', (req, res) => {
  const templateId = parseInt(req.params.id);
  const { title, content, category } = req.body;
  if (!title || !content) {
    return res.status(400).json({ error: 'Title and content are required' });
  }

  try {
    const template = updateTemplate(templateId, req.user.id, {
      title: title.trim(),
      content: content.trim(),
      category: category ? category.trim() : 'General'
    });
    return res.json({ message: 'Template updated successfully', template });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/templates/:id', (req, res) => {
  const templateId = parseInt(req.params.id);
  try {
    const result = deleteTemplate(templateId, req.user.id);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Bulk send personalized template to selected contacts or all contacts
router.post('/templates/send-bulk', async (req, res) => {
  const userId = String(req.user.id);
  const { contactIds, content, delayMs = 1500 } = req.body;

  if (!content) {
    return res.status(400).json({ error: 'Message content or template is required' });
  }

  // Check WhatsApp Session Status
  const statusInfo = getSessionStatus(userId);
  if (statusInfo.status !== 'CONNECTED') {
    return res.status(400).json({ error: 'WhatsApp session is not connected. Please log in to WhatsApp first.' });
  }

  try {
    let contacts = getContactsByUser(req.user.id);
    
    // Filter out excluded contacts
    contacts = contacts.filter(c => c.is_excluded !== 1);

    // If specific contact IDs provided, filter down to them
    if (Array.isArray(contactIds) && contactIds.length > 0) {
      const idSet = new Set(contactIds.map(id => parseInt(id)));
      contacts = contacts.filter(c => idSet.has(c.id));
    }

    if (contacts.length === 0) {
      return res.status(400).json({ error: 'No active recipients found to send.' });
    }

    // Process broadcast in background or synchronously send with small delay
    const results = [];
    let successCount = 0;
    let failCount = 0;

    const senderUser = getUserById(req.user.id);
    for (const contact of contacts) {
      // Substitute placeholders
      let personalizedMsg = content;
      const emailVal = contact.email || senderUser?.email || '';
      personalizedMsg = personalizedMsg.replace(/\{name\}/gi, contact.name || '');
      personalizedMsg = personalizedMsg.replace(/\[name\]/gi, contact.name || '');
      personalizedMsg = personalizedMsg.replace(/\{shopname\}/gi, contact.shop_name || '');
      personalizedMsg = personalizedMsg.replace(/\[shopname\]/gi, contact.shop_name || '');
      personalizedMsg = personalizedMsg.replace(/\{shop\}/gi, contact.shop_name || '');
      personalizedMsg = personalizedMsg.replace(/\[shop\]/gi, contact.shop_name || '');
      personalizedMsg = personalizedMsg.replace(/\{mobile\}/gi, contact.mobile || '');
      personalizedMsg = personalizedMsg.replace(/\[mobile\]/gi, contact.mobile || '');
      personalizedMsg = personalizedMsg.replace(/\{email\}/gi, emailVal);
      personalizedMsg = personalizedMsg.replace(/\[email\]/gi, emailVal);

      try {
        await sendMessageToJid(userId, contact.mobile, personalizedMsg);
        successCount++;
        results.push({ mobile: contact.mobile, name: contact.name, status: 'SENT' });
      } catch (err) {
        failCount++;
        results.push({ mobile: contact.mobile, name: contact.name, status: 'FAILED', error: err.message });
      }

      // Add delay between sends if multiple recipients
      if (contacts.length > 1 && delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return res.json({
      success: true,
      totalCount: contacts.length,
      successCount,
      failCount,
      results
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Automation Settings Endpoints (Welcome & Away Messages) ─────────────────

router.get('/automation-settings', (req, res) => {
  try {
    const settings = getAutomationSettings(req.user.id);
    return res.json({ settings });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/automation-settings', upload.single('welcome_media'), (req, res) => {
  const {
    welcome_active, welcome_text,
    away_active, away_text, away_schedule_type, away_start_time, away_end_time
  } = req.body;

  try {
    const welcome_media_path = req.file ? req.file.path : undefined;
    const welcome_media_type = req.file ? getMediaType(req.file.mimetype) : undefined;

    const updated = upsertAutomationSettings(req.user.id, {
      welcome_active: welcome_active !== undefined ? (welcome_active === 'true' || welcome_active === '1' || welcome_active === true ? 1 : 0) : undefined,
      welcome_text: welcome_text !== undefined ? welcome_text.trim() : undefined,
      welcome_media_path,
      welcome_media_type,
      away_active: away_active !== undefined ? (away_active === 'true' || away_active === '1' || away_active === true ? 1 : 0) : undefined,
      away_text: away_text !== undefined ? away_text.trim() : undefined,
      away_schedule_type: away_schedule_type !== undefined ? away_schedule_type : undefined,
      away_start_time: away_start_time !== undefined ? away_start_time : undefined,
      away_end_time: away_end_time !== undefined ? away_end_time : undefined
    });

    return res.json({ message: 'Automation settings updated successfully', settings: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Campaigns Endpoints ─────────────────────────────────────────────────────

router.get('/campaigns', (req, res) => {
  try {
    const campaigns = getCampaignsByUser(req.user.id);
    return res.json({ campaigns });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/campaigns/:id/recipients', (req, res) => {
  try {
    const recipients = getCampaignRecipients(req.params.id);
    return res.json({ recipients });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/campaigns', upload.single('media'), (req, res) => {
  try {
    const { name, message_text, scheduled_at, contactsStr } = req.body;
    let contacts = [];
    if (contactsStr) {
      contacts = JSON.parse(contactsStr);
    }
    
    if (!contacts || contacts.length === 0) {
      return res.status(400).json({ error: 'No contacts selected for the campaign' });
    }

    const media_path = req.file ? req.file.path : null;
    const media_type = req.file ? getMediaType(req.file.mimetype) : null;

    const campaign = createCampaign(req.user.id, {
      name,
      message_text,
      media_path,
      media_type,
      scheduled_at: scheduled_at || null,
      contacts
    });

    return res.json({ message: 'Campaign created successfully', campaign });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/campaigns/:id/status', (req, res) => {
  try {
    const { status } = req.body;
    
    // Validate ownership
    const campaign = getCampaignById(req.params.id);
    if (!campaign || campaign.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const validStatuses = ['pending', 'paused', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status update' });
    }

    const updated = updateCampaignStatus(req.params.id, status);
    return res.json({ message: 'Campaign status updated', campaign: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;

