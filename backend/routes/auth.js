
const express  = require('express');
const router   = express.Router();
const db       = require('../db');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const nodemailer= require('nodemailer');
require('dotenv').config();

// ── Email transporter ──
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  requireTLS: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ── Generate 6-digit OTP ──
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ── STUDENT: Send OTP ──
// POST /api/auth/send-otp
// Body: { email, college_id, name, department }
router.post('/send-otp', async (req, res) => {
  const { email, college_id, name, department } = req.body;
  if (!email || !college_id) {
    return res.status(400).json({ success: false, message: 'Email and College ID required' });
  }

  const otp     = generateOTP();
  const expiry  = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

  try {
    // Upsert user — create if not exists, update OTP if exists
    await db.execute(
  `INSERT INTO users (name, college_id, email, department, otp, otp_expiry)
   VALUES (?, ?, ?, ?, ?, ?)
   ON DUPLICATE KEY UPDATE
     otp = VALUES(otp),
     otp_expiry = VALUES(otp_expiry)`,
  [name || 'Student', college_id || email, email, department || '', otp, expiry]
);

    // Send OTP email
    if (process.env.DEMO_MODE !== 'true') {
      await transporter.sendMail({
        from:    `"QueueBuster" <${process.env.EMAIL_USER}>`,
        to:      email,
        subject: 'Your QueueBuster OTP',
        html:    `<h2>Your OTP is <b>${otp}</b></h2><p>Valid for 10 minutes.</p>`
      });
    } else {
      // In demo mode — log OTP to console so you can test
      console.log(`📧 DEMO OTP for ${email}: ${otp}`);
    }

    res.json({ success: true, message: 'OTP sent successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to send OTP' });
  }
});

// ── STUDENT: Verify OTP ──
// POST /api/auth/verify-otp
// Body: { email, otp }
router.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ success: false, message: 'Email and OTP required' });
  }

  try {
    const [rows] = await db.execute(
      'SELECT * FROM users WHERE email = ?', [email]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = rows[0];

    if (user.otp !== otp) {
      return res.status(401).json({ success: false, message: 'Invalid OTP' });
    }

    if (new Date() > new Date(user.otp_expiry)) {
      return res.status(401).json({ success: false, message: 'OTP expired' });
    }

    // Clear OTP after use
    await db.execute(
      'UPDATE users SET otp = NULL, otp_expiry = NULL WHERE id = ?', [user.id]
    );

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, college_id: user.college_id, role: 'student' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id:         user.id,
        name:       user.name,
        college_id: user.college_id,
        email:      user.email,
        department: user.department,
        role:       'student'
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Verification failed' });
  }
});

// ── ADMIN: Login ──
// POST /api/auth/admin-login
// Body: { admin_id, password, outlet_id }
router.post('/admin-login', async (req, res) => {
  const { admin_id, password, outlet_id } = req.body;
  if (!admin_id || !password) {
    return res.status(400).json({ success: false, message: 'Admin ID and password required' });
  }

  try {
    const [rows] = await db.execute(
      'SELECT * FROM admin_users WHERE admin_id = ? AND outlet_id = ?',
      [admin_id, outlet_id]
    );

    if (!rows.length) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const admin = rows[0];
    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: admin.id, outlet_id: admin.outlet_id, role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      success: true,
      token,
      outlet_id: admin.outlet_id,
      name:      admin.name
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// ── Middleware: verify JWT (used by other routes) ──
function verifyToken(req, res, next) {
  const header = req.headers['authorization'];
  const token  = header && header.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token' });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ message: 'Invalid token' });
    req.user = decoded;
    next();
  });
}

module.exports = router;
module.exports.verifyToken = verifyToken;