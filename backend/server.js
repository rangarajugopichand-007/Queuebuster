const express   = require('express');
const http      = require('http');
const { Server }= require('socket.io');
const cors      = require('cors');
const path      = require('path');
require('dotenv').config();

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] }
});

// ── Middleware ──
app.use(cors());
app.use(express.json());

// ── Serve frontend files ──
app.use(express.static(path.join(__dirname, '../frontend')));

// ── Routes ──
app.use('/api/auth',    require('./routes/auth'));
app.use('/api/menu',    require('./routes/menu'));
app.use('/api/orders',  require('./routes/orders'));
app.use('/api/payment', require('./routes/payment'));
app.use('/api/slots',   require('./routes/slots'));

// ── Socket.io ──
io.on('connection', socket => {
  console.log('🔌 Client connected:', socket.id);

  // Admin joins their outlet room
  socket.on('join_outlet', outletId => {
    socket.join(`outlet_${outletId}`);
    console.log(`Admin joined outlet_${outletId}`);
  });

  // Student joins their order room to get status updates
  socket.on('join_order', orderId => {
    socket.join(`order_${orderId}`);
  });

  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
  });
});

// Make io accessible in routes
app.set('io', io);

// ── Health check ──
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── Catch all — serve index.html for any unknown route ──
app.get('/*splat', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ── Start server ──
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 QueueBuster server running at http://localhost:${PORT}`);
});