const express = require('express');
const router  = express.Router();
const db      = require('../db');

// GET /api/menu/:outletId
router.get('/:outletId', async (req, res) => {
  const outletId = parseInt(req.params.outletId);
  if (![1,2,3,4].includes(outletId)) {
    return res.status(400).json({ success: false, message: 'Invalid outlet ID' });
  }

  try {
    const [items] = await db.execute(
      `SELECT id, name, description, category, price, is_veg,
              is_available, daily_stock, sold_today, badge,
              avail_from, avail_to, img_url
       FROM menu_items
       WHERE outlet_id = ?
       ORDER BY category, name`,
      [outletId]
    );

    const [outlet] = await db.execute(
      'SELECT * FROM outlets WHERE id = ?', [outletId]
    );

    res.json({
      success: true,
      outlet:  outlet[0],
      menu:    items
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch menu' });
  }
});

module.exports = router;