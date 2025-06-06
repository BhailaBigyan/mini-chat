const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const bodyParser = require("body-parser");
const bcrypt = require("bcrypt");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const app = express();
const server = http.createServer(app);
const io = new Server(server);
// MongoDB connection

const MONGO_URI =
  "mongodb+srv://applebanana9862:dbminichat@mini-chat.r4hplqs.mongodb.net/?retryWrites=true&w=majority&appName=mini-chat";
mongoose.connect(MONGO_URI).then(() => console.log("MongoDB connected"));

// Models Defination
const Message = mongoose.model(
  "Message",
  new mongoose.Schema({
    username: String,
    message: String,
    room: String,
    timestamp: { type: Date, default: Date.now },
  })
);

const User = mongoose.model(
  "User",
  new mongoose.Schema({
    username: String,
    name: String,
    password: String,
  })
);

const PrivateRoom = mongoose.model(
  "PrivateRoom",
  new mongoose.Schema({
    code: { type: String, unique: true },
    nickname: { type: String, default: "Untitled Room" },
    owner: String,
    members: [String],
    createdAt: { type: Date, default: Date.now },
  })
);

// Session config
app.use(
  session({
    secret: "secret",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_URI }),
  })
);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));
app.set("view engine", "ejs");

// Routes
app.get("/", (req, res) => res.sendFile(__dirname + "/public/index.html"));
// app.get("/register", (req, res) =>
//   res.sendFile(__dirname + "/public/index.html")
// );
// app.get("/login", (req, res) => res.sendFile(__dirname + "/public/index.html"));
app.get("/chat", isAuth, (req, res) =>
  res.sendFile(__dirname + "/public/chat.html")
);
app.get("/chat-room", isAuth, (req, res) =>
  res.sendFile(__dirname + "/public/chat-room.html")
);
app.get("/private/:room", isAuth, (req, res) =>
  res.sendFile(__dirname + "/public/private.html")
);
app.get("/join", (req, res) => {
  res.sendFile(path.join(__dirname, "public/join.html"));
});
app.get("/delete-room", isAuth, (req, res) =>
  res.sendFile(__dirname + "/public/delete-room.html")
);

app.get("/get-username", async (req, res) => {
  if (!req.session.username) return res.json({});
  const user = await User.findOne({ username: req.session.username });
  res.json({ username: user.username, name: user.name });
});

app.get("/api/private-rooms", (req, res) =>
  res.json(Object.keys(privateRooms))
);

// Authentication
app.post("/register", async (req, res) => {
  const { username, name, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  await User.create({ username, name, password: hash });
  res.redirect("/");
});

app.post("/login", async (req, res) => {
  const user = await User.findOne({ username: req.body.username });
  if (user && (await bcrypt.compare(req.body.password, user.password))) {
    req.session.username = user.username;
    req.session.name = user.name || user.username;
    return res.redirect("/chat");
  }
  res.redirect("/");
});

function isAuth(req, res, next) {
  if (req.session.username) return next();
  res.redirect("/");
}

// Private rooms memory store
const privateRooms = {
  // 'roomCode': { nickname, owner, members: [], createdAt }
};

// Chatting configuration and System
io.on("connection", (socket) => {
  // Public Chat
  socket.on("new user", async (userData) => {
    socket.username = userData.username;
    const user = await User.findOne({ username: userData.username });
    socket.full_name = user?.name || userData.username;
    socket.join("public");

    const history = await Message.find({ room: "public" })
      .sort({ timestamp: 1 })
      .limit(100);
    socket.emit("chat history", history);
    socket
      .to("public")
      .emit("system message", `${socket.full_name} joined the chat`);
    io.to("public").emit("active users", getActiveCount("public"));
    console.log(socket.full_name, "joined the public chat");
  });

  socket.on("chat message", async (messageText) => {
    const username = socket.username;
    const full_name = socket.full_name || username;
    const room =
      Array.from(socket.rooms).find((r) => r !== socket.id) || "public";

    if (!username || !messageText) return;

    const msg = await Message.create({
      username: full_name,
      message: messageText,
      room,
    });

    io.to(room).emit("chat message", msg);
  });

  socket.on("join private", async ({ room, username }) => {
    socket.username = username;
    const user = await User.findOne({ username });
    socket.full_name = user?.name || username;
    socket.join(room);

    const existingRoom = await PrivateRoom.findOne({ code: room });

    if (existingRoom) {
      // Add member if not already present
      if (!existingRoom.members.includes(username)) {
        existingRoom.members.push(username);
        await existingRoom.save();
      }

      // Recompute nickname if it's still using default
      const allUsernames = [existingRoom.owner, ...existingRoom.members];
      const allUsers = await User.find({ username: { $in: allUsernames } });
      const nameList = allUsers.map((u) => u.name || u.username).sort();
      const generatedName = nameList.join(", ");

      if (
        existingRoom.nickname === existingRoom.owner ||
        existingRoom.nickname === ""
      ) {
        existingRoom.nickname = generatedName;
        await existingRoom.save();
      }
    }

    const history = await Message.find({ room })
      .sort({ timestamp: 1 })
      .limit(100);
    socket.emit("chat history", history);
    socket
      .to(room)
      .emit("system message", `${socket.full_name} joined private room`);
  });

  socket.on("disconnecting", () => {
    for (let room of socket.rooms) {
      if (room !== socket.id) {
        socket.to(room).emit("system message", `${socket.full_name} left`);
        console.log(socket.full_name, "disconnected from", room);
      }
    }
  });
});

function getActiveCount(room) {
  return io.sockets.adapter.rooms.get(room)?.size || 0;
}

// Create private room
app.get("/create-room", isAuth, async (req, res) => {
  const code = uuidv4().slice(0, 6);
  const ownerUsername = req.session.username;
  const owner = await User.findOne({ username: ownerUsername });
  const nickname = owner?.name || ownerUsername;

  await PrivateRoom.create({
    code,
    owner: ownerUsername,
    nickname,
    members: [],
  });

  privateRooms[code] = true;
  res.redirect(`/private/${code}`);
});

// Join private room
app.get("/api/my-private-rooms", isAuth, async (req, res) => {
  const username = req.session.username;

  // Find all rooms where the current user is in the `members` list
  const rooms = await PrivateRoom.find({ members: username });

  res.json(rooms);
});

//Edit private room name
app.post("/api/private-room/:code/edit-name", isAuth, async (req, res) => {
  const { code } = req.params;
  const { nickname } = req.body;
  const room = await PrivateRoom.findOne({ code });

  if (!room)
    return res.status(404).json({ success: false, error: "Room not found" });

  // Only allow owner or member to edit
  const username = req.session.username;
  if (room.owner !== username && !room.members.includes(username)) {
    return res.status(403).json({ success: false, error: "Not authorized" });
  }

  await PrivateRoom.updateOne({ code }, { $set: { nickname } });
  res.json({ success: true });
});

app.get("/api/private-room/:code/info", isAuth, async (req, res) => {
  const { code } = req.params;
  const room = await PrivateRoom.findOne({ code });
  if (!room) return res.status(404).json({ error: "Room not found" });

  const username = req.session.username;
  if (room.owner !== username && !room.members.includes(username)) {
    return res.status(403).json({ error: "Not authorized" });
  }

  res.json({ nickname: room.nickname });
});

// Handle 404
app.use((req, res) => {
  res.status(404).sendFile(__dirname + "/public/404.html");
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
