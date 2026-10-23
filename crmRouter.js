import express from 'express';
import { authMiddleware } from './middleware/authMiddleware.js';
import { planMiddleware } from './middleware/planMiddleware.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import xlsx from 'xlsx';
import { sendMessageToJid, getSessionStatus, sendTypingPresence, parseSpintax } from './sessionManager.js';
import { triggerCampaignsPoller } from './index.js';
import {
  getCatalogByUserId, getServicesByCatalogId, upsertCatalog,
  createService, updateService, deleteService,
  getContactsByUser, upsertContact, upsertContactsBatch, deleteContact, toggleContactExclude,
  updateContact, updateContactCategory, updateContactsCategoryBatch, getContactCategoriesByUser,
  getRemindersByUser, createReminder, deleteReminder, calculateNextScheduleDate,
  getTemplatesByUser, createTemplate, updateTemplate, deleteTemplate,
  getUserById, getAutomationSettings, upsertAutomationSettings,
  getCampaignsByUser, getCampaignRecipients, createCampaign, updateCampaignStatus, getCampaignById, deleteCampaign,
  getContactGroupsByUser, getContactGroupById, createContactGroup, updateContactGroup, deleteContactGroup,
  getContactGroupMembers, addContactsToGroup, removeContactFromGroup, getContactsNotInGroup,
  getBirthdayWishesByUser, createBirthdayWish, updateBirthdayWish, deleteBirthdayWish,
  getPaymentRemindersByUser, createPaymentReminder, updatePaymentReminderStatus, deletePaymentReminder,
  getOrderNotificationsByUser, createOrderNotification, deleteOrderNotification,
  getFollowupAutomationsByUser, createFollowupAutomation, updateFollowupAutomation, deleteFollowupAutomation,
  getFollowupLogsByUser, deleteFollowupLog,
  getInboxConversations, getInboxMessagesByPhone, markInboxThreadAsRead, saveInboxMessage,
  getCannedRepliesByUser, createCannedReply, deleteCannedReply,
  getPhoneByLid
} from './db.js';


const router = express.Router();
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const ALLOWED_CRM_EXTENSIONS = new Set([
  // Images
  '.jpg', '.jpeg', '.png', '.webp', '.gif',
  // Audio
  '.mp3', '.ogg', '.wav', '.m4a', '.aac',
  // Video
  '.mp4', '.webm', '.mov', '.3gp',
  // Documents
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv'
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
    cb(null, `crm_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB max
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_CRM_EXTENSIONS.has(ext)) {
      return cb(new Error(`File type '${ext}' is not permitted. Only safe images, audio, video, and documents are allowed.`));
    }
    const mime = (file.mimetype || '').toLowerCase();
    if (mime.includes('html') || mime.includes('javascript') || mime.includes('svg+xml') || mime.includes('x-sh')) {
      return cb(new Error('Executable or script files are strictly prohibited.'));
    }
    cb(null, true);
  }
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

router.get('/catalog', async (req, res) => {
  try {
    let catalog = await getCatalogByUserId(req.user.id);
    let services = [];
    if (catalog) {
      services = await getServicesByCatalogId(catalog.id);
    }
    return res.json({ catalog: catalog || null, services });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/catalog', upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'catalog_audio', maxCount: 1 }
]), async (req, res) => {
  const { brand_name, description } = req.body;
  if (!brand_name) {
    return res.status(400).json({ error: 'brand_name is required' });
  }

  const logo_path = req.files?.['logo']?.[0]?.path || null;
  const catalog_audio_path = req.files?.['catalog_audio']?.[0]?.path || null;

  try {
    const catalog = await upsertCatalog(req.user.id, {
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
]), async (req, res) => {
  const { name, description, price } = req.body;
  if (!name || price === undefined) {
    return res.status(400).json({ error: 'name and price are required' });
  }

  try {
    const catalog = await getCatalogByUserId(req.user.id);
    if (!catalog) {
      return res.status(400).json({ error: 'Please create your catalog settings first before adding services.' });
    }

    const image_path = req.files?.['image']?.[0]?.path || null;
    const audio_path = req.files?.['audio']?.[0]?.path || null;

    const service = await createService(catalog.id, {
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
]), async (req, res) => {
  const { name, description, price } = req.body;
  const serviceId = parseInt(req.params.id);

  if (!name || price === undefined) {
    return res.status(400).json({ error: 'name and price are required' });
  }

  try {
    const catalog = await getCatalogByUserId(req.user.id);
    if (!catalog) {
      return res.status(400).json({ error: 'Catalog not found' });
    }

    const image_path = req.files?.['image']?.[0]?.path || null;
    const audio_path = req.files?.['audio']?.[0]?.path || null;

    const service = await updateService(serviceId, catalog.id, {
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

router.delete('/catalog/services/:id', async (req, res) => {
  const serviceId = parseInt(req.params.id);
  try {
    const catalog = await getCatalogByUserId(req.user.id);
    if (!catalog) {
      return res.status(400).json({ error: 'Catalog not found' });
    }
    const result = await deleteService(serviceId, catalog.id);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Contacts Directory Endpoints ────────────────────────────────────────────

router.get('/contacts', async (req, res) => {
  try {
    const contacts = await getContactsByUser(req.user.id);
    return res.json({ contacts });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/contacts/categories', async (req, res) => {
  try {
    const customCategories = await getContactCategoriesByUser(req.user.id);
    const standardCategories = ['General', 'Customer', 'VIP', 'Lead', 'Wholesale', 'Retail', 'Supplier'];
    const merged = Array.from(new Set([...standardCategories, ...customCategories])).filter(Boolean);
    return res.json({ categories: merged });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/contacts', async (req, res) => {
  const { name, mobile, shop_name, category } = req.body;
  if (!name || !mobile) {
    return res.status(400).json({ error: 'name and mobile are required' });
  }

  const phone = normalizePhone(mobile);
  if (phone.length < 10) {
    return res.status(400).json({ error: 'Invalid phone number. Must be at least 10 digits.' });
  }

  try {
    const contact = await upsertContact({
      user_id: req.user.id,
      name: name.trim(),
      mobile: phone,
      shop_name: shop_name ? shop_name.trim() : '',
      category: category ? category.trim() : 'General'
    });
    return res.json({ message: 'Contact saved successfully', contact });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/contacts/:id', async (req, res) => {
  const contactId = parseInt(req.params.id);
  const { name, mobile, shop_name, category } = req.body;

  try {
    let phone = undefined;
    if (mobile) {
      phone = normalizePhone(mobile);
      if (phone.length < 10) {
        return res.status(400).json({ error: 'Invalid phone number. Must be at least 10 digits.' });
      }
    }
    const contact = await updateContact(contactId, req.user.id, {
      name: name !== undefined ? name.trim() : undefined,
      mobile: phone,
      shop_name: shop_name !== undefined ? shop_name.trim() : undefined,
      category: category !== undefined ? category.trim() : undefined
    });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    return res.json({ message: 'Contact updated successfully', contact });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/contacts/switch-category', async (req, res) => {
  const { contactId, contactIds, category } = req.body;
  if (!category || !category.trim()) {
    return res.status(400).json({ error: 'Category is required' });
  }

  const targetCategory = category.trim();

  try {
    if (Array.isArray(contactIds) && contactIds.length > 0) {
      const result = await updateContactsCategoryBatch(contactIds.map(Number), req.user.id, targetCategory);
      return res.json({ message: `${result.updated} contact(s) moved to category "${targetCategory}"`, result });
    } else if (contactId) {
      const contact = await updateContactCategory(parseInt(contactId), req.user.id, targetCategory);
      if (!contact) return res.status(404).json({ error: 'Contact not found' });
      return res.json({ message: `Contact moved to category "${targetCategory}"`, contact });
    } else {
      return res.status(400).json({ error: 'contactId or contactIds array is required' });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/contacts/toggle-exclude', async (req, res) => {
  const { contactId, isExcluded } = req.body;
  if (!contactId || isExcluded === undefined) {
    return res.status(400).json({ error: 'contactId and isExcluded are required' });
  }

  try {
    const contact = await toggleContactExclude(contactId, req.user.id, isExcluded);
    return res.json({ message: 'Blocklist status updated', contact });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/contacts/:id', async (req, res) => {
  const contactId = parseInt(req.params.id);
  try {
    const result = await deleteContact(contactId, req.user.id);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Contact Groups Endpoints ─────────────────────────────────────────────────

router.get('/contact-groups', async (req, res) => {
  try {
    const groups = await getContactGroupsByUser(req.user.id);
    return res.json({ groups });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/contact-groups', async (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Group name is required' });
  }
  try {
    const group = await createContactGroup(req.user.id, { name, description });
    return res.json({ message: 'Group created successfully', group });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/contact-groups/:id', async (req, res) => {
  const groupId = parseInt(req.params.id);
  const { name, description } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Group name is required' });
  }
  try {
    const group = await updateContactGroup(groupId, req.user.id, { name, description });
    if (!group) return res.status(404).json({ error: 'Group not found' });
    return res.json({ message: 'Group updated successfully', group });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/contact-groups/:id', async (req, res) => {
  const groupId = parseInt(req.params.id);
  try {
    const group = await getContactGroupById(groupId, req.user.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const result = await deleteContactGroup(groupId, req.user.id);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Get members of a group
router.get('/contact-groups/:id/members', async (req, res) => {
  const groupId = parseInt(req.params.id);
  try {
    const members = await getContactGroupMembers(groupId, req.user.id);
    if (members === null) return res.status(404).json({ error: 'Group not found' });
    return res.json({ members });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Get contacts NOT yet in a group (for add-member picker)
router.get('/contact-groups/:id/available-contacts', async (req, res) => {
  const groupId = parseInt(req.params.id);
  try {
    const group = await getContactGroupById(groupId, req.user.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const contacts = await getContactsNotInGroup(groupId, req.user.id);
    return res.json({ contacts });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Add contacts to a group
router.post('/contact-groups/:id/members', async (req, res) => {
  const groupId = parseInt(req.params.id);
  const { contactIds } = req.body;
  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    return res.status(400).json({ error: 'contactIds array is required' });
  }
  try {
    const result = await addContactsToGroup(groupId, req.user.id, contactIds.map(Number));
    return res.json({ message: `${result.added} contact(s) added to group`, result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Remove a contact from a group
router.delete('/contact-groups/:id/members/:contactId', async (req, res) => {
  const groupId = parseInt(req.params.id);
  const contactId = parseInt(req.params.contactId);
  try {
    const result = await removeContactFromGroup(groupId, contactId, req.user.id);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/contacts/import', upload.single('file'), async (req, res) => {
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
    const categoryKeys = ['category', 'contactcategory', 'cat', 'group', 'tag', 'type'];

    const nameKey = keys.find(k => nameKeys.includes(k.toLowerCase().replace(/[\s_-]/g, '')));
    const phoneKey = keys.find(k => phoneKeys.includes(k.toLowerCase().replace(/[\s_-]/g, '')));
    const shopKey = keys.find(k => shopKeys.includes(k.toLowerCase().replace(/[\s_-]/g, '')));
    const categoryKey = keys.find(k => categoryKeys.includes(k.toLowerCase().replace(/[\s_-]/g, '')));

    if (!phoneKey) {
      return res.status(400).json({ error: 'Could not find a phone number column in the Excel file (e.g. phone, mobile, number)' });
    }

    const contactsToInsert = [];
    for (const row of rows) {
      const rawPhone = String(row[phoneKey] || '').trim();
      const phone = normalizePhone(rawPhone);
      if (phone.length < 10) continue;

      const name = String(row[nameKey] || phone).trim();
      const shopName = shopKey ? String(row[shopKey] || '').trim() : '';
      const category = categoryKey ? String(row[categoryKey] || 'General').trim() : 'General';

      contactsToInsert.push({
        user_id: req.user.id,
        name,
        mobile: phone,
        shop_name: shopName,
        category: category || 'General',
        is_excluded: 0
      });
    }

    if (contactsToInsert.length === 0) {
      return res.status(400).json({ error: 'No valid phone numbers found in the uploaded file.' });
    }

    const importCount = await upsertContactsBatch(contactsToInsert);

    // Clean up uploaded file
    try { fs.unlinkSync(req.file.path); } catch (e) { }

    return res.json({
      success: true,
      message: `Successfully imported ${importCount} contacts!`,
      count: importCount,
      fileName: req.file.originalname,
      totalRows: rows.length
    });
  } catch (err) {
    // Clean up uploaded file in case of error
    try { fs.unlinkSync(req.file.path); } catch (e) { }
    return res.status(500).json({ error: `Import failed: ${err.message}` });
  }
});

router.get('/contacts/sample-excel', async (req, res) => {
  try {
    const sampleContacts = [
      { Name: 'John Doe', Mobile: '919876543210', ShopName: 'Acme Traders', Category: 'Customer' },
      { Name: 'Jane Smith', Mobile: '919876543211', ShopName: 'Smith Enterprises', Category: 'VIP' },
      { Name: 'Rahul Sharma', Mobile: '919123456789', ShopName: 'Sharma Electronics', Category: 'Wholesale' }
    ];

    const worksheet = xlsx.utils.json_to_sheet(sampleContacts);
    worksheet['!cols'] = [
      { wch: 20 },
      { wch: 18 },
      { wch: 25 },
      { wch: 18 }
    ];

    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Contacts');

    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="sample_contacts.xlsx"');
    return res.send(buffer);
  } catch (err) {
    return res.status(500).json({ error: `Failed to generate sample Excel: ${err.message}` });
  }
});

router.get('/contacts/export-excel', async (req, res) => {
  try {
    const contacts = await getContactsByUser(req.user.id);
    const data = contacts.map(c => ({
      Name: c.name || '',
      Mobile: c.mobile || '',
      ShopName: c.shop_name || '',
      Category: c.category || 'General',
      Excluded: c.is_excluded ? 'Yes' : 'No',
      CreatedAt: c.created_at || ''
    }));

    const worksheet = xlsx.utils.json_to_sheet(data.length ? data : [{ Name: '', Mobile: '', ShopName: '', Category: '' }]);
    worksheet['!cols'] = [{ wch: 20 }, { wch: 18 }, { wch: 25 }, { wch: 18 }, { wch: 10 }, { wch: 20 }];

    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Contacts');

    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts_export.xlsx"');
    return res.send(buffer);
  } catch (err) {
    return res.status(500).json({ error: `Export failed: ${err.message}` });
  }
});

// ─── Scheduled Reminders Endpoints ───────────────────────────────────────────

router.get('/reminders', async (req, res) => {
  try {
    const reminders = await getRemindersByUser(req.user.id);
    return res.json({ reminders });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/reminders', async (req, res) => {
  const { contact_id, recipient_mobile, recipient_name, shop_name, message_template, scheduled_at, send_after_days, selected_days, send_time, repeat_option } = req.body;

  if (!recipient_mobile || !message_template) {
    return res.status(400).json({ error: 'recipient_mobile and message_template are required' });
  }

  const phone = normalizePhone(recipient_mobile);
  if (phone.length < 10) {
    return res.status(400).json({ error: 'Invalid recipient mobile number.' });
  }

  let finalScheduledAt = scheduled_at;
  if (selected_days) {
    finalScheduledAt = calculateNextScheduleDate(selected_days, send_time || '09:00');
  } else if (send_after_days !== undefined && send_after_days !== null) {
    const days = parseInt(send_after_days);
    if (isNaN(days) || days < 0) {
      return res.status(400).json({ error: 'send_after_days must be a non-negative integer' });
    }
    finalScheduledAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  if (!finalScheduledAt) {
    return res.status(400).json({ error: 'Either scheduled_at, send_after_days, or selected_days must be provided' });
  }

  try {
    // Validate datetime string
    new Date(finalScheduledAt);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid scheduled_at date/time format' });
  }

  try {
    const reminder = await createReminder({
      user_id: req.user.id,
      contact_id: contact_id ? parseInt(contact_id) : null,
      recipient_mobile: phone,
      recipient_name: recipient_name || '',
      shop_name: shop_name || '',
      message_template,
      scheduled_at: finalScheduledAt,
      repeat_option: repeat_option || 'once',
      selected_days: selected_days || null,
      send_time: send_time || null
    });
    return res.json({ message: 'Reminder scheduled successfully', reminder });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/reminders/:id', async (req, res) => {
  const reminderId = parseInt(req.params.id);
  try {
    const result = await deleteReminder(reminderId, req.user.id);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Personalized Message Templates Endpoints ───────────────────────────────

router.get('/templates', async (req, res) => {
  try {
    const templates = await getTemplatesByUser(req.user.id);
    return res.json({ templates });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/templates', async (req, res) => {
  const { title, content, category } = req.body;
  if (!title || !content) {
    return res.status(400).json({ error: 'Title and content are required' });
  }

  try {
    const template = await createTemplate({
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

router.put('/templates/:id', async (req, res) => {
  const templateId = parseInt(req.params.id);
  const { title, content, category } = req.body;
  if (!title || !content) {
    return res.status(400).json({ error: 'Title and content are required' });
  }

  try {
    const template = await updateTemplate(templateId, req.user.id, {
      title: title.trim(),
      content: content.trim(),
      category: category ? category.trim() : 'General'
    });
    return res.json({ message: 'Template updated successfully', template });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/templates/:id', async (req, res) => {
  const templateId = parseInt(req.params.id);
  try {
    const result = await deleteTemplate(templateId, req.user.id);
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
    let contacts = await getContactsByUser(req.user.id);

    // Filter out excluded contacts
    contacts = contacts.filter(c => c.is_excluded !== 1);

    // If category provided, filter down to that category
    if (req.body.category && req.body.category !== 'ALL') {
      contacts = contacts.filter(c => (c.category || 'General').toLowerCase() === String(req.body.category).toLowerCase());
    }

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

    const senderUser = await getUserById(req.user.id);
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

      // Apply Spintax variation
      personalizedMsg = parseSpintax(personalizedMsg);

      try {
        // Typing simulation (1.5s - 3s)
        const typingDuration = Math.floor(Math.random() * 1500) + 1500;
        await sendTypingPresence(userId, contact.mobile, typingDuration);

        await sendMessageToJid(userId, contact.mobile, personalizedMsg);
        successCount++;
        results.push({ mobile: contact.mobile, name: contact.name, status: 'SENT' });
      } catch (err) {
        failCount++;
        results.push({ mobile: contact.mobile, name: contact.name, status: 'FAILED', error: err.message });
      }

      // Add safe delay between sends if multiple recipients
      if (contacts.length > 1) {
        const safeDelay = Math.max(delayMs, 8000) + Math.floor(Math.random() * 4000);
        await new Promise(resolve => setTimeout(resolve, safeDelay));
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

router.get('/automation-settings', async (req, res) => {
  try {
    const settings = await getAutomationSettings(req.user.id);
    return res.json({ settings });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/automation-settings', upload.single('welcome_media'), async (req, res) => {
  const {
    welcome_active, welcome_text,
    away_active, away_text, away_schedule_type, away_start_time, away_end_time,
    daily_campaign_limit
  } = req.body;

  try {
    const welcome_media_path = req.file ? req.file.path : undefined;
    const welcome_media_type = req.file ? getMediaType(req.file.mimetype) : undefined;

    const updated = await upsertAutomationSettings(req.user.id, {
      welcome_active: welcome_active !== undefined ? (welcome_active === 'true' || welcome_active === '1' || welcome_active === true ? 1 : 0) : undefined,
      welcome_text: welcome_text !== undefined ? welcome_text.trim() : undefined,
      welcome_media_path,
      welcome_media_type,
      away_active: away_active !== undefined ? (away_active === 'true' || away_active === '1' || away_active === true ? 1 : 0) : undefined,
      away_text: away_text !== undefined ? away_text.trim() : undefined,
      away_schedule_type: away_schedule_type !== undefined ? away_schedule_type : undefined,
      away_start_time: away_start_time !== undefined ? away_start_time : undefined,
      away_end_time: away_end_time !== undefined ? away_end_time : undefined,
      daily_campaign_limit: daily_campaign_limit !== undefined ? parseInt(daily_campaign_limit) || 200 : undefined
    });


    return res.json({ message: 'Automation settings updated successfully', settings: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Campaigns Endpoints ─────────────────────────────────────────────────────

router.get('/campaigns', async (req, res) => {
  try {
    const campaigns = await getCampaignsByUser(req.user.id);
    return res.json({ campaigns });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/campaigns/:id/recipients', async (req, res) => {
  try {
    const recipients = await getCampaignRecipients(req.params.id);
    return res.json({ recipients });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/campaigns/:id', async (req, res) => {
  try {
    const campaign = await getCampaignById(req.params.id);
    if (!campaign || campaign.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const recipients = await getCampaignRecipients(req.params.id);
    return res.json({ campaign, recipients });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Smart Anti-Ban Spintax Generator
function generateSmartSpintax(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  let text = rawText.trim();

  const replacements = [
    {
      regex: /\b(hi|hello|hey|greetings|dear)\b/gi,
      spintax: '{Hi|Hello|Hey|Greetings}'
    },
    {
      regex: /\b(hope you are doing well|hope you're doing well|hope all is well)\b/gi,
      spintax: "{hope you are doing well|hope this finds you well|hope you're having a wonderful day}"
    },
    {
      regex: /\b(special offer|exclusive offer|great offer|limited offer)\b/gi,
      spintax: '{special offer|exclusive deal|limited-time promotion|exclusive privilege}'
    },
    {
      regex: /\b(check out|take a look at|check this out)\b/gi,
      spintax: '{check out|explore|take a look at|discover}'
    },
    {
      regex: /\b(discount|off|savings)\b/gi,
      spintax: '{discount|special price|savings}'
    },
    {
      regex: /\b(reply to this message|reply back|let us know)\b/gi,
      spintax: '{reply to this message|let us know|feel free to respond here|drop us a reply}'
    },
    {
      regex: /\b(contact us|reach out to us|call us)\b/gi,
      spintax: '{reach out to us|contact our team|connect with us|call or message us}'
    },
    {
      regex: /\b(thank you|thanks & regards|thanks and regards|best regards|regards)\b/gi,
      spintax: '{Thank you & regards|Best wishes|Warm regards|Thanks and have a great day}'
    }
  ];

  // Protect existing Spintax {a|b} and variables {name}, {shopname}, {mobile}, {email}
  const protectedTokens = [];
  text = text.replace(/\{[^{}]+\}/g, (match) => {
    const id = `___PROT_${protectedTokens.length}___`;
    protectedTokens.push({ id, match });
    return id;
  });

  for (const item of replacements) {
    text = text.replace(item.regex, item.spintax);
  }

  for (const item of protectedTokens) {
    text = text.replace(item.id, item.match);
  }

  // Prepend greeting if none exists
  if (!text.match(/^\{[^{}]+\}/) && !text.match(/^(\s*hi|\s*hello|\s*hey|\s*dear)/i)) {
    if (!text.includes('{name}') && !text.includes('[name]')) {
      text = '{Hello|Hi|Greetings} {name},\n\n' + text;
    } else {
      text = '{Hello|Hi|Greetings},\n\n' + text;
    }
  }

  return text;
}

router.post('/campaigns/spintax-generate', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Message text is required' });
    }
    const spintaxText = generateSmartSpintax(text);
    return res.json({ spintaxText });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/campaigns/spintax-preview', async (req, res) => {
  try {
    const { text, count = 3 } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Message text is required' });
    }
    const samples = [];
    const sampleNames = ['Rahul Sharma', 'Priya Patel', 'Amit Verma', 'Sneha Gupta', 'Vikram Singh'];
    const sampleShops = ['Sharma Electronics', 'Patel Boutique', 'Amit Enterprises', 'Gupta Traders', 'Singh General Store'];
    const totalSamples = Math.min(5, Math.max(1, parseInt(count, 10) || 3));

    for (let i = 0; i < totalSamples; i++) {
      let preview = text;
      const dummyName = sampleNames[i % sampleNames.length];
      const dummyShop = sampleShops[i % sampleShops.length];
      const dummyMobile = '91987654321' + i;
      const dummyEmail = req.user?.email || 'customer@example.com';

      preview = preview.replace(/\{name\}/gi, dummyName);
      preview = preview.replace(/\[name\]/gi, dummyName);
      preview = preview.replace(/\{shopname\}/gi, dummyShop);
      preview = preview.replace(/\[shopname\]/gi, dummyShop);
      preview = preview.replace(/\{mobile\}/gi, dummyMobile);
      preview = preview.replace(/\[mobile\]/gi, dummyMobile);
      preview = preview.replace(/\{email\}/gi, dummyEmail);
      preview = preview.replace(/\[email\]/gi, dummyEmail);
      preview = parseSpintax(preview);
      samples.push(preview);
    }

    return res.json({ samples });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/campaigns', upload.single('media'), async (req, res) => {
  try {
    const { name, message_text, scheduled_at, contactsStr, anti_ban_mode, message_interval } = req.body;
    let contacts = [];
    if (contactsStr) {
      contacts = JSON.parse(contactsStr);
    }

    if (!contacts || contacts.length === 0) {
      return res.status(400).json({ error: 'No contacts selected for the campaign' });
    }

    const media_path = req.file ? req.file.path : null;
    const media_type = req.file ? getMediaType(req.file.mimetype) : null;

    const campaign = await createCampaign(req.user.id, {
      name,
      message_text,
      media_path,
      media_type,
      scheduled_at: scheduled_at || null,
      contacts,
      anti_ban_mode: anti_ban_mode || 'balanced',
      message_interval: parseInt(message_interval, 10) || 20
    });

    // Instantly wake up the campaign poller to begin sending
    triggerCampaignsPoller().catch(err => console.error('[Campaign Trigger Error]', err));

    return res.json({ message: 'Campaign created successfully', campaign });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/campaigns/:id/status', async (req, res) => {
  try {
    const { status } = req.body;

    // Validate ownership
    const campaign = await getCampaignById(req.params.id);
    if (!campaign || campaign.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // 'stopped' = permanent stop, 'paused' = resumable, 'running'/'pending' = resume
    const validStatuses = ['pending', 'running', 'paused', 'stopped', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status update' });
    }

    const updated = await updateCampaignStatus(req.params.id, status);

    // Resume: kick the poller if transitioning to pending or running
    if (status === 'pending' || status === 'running') {
      triggerCampaignsPoller().catch(err => console.error('[Campaign Trigger Error]', err));
    }

    return res.json({ message: 'Campaign status updated', campaign: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/campaigns/:id', async (req, res) => {
  try {
    const campaign = await getCampaignById(req.params.id);
    if (!campaign || campaign.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Mark stopped BEFORE deleting so the poller loop detects cancellation
    // (poller does getCampaignById; null result also signals stop)
    await updateCampaignStatus(req.params.id, 'stopped');
    await deleteCampaign(req.params.id);
    return res.json({ message: 'Campaign deleted successfully' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Birthday Wishes Endpoints ───────────────────────────────────────────────

router.get('/birthday-wishes', async (req, res) => {
  try {
    const wishes = await getBirthdayWishesByUser(req.user.id);
    return res.json(wishes);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/birthday-wishes', upload.single('media'), async (req, res) => {
  try {
    const { contact_id, recipient_name, recipient_phone, birthday_date, birth_year, message_text, send_time } = req.body;
    if (!recipient_name || !recipient_phone || !birthday_date || !message_text) {
      return res.status(400).json({ error: 'Name, phone, birthday date, and message text are required' });
    }
    const media_path = req.file ? req.file.path : null;
    const media_type = req.file ? getMediaType(req.file.mimetype) : null;

    const wish = await createBirthdayWish(req.user.id, {
      contact_id: contact_id ? parseInt(contact_id) : null,
      recipient_name,
      recipient_phone: normalizePhone(recipient_phone),
      birthday_date,
      birth_year,
      message_text,
      media_path,
      media_type,
      send_time: send_time || '09:00'
    });
    return res.json({ message: 'Birthday wish configured', wish });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/birthday-wishes/:id', async (req, res) => {
  try {
    await deleteBirthdayWish(req.params.id, req.user.id);
    return res.json({ message: 'Birthday wish deleted' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Payment Reminder Endpoints ─────────────────────────────────────────────

router.get('/payment-reminders', async (req, res) => {
  try {
    const reminders = await getPaymentRemindersByUser(req.user.id);
    return res.json(reminders);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/payment-reminders', upload.single('media'), async (req, res) => {
  try {
    const { contact_id, recipient_name, recipient_phone, amount, currency, due_date, message_text, remind_days_before } = req.body;
    if (!recipient_name || !recipient_phone || !due_date || !message_text) {
      return res.status(400).json({ error: 'Name, phone, due date, and message text are required' });
    }
    const media_path = req.file ? req.file.path : null;
    const media_type = req.file ? getMediaType(req.file.mimetype) : null;

    const reminder = await createPaymentReminder(req.user.id, {
      contact_id: contact_id ? parseInt(contact_id) : null,
      recipient_name,
      recipient_phone: normalizePhone(recipient_phone),
      amount: amount ? parseFloat(amount) : null,
      currency: currency || 'INR',
      due_date,
      message_text,
      media_path,
      media_type,
      remind_days_before: remind_days_before ? parseInt(remind_days_before) : 1
    });
    return res.json({ message: 'Payment reminder scheduled', reminder });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/payment-reminders/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const updated = await updatePaymentReminderStatus(req.params.id, req.user.id, status);
    return res.json({ message: 'Payment reminder status updated', reminder: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/payment-reminders/:id', async (req, res) => {
  try {
    await deletePaymentReminder(req.params.id, req.user.id);
    return res.json({ message: 'Payment reminder deleted' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Order Notifications Endpoints ──────────────────────────────────────────

router.get('/order-notifications', async (req, res) => {
  try {
    const notifications = await getOrderNotificationsByUser(req.user.id);
    return res.json(notifications);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/order-notifications', upload.single('media'), async (req, res) => {
  try {
    const { contact_id, recipient_name, recipient_phone, order_id, order_status, product_name, amount, currency, message_text, send_immediately, scheduled_at } = req.body;
    if (!recipient_name || !recipient_phone || !order_id || !message_text) {
      return res.status(400).json({ error: 'Name, phone, Order ID, and message text are required' });
    }
    const media_path = req.file ? req.file.path : null;
    const media_type = req.file ? getMediaType(req.file.mimetype) : null;

    const notif = await createOrderNotification(req.user.id, {
      contact_id: contact_id ? parseInt(contact_id) : null,
      recipient_name,
      recipient_phone: normalizePhone(recipient_phone),
      order_id,
      order_status: order_status || 'placed',
      product_name,
      amount: amount ? parseFloat(amount) : null,
      currency: currency || 'INR',
      message_text,
      media_path,
      media_type,
      send_immediately: send_immediately !== 'false' && send_immediately !== false,
      scheduled_at: scheduled_at || null
    });

    // If send_immediately, attempt sending right away
    if (notif.send_immediately) {
      const sessionStatus = getSessionStatus(req.user.id);
      if (sessionStatus && sessionStatus.status === 'CONNECTED') {
        const jid = notif.recipient_phone.includes('@') ? notif.recipient_phone : `${notif.recipient_phone}@s.whatsapp.net`;
        sendMessageToJid(req.user.id, jid, notif.message_text, notif.media_path, notif.media_type)
          .then(() => {
            updateOrderNotificationStatus(notif.id, req.user.id, 'sent', new Date().toISOString());
          })
          .catch(err => {
            console.error('[Order Notification Send Error]', err);
          });
      }
    }

    return res.json({ message: 'Order notification created', notification: notif });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/order-notifications/:id', async (req, res) => {
  try {
    await deleteOrderNotification(req.params.id, req.user.id);
    return res.json({ message: 'Order notification deleted' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Follow-up Automation Endpoints ─────────────────────────────────────────

router.get('/followup-automations', async (req, res) => {
  try {
    const automations = await getFollowupAutomationsByUser(req.user.id);
    return res.json(automations);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/followup-automations', upload.single('media'), async (req, res) => {
  try {
    const { name, trigger_event, delay_days, message_text, apply_to } = req.body;
    if (!name || !message_text) {
      return res.status(400).json({ error: 'Automation name and message text are required' });
    }
    const media_path = req.file ? req.file.path : null;
    const media_type = req.file ? getMediaType(req.file.mimetype) : null;

    const auto = await createFollowupAutomation(req.user.id, {
      name,
      trigger_event: trigger_event || 'no_response',
      delay_days: delay_days ? parseInt(delay_days) : 3,
      message_text,
      media_path,
      media_type,
      apply_to: apply_to || 'all'
    });
    return res.json({ message: 'Follow-up automation created', automation: auto });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/followup-automations/:id', async (req, res) => {
  try {
    const updated = await updateFollowupAutomation(req.params.id, req.user.id, req.body);
    return res.json({ message: 'Follow-up automation updated', automation: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/followup-automations/:id', async (req, res) => {
  try {
    await deleteFollowupAutomation(req.params.id, req.user.id);
    return res.json({ message: 'Follow-up automation deleted' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/followup-logs', async (req, res) => {
  try {
    const logs = await getFollowupLogsByUser(req.user.id);
    return res.json(logs);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/followup-logs/:id', async (req, res) => {
  try {
    await deleteFollowupLog(req.params.id, req.user.id);
    return res.json({ message: 'Follow-up log deleted' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Live Two-Way Team Inbox Routes ──────────────────────────────────────────

router.get('/inbox/conversations', async (req, res) => {
  try {
    const conversations = await getInboxConversations(req.user.id);
    return res.json({ conversations: conversations || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/inbox/messages/:phone', async (req, res) => {
  try {
    const cleanPhone = String(req.params.phone).replace(/[^0-9]/g, '');
    const messages = await getInboxMessagesByPhone(req.user.id, cleanPhone);
    // Mark as read
    await markInboxThreadAsRead(req.user.id, cleanPhone);
    return res.json({ messages: messages || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/inbox/send', async (req, res) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message || !message.trim()) {
      return res.status(400).json({ error: 'Phone number and message text are required' });
    }
    const cleanPhone = String(phone).replace(/[^0-9]/g, '');
    const trimmedMsg = message.trim();

    // Resolve LID to real phone number before sending.
    // Inbox conversations may store a WhatsApp LID (13+ digit internal ID) instead of a real
    // phone number. Sending to a LID@s.whatsapp.net fails silently — the message is never delivered.
    let sendPhone = cleanPhone;
    if (cleanPhone.length > 12) {
      const resolved = await getPhoneByLid(req.user.id, cleanPhone);
      if (resolved) {
        console.log(`[Inbox Send] Resolved LID ${cleanPhone} → real phone ${resolved}`);
        sendPhone = resolved;
      } else {
        console.warn(`[Inbox Send] Phone ${cleanPhone} looks like a LID but no mapping found — sending as-is`);
      }
    }

    // Send via WhatsApp using the resolved real phone number
    await sendMessageToJid(String(req.user.id), sendPhone, trimmedMsg);
    // Explicitly save outbound message to inbox DB so it appears immediately on reload
    // Use the ORIGINAL cleanPhone (not sendPhone) so the message stays in the same conversation thread
    await saveInboxMessage(req.user.id, {
      contact_phone: cleanPhone,
      message_text: trimmedMsg,
      direction: 'outbound'
    }).catch(err => console.error('[Inbox Outbound Save Error]', err.message));
    return res.json({ success: true, message: 'Message sent successfully' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/inbox/read/:phone', async (req, res) => {
  try {
    const cleanPhone = String(req.params.phone).replace(/[^0-9]/g, '');
    await markInboxThreadAsRead(req.user.id, cleanPhone);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/inbox/canned-replies', async (req, res) => {
  try {
    const replies = await getCannedRepliesByUser(req.user.id);
    return res.json({ cannedReplies: replies || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/inbox/canned-replies', async (req, res) => {
  try {
    const { shortcut, message } = req.body;
    if (!shortcut || !message) {
      return res.status(400).json({ error: 'Shortcut and message are required' });
    }
    const formattedShortcut = shortcut.startsWith('/') ? shortcut : `/${shortcut}`;
    const canned = await createCannedReply(req.user.id, {
      shortcut: formattedShortcut,
      message: message.trim()
    });
    return res.json({ message: 'Canned reply created', canned });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/inbox/canned-replies/:id', async (req, res) => {
  try {
    await deleteCannedReply(req.user.id, req.params.id);
    return res.json({ message: 'Canned reply deleted' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;

