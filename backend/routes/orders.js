const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { verifyToken } = require('./auth');

// GET /api/orders/live/:outletId — for admin panel
router.get('/live/:outletId', verifyToken, async (req, res) => {
  const outletId = req.params.outletId;
  try {
    const [orders] = await db.execute(
      `SELECT o.id, o.order_code, o.slot, o.total, o.status, o.placed_at,
              u.name as student, u.college_id as rollNo,
              GROUP_CONCAT(oi.item_name, ' x', oi.qty ORDER BY oi.id SEPARATOR ',') as items_summary,
GROUP_CONCAT(oi.token_number ORDER BY oi.id SEPARATOR ',') as token_numbers,
MIN(oi.token_number) as token_number
       FROM orders o
       JOIN users u ON o.user_id = u.id
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.outlet_id = ? AND DATE(o.placed_at) = CURDATE()
       GROUP BY o.id
       ORDER BY o.placed_at DESC`,
      [outletId]
    );
    res.json({ success: true, orders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
});
// GET /api/orders/my-orders — logged-in student's order history
router.get('/my-orders', verifyToken, async (req, res) => {
  try {
    const [orders] = await db.execute(
      `SELECT o.id, o.order_code, o.slot, o.subtotal, o.total,
              o.status, o.placed_at, o.outlet_id,
              GROUP_CONCAT(oi.item_name, ' ×', oi.qty SEPARATOR ', ') AS items_summary,
              GROUP_CONCAT(oi.token_number ORDER BY oi.id SEPARATOR ',') AS tokens
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.user_id = ?
       GROUP BY o.id
       ORDER BY o.placed_at DESC
       LIMIT 20`,
      [req.user.id]
    );
    res.json({ success: true, orders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
});
// GET /api/orders/:orderId — single order detail
router.get('/:orderId', verifyToken, async (req, res) => {
  try {
    const [orders] = await db.execute(
      `SELECT o.*, u.name as student, u.college_id, u.email
       FROM orders o JOIN users u ON o.user_id = u.id
       WHERE o.order_code = ?`,
      [req.params.orderId]
    );
    if (!orders.length) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    const [items] = await db.execute(
      'SELECT * FROM order_items WHERE order_id = ?', [orders[0].id]
    );
    res.json({ success: true, order: orders[0], items });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch order' });
  }
});

// PUT /api/orders/:orderId/status — admin updates status
router.put('/:orderId/status', verifyToken, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending','preparing','ready','completed','cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status' });
  }

  try {
    await db.execute(
      'UPDATE orders SET status = ? WHERE order_code = ?',
      [status, req.params.orderId]
    );

    // Emit status update to student
    const io = req.app.get('io');
    io.to(`order_${req.params.orderId}`).emit('status_update', { status });

    // Emit to admin room too so all admin tabs update
    const [orders] = await db.execute(
      'SELECT outlet_id FROM orders WHERE order_code = ?', [req.params.orderId]
    );
    if (orders.length) {
      io.to(`outlet_${orders[0].outlet_id}`).emit('order_status_changed', {
        order_id: req.params.orderId, status
      });
    }

    res.json({ success: true, message: 'Status updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update status' });
  }
});

module.exports = router;