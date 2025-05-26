const mongoose = require('mongoose');
const PrivateRoom = mongoose.model('PrivateRoom', new mongoose.Schema({
  code: { type: String, unique: true },
  nickname: { type: String, default: 'Untitled Room' },
  owner: String,
  members: [String],
  createdAt: { type: Date, default: Date.now }
}));

module.exports = mongoose.model('PrivateRoom', PrivateRoom);