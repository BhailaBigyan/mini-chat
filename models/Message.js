const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  username: String,
  message: String,
  room: String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Chat', chatSchema);
