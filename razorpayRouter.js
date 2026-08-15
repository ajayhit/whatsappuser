import express from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { authMiddleware } from './middleware/authMiddleware.js';
import {
  getSetting, getPlanDetails, createRazorpayOrder,
  confirmRazorpayOrder, getRazorpayOrderByRazorpayId, getUserById
} from './db.js';
import { getSessionStatus, sendMessageToJid, initSession, waitForSessionState, hasSessionFiles } from './sessionManager.js';

const router = express.Router();

function getRazorpayInstance() {
  const key_id = getSetting('razorpay_key_id', process.env.RAZORPAY_KEY_ID || '');
  const key_secret = getSetting('razorpay_key_secret', process.env.RAZORPAY_KEY_SECRET || '');

  if (!key_id || !key_secret) {
    return null;
  }

  return {
    instance: new Razorpay({ key_id, key_secret }),
    key_id,
    key_secret
  };
}

/**
 * GET /razorpay/config
 * Returns public Razorpay key_id and enabled status
 */
router.get('/config', authMiddleware, (req, res) => {
  const key_id = getSetting('razorpay_key_id', process.env.RAZORPAY_KEY_ID || '');
  const key_secret = getSetting('razorpay_key_secret', process.env.RAZORPAY_KEY_SECRET || '');

  return res.json({
    enabled: Boolean(key_id && key_secret),
    key_id: key_id || null
  });
});

/**
 * POST /razorpay/create-order
 * Initialize a Razorpay payment order
 */
router.post('/create-order', authMiddleware, async (req, res) => {
  if (req.user.is_blocked === 1) {
    return res.status(403).json({ error: 'Your account is blocked.' });
  }

  const { plan_type, amount: customAmount } = req.body;
  const planType = plan_type || 'plan_28';

  const rzp = getRazorpayInstance();
  if (!rzp) {
    return res.status(400).json({
      error: 'Razorpay payment gateway is not configured by the admin yet.'
    });
  }

  try {
    let orderAmount = 0;

    if (planType === 'wallet') {
      orderAmount = parseFloat(customAmount || '0');
      if (orderAmount <= 0) {
        return res.status(400).json({ error: 'Recharge amount must be greater than 0.' });
      }
    } else {
      const details = getPlanDetails(planType);
      if (!details) {
        return res.status(400).json({ error: 'Invalid plan type selected.' });
      }
      orderAmount = details.price;
    }

    if (orderAmount <= 0) {
      return res.status(400).json({ error: 'Invalid order amount.' });
    }

    // Create order in Razorpay (amount is in paise: 1 INR = 100 paise)
    const options = {
      amount: Math.round(orderAmount * 100),
      currency: 'INR',
      receipt: `rcpt_${Date.now()}_u${req.user.id}`,
      notes: {
        user_id: String(req.user.id),
        user_email: req.user.email,
        plan_type: planType
      }
    };

    const razorpayOrder = await rzp.instance.orders.create(options);

    // Record order in SQLite
    const orderRecord = createRazorpayOrder({
      userId: req.user.id,
      amount: orderAmount,
      razorpayOrderId: razorpayOrder.id,
      planType
    });

    return res.status(201).json({
      success: true,
      key_id: rzp.key_id,
      razorpay_order_id: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      order_id: orderRecord.id,
      plan_type: planType,
      user: {
        name: req.user.name,
        email: req.user.email,
        phone: req.user.phone
      }
    });
  } catch (err) {
    console.error('[Razorpay] Create order error:', err);
    return res.status(500).json({ error: err.message || 'Failed to create Razorpay order' });
  }
});

/**
 * POST /razorpay/verify-payment
 * Verify Razorpay payment signature & auto-confirm order + activate plan
 */
router.post('/verify-payment', authMiddleware, async (req, res) => {
  if (req.user.is_blocked === 1) {
    return res.status(403).json({ error: 'Your account is blocked.' });
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing required payment verification parameters.' });
  }

  const rzp = getRazorpayInstance();
  if (!rzp) {
    return res.status(400).json({ error: 'Razorpay payment gateway is not configured.' });
  }

  try {
    // 1. Verify HMAC SHA256 Signature
    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac('sha256', rzp.key_secret)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      console.error('[Razorpay] Signature mismatch for order:', razorpay_order_id);
      return res.status(400).json({ error: 'Invalid payment signature. Verification failed.' });
    }

    // 2. Confirm order & activate plan in SQLite
    const result = confirmRazorpayOrder(razorpay_order_id, razorpay_payment_id);

    // 3. Send WhatsApp Notification (non-blocking)
    try {
      let adminSessionStatus = getSessionStatus('admin');
      if (adminSessionStatus.status !== 'CONNECTED' && hasSessionFiles('admin')) {
        try {
          initSession('admin').catch(e => console.error('[Razorpay Notify AutoInit Error]:', e));
          await waitForSessionState('admin', ['CONNECTED'], 3000);
          adminSessionStatus = getSessionStatus('admin');
        } catch (e) {}
      }

      if (adminSessionStatus.status === 'CONNECTED') {
        const user = getUserById(req.user.id);
        const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        const amount = result.order?.amount || 0;

        // Admin alert
        let adminNumber = getSetting('admin_whatsapp_number', '');
        if (!adminNumber && adminSessionStatus.user?.phone) {
          adminNumber = adminSessionStatus.user.phone;
        }
        const adminDigits = String(adminNumber || '').replace(/\D/g, '');
        if (adminDigits && adminDigits.length >= 10) {
          const adminMsg =
            `💳 *Online Payment Received (Razorpay)*\n\n` +
            `👤 User: ${user?.name || 'N/A'} (${user?.email || 'N/A'})\n` +
            `📱 Phone: ${user?.phone || 'N/A'}\n` +
            `💰 Amount: *₹${amount}*\n` +
            `🆔 Payment ID: ${razorpay_payment_id}\n` +
            `📋 Razorpay Order: ${razorpay_order_id}\n` +
            `🕐 Time: ${timestamp}\n\n` +
            `✅ Plan/Wallet activated automatically!`;
          await sendMessageToJid('admin', adminDigits, adminMsg);
        }

        // User confirmation
        const userDigits = user?.phone ? String(user.phone).replace(/\D/g, '') : '';
        if (userDigits && userDigits.length >= 10) {
          const userMsg =
            `🎉 *Payment Successful & Plan Activated!*\n\n` +
            `Hi ${user?.name || 'there'},\n` +
            `Your payment of *₹${amount}* via Razorpay was successful! ✅\n\n` +
            `🆔 Transaction ID: ${razorpay_payment_id}\n` +
            `🕐 Time: ${timestamp}\n\n` +
            `Your plan is active now. Thank you for subscribing! 🙏`;
          await sendMessageToJid('admin', userDigits, userMsg);
        }
      }
    } catch (notifyErr) {
      console.error('[Razorpay Notify] Non-fatal notification error:', notifyErr.message);
    }

    return res.json({
      success: true,
      message: 'Payment verified and plan activated successfully!',
      order: result.order,
      plan: result.plan
    });
  } catch (err) {
    console.error('[Razorpay] Payment verification error:', err);
    return res.status(500).json({ error: err.message || 'Payment verification failed' });
  }
});

export default router;
