const express  = require('express');
const router   = express.Router();
const Razorpay = require('razorpay');
const crypto   = require('crypto');
const db       = require('../db');
const { verifyToken } = require('./auth');
require('dotenv').config();

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// POST /api/payment/create-order
router.post('/create-order', verifyToken, async (req, res) => {
  const { amount_paise, outlet_id, cart, slot, notes } = req.body;

  try {
    const rzpOrder = await razorpay.orders.create({
      amount:   amount_paise,
      currency: 'INR',
      receipt:  `QB-${Date.now()}`
    });

    res.json({
      success:          true,
      razorpay_order_id: rzpOrder.id,
      amount:           rzpOrder.amount,
      currency:         rzpOrder.currency,
      key_id:           process.env.RAZORPAY_KEY_ID
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to create payment order' });
  }
});

// POST /api/payment/verify
router.post('/verify', verifyToken, async (req, res) => {
  const {
    razorpay_payment_id, razorpay_order_id, razorpay_signature,
    slot, outlet_id, cart, total, notes
  } = req.body;

  // 1. Verify signature
  const body      = razorpay_order_id + '|' + razorpay_payment_id;
  const expected  = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');

  if (expected !== razorpay_signature) {
    return res.status(400).json({ success: false, message: 'Payment verification failed' });
  }

  // 2. Save order to DB
  try {
    const subtotal     = cart.reduce((s, i) => s + i.price * i.qty, 0);
    const platform_fee = Math.round(subtotal * 0.02);
    const order_code   = `QB-${Date.now()}-${Math.floor(Math.random()*900)+100}`;
    const today        = new Date().toISOString().split('T')[0];

    const [orderResult] = await db.execute(
      `INSERT INTO orders
        (order_code, user_id, outlet_id, slot, subtotal, platform_fee, total,
         razorpay_order_id, razorpay_payment_id, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [order_code, req.user.id, outlet_id, slot, subtotal,
       platform_fee, total, razorpay_order_id, razorpay_payment_id, notes || '']
    );

    const orderId = orderResult.insertId;

    // 3. Assign unique token per item and insert order_items
    const tokenNumbers = [];
    for (const item of cart) {
      // Get next token for this outlet today
      await db.execute(
        `INSERT INTO token_counter (outlet_id, date, last_token)
         VALUES (?, ?, 1)
         ON DUPLICATE KEY UPDATE last_token = last_token + 1`,
        [outlet_id, today]
      );
      const [[counter]] = await db.execute(
        'SELECT last_token FROM token_counter WHERE outlet_id = ? AND date = ?',
        [outlet_id, today]
      );
      const token = counter.last_token;
      tokenNumbers.push({ itemId: item.id, itemName: item.name, token });

      await db.execute(
        `INSERT INTO order_items (order_id, item_id, item_name, qty, price, token_number)
         VALUES (?,?,?,?,?,?)`,
        [orderId, item.id, item.name, item.qty, item.price, token]
      );

      // Deduct from daily stock
      await db.execute(
        'UPDATE menu_items SET sold_today = sold_today + ? WHERE id = ?',
        [item.qty, item.id]
      );
    }

    // 4. Increment slot booking count
    await db.execute(
      `INSERT INTO slot_bookings (outlet_id, slot_time, slot_date, booked_count, capacity)
       VALUES (?, ?, ?, 1, 10)
       ON DUPLICATE KEY UPDATE booked_count = booked_count + 1`,
      [outlet_id, slot, today]
    );

    // 5. Emit real-time event to admin panel
    const io = req.app.get('io');
    const [userRows] = await db.execute(
      'SELECT name, college_id, email FROM users WHERE id = ?', [req.user.id]
    );
    const user = userRows[0];

    io.to(`outlet_${outlet_id}`).emit('new_order', {
      order_id:   order_code,
      orderId,
      student:    user.name,
      rollNo:     user.college_id,
      slot,
      total,
      items:      cart.map(i => ({ n: i.name, q: i.qty, p: i.price })),
      tokens:     tokenNumbers,
      status:     'pending',
      time:       new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' })
    });

    res.json({
      success:       true,
      order_id:      order_code,
      token_numbers: tokenNumbers
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Order placement failed' });
  }
});

module.exports = router;