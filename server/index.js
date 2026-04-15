require('dotenv').config();
const express     = require('express');
const http        = require('http');
const { Server }  = require('socket.io');
const mongoose    = require('mongoose');
const path        = require('path');
const cors        = require('cors');

const authRoutes    = require('./routes/auth');
const adminRoutes   = require('./routes/admin');
const managerRoutes = require('./routes/manager');
const { setupGameHandler } = require('./socket/gameHandler');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api/auth',    authRoutes);
app.use('/api/admin',   adminRoutes);
app.use('/api/manager', managerRoutes);

// Page routes
app.get('/',          (_, res) => res.sendFile(path.join(__dirname, '../public/pages/login.html')));
app.get('/register',  (_, res) => res.sendFile(path.join(__dirname, '../public/pages/register.html')));
app.get('/lobby',     (_, res) => res.sendFile(path.join(__dirname, '../public/pages/lobby.html')));
app.get('/game',      (_, res) => res.sendFile(path.join(__dirname, '../public/pages/game.html')));
app.get('/profile',   (_, res) => res.sendFile(path.join(__dirname, '../public/pages/profile.html')));
app.get('/admin',     (_, res) => res.sendFile(path.join(__dirname, '../public/pages/admin.html')));
app.get('/manager',   (_, res) => res.sendFile(path.join(__dirname, '../public/pages/manager.html')));

setupGameHandler(io);

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    server.listen(process.env.PORT || 3000, () =>
      console.log(`🚀 Server at http://localhost:${process.env.PORT || 3000}`)
    );
  })
  .catch(err => { console.error('❌ MongoDB error:', err); process.exit(1); });
