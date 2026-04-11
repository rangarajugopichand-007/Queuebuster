const express = require('express');
const router  = express.Router();
const db      = require('../db');

// GET /api/slots/:outletId
// Returns available slots for today
router.get('/:outletId', async (req, res) => {
  const outletId = parseInt(req.params.outletId);
  const today    = new Date().toISOString().split('T')[0];

  try {
    const [outlet] = await db.execute(
      'SELECT open_time, close_time FROM outlets WHERE id = ?', [outletId]
    );
    if (!outlet.length) {
      return res.status(404).json({ success: false, message: 'Outlet not found' });
    }

    const { open_time, close_time } = outlet[0];

    // Get all bookings for this outlet today
    const [bookings] = await db.execute(
      `SELECT slot_time, booked_count, capacity, is_blocked
       FROM slot_bookings
       WHERE outlet_id = ? AND slot_date = ?`,
      [outletId, today]
    );

    const bookingMap = {};
    bookings.forEach(b => {
      bookingMap[b.slot_time] = b;
    });

    // Generate 10-min slots
    const slots  = [];
    const now    = new Date();
    now.setMinutes(now.getMinutes() + 10);
    const [oh,om]= open_time.split(':').map(Number);
    const [ch,cm]= close_time.split(':').map(Number);
    let h = oh, m = om;

    while (h < ch || (h === ch && m <= cm)) {
      const key  = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      const slotTime = new Date();
      slotTime.setHours(h, m, 0, 0);

      const booking   = bookingMap[key + ':00'] || bookingMap[key] || {};
      const booked    = booking.booked_count || 0;
      const capacity  = booking.capacity     || 10;
      const blocked   = booking.is_blocked   || false;

      slots.push({
        time:     key,
        is_past:  slotTime < now,
        is_full:  booked >= capacity,
        is_blocked: blocked,
        booked,
        capacity
      });

      m += 10;
      if (m >= 60) { h++; m = 0; }
    }

    res.json({ success: true, slots });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch slots' });
  }
});

module.exports = router;