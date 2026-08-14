require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');               // <-- added
const authRoutes = require('./routes/auth');

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// ---------- STATIC FRONTEND ----------
app.use(express.static(path.join(__dirname, '../../client-static')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../client-static/index.html'));
});
// ------------------------------------

app.use('/api/auth', authRoutes);

app.listen(process.env.PORT, () => {
  console.log(`🚀 Auth server running on port ${process.env.PORT}`);
});