const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const ROWS = 6;
const COLS = 7;
const COLORS = ["red", "yellow"];

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
const socketInfo = new Map();
const clientIdToSession = new Map();

function createEmptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function normalizeName(name) {
  return String(name ?? "").trim().replace(/\s+/g, " ").slice(0, 20);
}

function isValidName(name) {
  return typeof name === "string" && name.length >= 2 && name.length <= 20;
}

function generateRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function createRoom(name, creatorName) {
  const id = generateRoomId();
  const room = {
    id,
    name: name || `${creatorName}'s Room`,
    players: [null, null],
    board: createEmptyBoard(),
    history: [],
    gameNumber: 0,
    gameActive: false,
    winnerSlot: null,
    isDraw: false,
    currentTurn: null,
    currentStarter: null,
    nextStarter: null,
    rematchReady: [false, false],
    startedOnce: false,
    createdAt: Date.now()
  };
  rooms.set(id, room);
  return room;
}

function getRoomPublicPlayers(room) {
  return room.players.map((player, slot) => {
    if (!player) return null;
    return {
      slot,
      name: player.name,
      color: player.color,
      connected: player.connected
    };
  });
}

function bothPlayersPresent(room) {
  return room.players.filter(Boolean).length === 2;
}

function bothPlayersConnected(room) {
  return room.players.every((p) => p && p.connected);
}

function getRoomStatePayload(room) {
  return {
    roomId: room.id,
    roomName: room.name,
    players: getRoomPublicPlayers(room),
    board: room.board,
    history: room.history,
    gameNumber: room.gameNumber,
    gameActive: room.gameActive,
    winnerSlot: room.winnerSlot,
    winnerName:
      room.winnerSlot !== null ? room.players[room.winnerSlot]?.name ?? null : null,
    isDraw: room.isDraw,
    currentTurn: room.currentTurn,
    currentTurnName:
      room.currentTurn !== null ? room.players[room.currentTurn]?.name ?? null : null,
    currentStarter: room.currentStarter,
    currentStarterName:
      room.currentStarter !== null
        ? room.players[room.currentStarter]?.name ?? null
        : null,
    rematchReady: room.rematchReady,
    bothConnected: bothPlayersConnected(room)
  };
}

function broadcastRoomState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(roomId).emit("room_state", getRoomStatePayload(room));
}

function getRoomList() {
  const list = [];
  for (const [id, room] of rooms) {
    const playerCount = room.players.filter(Boolean).length;
    list.push({
      id,
      name: room.name,
      playerCount,
      players: getRoomPublicPlayers(room),
      gameActive: room.gameActive,
      isFull: playerCount >= 2
    });
  }
  list.sort((a, b) => b.playerCount - a.playerCount || rooms.get(b.id).createdAt - rooms.get(a.id).createdAt);
  return list;
}

function broadcastRoomList() {
  io.emit("room_list", getRoomList());
}

function addHistoryEntry(room, winnerSlot, isDraw) {
  room.history.push({
    game: room.gameNumber,
    timestamp: new Date().toISOString(),
    winner: isDraw ? "Draw" : room.players[winnerSlot]?.name ?? "Unknown",
    starter: room.players[room.currentStarter]?.name ?? "Unknown"
  });
}

function startGame(room) {
  if (!bothPlayersPresent(room)) return;

  let starterSlot;
  if (!room.startedOnce) {
    starterSlot = Math.random() < 0.5 ? 0 : 1;
    room.startedOnce = true;
    room.nextStarter = 1 - starterSlot;
  } else {
    starterSlot = room.nextStarter ?? (room.currentStarter === 0 ? 1 : 0);
    room.nextStarter = 1 - starterSlot;
  }

  room.gameNumber += 1;
  room.board = createEmptyBoard();
  room.gameActive = true;
  room.winnerSlot = null;
  room.isDraw = false;
  room.currentStarter = starterSlot;
  room.currentTurn = starterSlot;
  room.rematchReady = [false, false];

  io.to(room.id).emit("start_game", {
    gameNumber: room.gameNumber,
    starterSlot,
    starterName: room.players[starterSlot]?.name ?? "Unknown"
  });

  broadcastRoomState(room.id);
}

function finishGame(room, winnerSlot, isDraw) {
  room.gameActive = false;
  room.winnerSlot = winnerSlot;
  room.isDraw = isDraw;
  room.rematchReady = [false, false];
  addHistoryEntry(room, winnerSlot, isDraw);

  io.to(room.id).emit("game_over", {
    winnerSlot,
    winnerName: winnerSlot !== null ? room.players[winnerSlot]?.name ?? null : null,
    isDraw,
    history: room.history
  });

  broadcastRoomState(room.id);
}

function getLowestOpenRow(room, column) {
  for (let row = ROWS - 1; row >= 0; row -= 1) {
    if (!room.board[row][column]) return row;
  }
  return -1;
}

function boardIsFull(room) {
  return room.board.every((row) => row.every((cell) => Boolean(cell)));
}

function didMoveWin(room, row, col, color) {
  const directions = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1]
  ];

  for (const [dr, dc] of directions) {
    let count = 1;

    let r = row + dr;
    let c = col + dc;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS && room.board[r][c] === color) {
      count += 1;
      r += dr;
      c += dc;
    }

    r = row - dr;
    c = col - dc;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS && room.board[r][c] === color) {
      count += 1;
      r -= dr;
      c -= dc;
    }

    if (count >= 4) return true;
  }

  return false;
}

function removePlayerFromRoom(socketId) {
  const info = socketInfo.get(socketId);
  if (!info || !info.roomId) return;

  const room = rooms.get(info.roomId);
  if (!room) return;

  const slot = info.slot;
  if (slot !== undefined && room.players[slot]?.socketId === socketId) {
    room.players[slot] = null;
  }

  info.roomId = null;
  info.slot = undefined;

  const remainingPlayers = room.players.filter(Boolean).length;
  if (remainingPlayers === 0) {
    rooms.delete(room.id);
  } else {
    room.gameActive = false;
    room.winnerSlot = null;
    room.isDraw = false;
    room.currentTurn = null;
    room.rematchReady = [false, false];
    room.startedOnce = false;
    room.board = createEmptyBoard();
    broadcastRoomState(room.id);
  }

  broadcastRoomList();
}

io.on("connection", (socket) => {
  socketInfo.set(socket.id, { name: null, roomId: null, slot: undefined, clientId: null });

  socket.emit("room_list", getRoomList());

  socket.on("set_name", (payload = {}) => {
    const name = normalizeName(payload.name);
    if (!isValidName(name)) {
      socket.emit("name_error", { message: "Name must be 2-20 characters." });
      return;
    }
    const clientId = String(payload.clientId || `client-${Math.random().toString(36).slice(2, 10)}`);
    const info = socketInfo.get(socket.id);
    info.name = name;
    info.clientId = clientId;

    const existingSession = clientIdToSession.get(clientId);
    if (existingSession && existingSession.roomId) {
      const room = rooms.get(existingSession.roomId);
      if (room && room.players[existingSession.slot] && !room.players[existingSession.slot].connected) {
        room.players[existingSession.slot].socketId = socket.id;
        room.players[existingSession.slot].connected = true;
        room.players[existingSession.slot].name = name;
        info.roomId = room.id;
        info.slot = existingSession.slot;
        socket.join(room.id);

        socket.emit("name_set", { name, clientId });
        socket.emit("joined_room", {
          roomId: room.id,
          roomName: room.name,
          slot: existingSession.slot,
          color: COLORS[existingSession.slot]
        });

        broadcastRoomState(room.id);
        broadcastRoomList();
        return;
      }
    }

    clientIdToSession.set(clientId, { roomId: null, slot: undefined });
    socket.emit("name_set", { name, clientId });
    socket.emit("room_list", getRoomList());
  });

  socket.on("create_room", (payload = {}) => {
    const info = socketInfo.get(socket.id);
    if (!info.name) {
      socket.emit("action_error", { message: "Set your name first." });
      return;
    }

    if (info.roomId) {
      socket.leave(info.roomId);
      removePlayerFromRoom(socket.id);
    }

    const roomName = normalizeName(payload.roomName) || `${info.name}'s Room`;
    const room = createRoom(roomName, info.name);

    room.players[0] = {
      name: info.name,
      color: COLORS[0],
      socketId: socket.id,
      connected: true
    };

    info.roomId = room.id;
    info.slot = 0;
    socket.join(room.id);

    if (info.clientId) {
      clientIdToSession.set(info.clientId, { roomId: room.id, slot: 0 });
    }

    socket.emit("joined_room", {
      roomId: room.id,
      roomName: room.name,
      slot: 0,
      color: COLORS[0]
    });

    broadcastRoomState(room.id);
    broadcastRoomList();
  });

  socket.on("join_room", (payload = {}) => {
    const info = socketInfo.get(socket.id);
    if (!info.name) {
      socket.emit("action_error", { message: "Set your name first." });
      return;
    }

    const room = rooms.get(payload.roomId);
    if (!room) {
      socket.emit("action_error", { message: "Room not found." });
      return;
    }

    const openSlot = room.players.findIndex((p) => p === null);
    if (openSlot === -1) {
      socket.emit("action_error", { message: "Room is full." });
      return;
    }

    if (info.roomId) {
      socket.leave(info.roomId);
      removePlayerFromRoom(socket.id);
    }

    room.players[openSlot] = {
      name: info.name,
      color: COLORS[openSlot],
      socketId: socket.id,
      connected: true
    };

    info.roomId = room.id;
    info.slot = openSlot;
    socket.join(room.id);

    if (info.clientId) {
      clientIdToSession.set(info.clientId, { roomId: room.id, slot: openSlot });
    }

    socket.emit("joined_room", {
      roomId: room.id,
      roomName: room.name,
      slot: openSlot,
      color: COLORS[openSlot]
    });

    broadcastRoomState(room.id);
    broadcastRoomList();

    if (bothPlayersPresent(room) && !room.startedOnce) {
      startGame(room);
    }
  });

  socket.on("leave_room", () => {
    const info = socketInfo.get(socket.id);
    if (!info.roomId) return;

    if (info.clientId) {
      const session = clientIdToSession.get(info.clientId);
      if (session) {
        session.roomId = null;
        session.slot = undefined;
      }
    }

    const roomId = info.roomId;
    socket.leave(roomId);
    removePlayerFromRoom(socket.id);

    socket.emit("left_room");
    socket.emit("room_list", getRoomList());
  });

  socket.on("make_move", (payload = {}) => {
    const info = socketInfo.get(socket.id);
    if (!info.roomId) return;

    const room = rooms.get(info.roomId);
    if (!room) return;

    const slot = info.slot;
    if (slot === undefined) return;

    if (!room.gameActive) {
      socket.emit("action_error", { message: "Game is not active right now." });
      return;
    }

    if (!bothPlayersConnected(room)) {
      socket.emit("action_error", { message: "Opponent disconnected. Waiting for reconnection..." });
      return;
    }

    if (room.currentTurn !== slot) {
      socket.emit("action_error", { message: "Wait for your turn." });
      return;
    }

    const column = Number(payload.column);
    if (!Number.isInteger(column) || column < 0 || column >= COLS) {
      socket.emit("action_error", { message: "Invalid column." });
      return;
    }

    const row = getLowestOpenRow(room, column);
    if (row === -1) {
      socket.emit("action_error", { message: "Column is full." });
      return;
    }

    const color = room.players[slot].color;
    room.board[row][column] = color;

    if (didMoveWin(room, row, column, color)) {
      finishGame(room, slot, false);
      return;
    }

    if (boardIsFull(room)) {
      finishGame(room, null, true);
      return;
    }

    room.currentTurn = 1 - room.currentTurn;
    broadcastRoomState(room.id);
  });

  socket.on("request_rematch", () => {
    const info = socketInfo.get(socket.id);
    if (!info.roomId) return;

    const room = rooms.get(info.roomId);
    if (!room) return;

    const slot = info.slot;
    if (slot === undefined) return;
    if (room.gameActive) return;
    if (room.winnerSlot === null && !room.isDraw) return;

    room.rematchReady[slot] = true;

    io.to(room.id).emit("rematch_status", {
      rematchReady: room.rematchReady,
      readyNames: room.rematchReady
        .map((isReady, index) => (isReady ? room.players[index]?.name : null))
        .filter(Boolean)
    });

    broadcastRoomState(room.id);

    if (room.rematchReady.every(Boolean) && bothPlayersPresent(room) && bothPlayersConnected(room)) {
      startGame(room);
    }
  });

  socket.on("reset_game", () => {
    const info = socketInfo.get(socket.id);
    if (!info.roomId) return;

    const room = rooms.get(info.roomId);
    if (!room) return;

    room.board = createEmptyBoard();
    room.history = [];
    room.gameNumber = 0;
    room.gameActive = false;
    room.winnerSlot = null;
    room.isDraw = false;
    room.currentTurn = null;
    room.currentStarter = null;
    room.nextStarter = null;
    room.rematchReady = [false, false];
    room.startedOnce = false;

    io.to(room.id).emit("game_reset");
    broadcastRoomState(room.id);

    if (bothPlayersPresent(room)) {
      startGame(room);
    }
  });

  socket.on("disconnect", () => {
    const info = socketInfo.get(socket.id);
    if (info && info.roomId) {
      const room = rooms.get(info.roomId);
      if (room && info.slot !== undefined && room.players[info.slot]) {
        room.players[info.slot].connected = false;
        room.players[info.slot].socketId = null;

        io.to(info.roomId).emit("opponent_disconnected", {
          slot: info.slot,
          message: "Opponent disconnected. Waiting for reconnection..."
        });

        broadcastRoomState(info.roomId);

        setTimeout(() => {
          const currentRoom = rooms.get(info.roomId);
          if (currentRoom && currentRoom.players[info.slot] && !currentRoom.players[info.slot].connected) {
            currentRoom.players[info.slot] = null;
            const remainingPlayers = currentRoom.players.filter(Boolean).length;
            if (remainingPlayers === 0) {
              rooms.delete(info.roomId);
            } else {
              currentRoom.gameActive = false;
              currentRoom.winnerSlot = null;
              currentRoom.isDraw = false;
              currentRoom.currentTurn = null;
              currentRoom.rematchReady = [false, false];
              currentRoom.startedOnce = false;
              currentRoom.board = createEmptyBoard();
              broadcastRoomState(info.roomId);
            }
            broadcastRoomList();
          }
        }, 30000);
      }

      broadcastRoomList();
    }

    socketInfo.delete(socket.id);
  });
});

const parsedPort = Number(process.env.PORT);
const PORT = Number.isFinite(parsedPort) && parsedPort >= 0 ? parsedPort : 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Connect Four server running on http://0.0.0.0:${PORT}`);
});
