const express = require('express');
const app = express();
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http);

const activeUsers = new Set(); // ✅ memory-only active user tracker

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

io.on('connection', (socket) => {
  console.log('A user connected');

  socket.on('new user', (username) => {
    socket.username = username;
    activeUsers.add(username);

    socket.broadcast.emit('system message', `${username} joined the chat`);
    socket.emit('system message', `You joined the chat`);

    io.emit('active users', activeUsers.size);
  });

  socket.on('chat message', ({ username, message }) => {
    io.emit('chat message', { username, message });
  });

  socket.on('disconnect', () => {
    if (socket.username) {
      activeUsers.delete(socket.username);
      io.emit('system message', `${socket.username} left the chat`);
      io.emit('active users', activeUsers.size);
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
