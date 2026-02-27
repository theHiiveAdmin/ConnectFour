const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const ROWS = 6;
const COLS = 7;
const COLORS = ["red", "yellow"];
const MAX_PLAYERS = 2;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const state = {
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
  startedOnce: false
};

const socketToSlot = new Map();
const clientIdToSlot = new Map();

function createEmptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function normalizeName(name) {
  return String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 20);
}

function isValidName(name) {
  return typeof name === "string" && name.length >= 2 && name.length <= 20;
}

function connectedPlayersCount() {
  return state.players.filter((p) => p && p.connected).length;
}

function namedPlayersCount() {
  return state.players.filter(Boolean).length;
}

function bothPlayersPresent() {
  return namedPlayersCount() === MAX_PLAYERS;
}

function bothPlayersConnected() {
  return state.players.every((p) => p && p.connected);
}

function getPublicPlayers() {
  return state.players.map((player, slot) => {
    if (!player) return null;
    return {
      slot,
      name: player.name,
      color: player.color,
      connected: player.connected
    };
  });
}

function getStatePayload() {
  return {
    players: getPublicPlayers(),
    board: state.board,
    history: state.history,
    gameNumber: state.gameNumber,
    gameActive: state.gameActive,
    winnerSlot: state.winnerSlot,
    winnerName:
      state.winnerSlot !== null ? state.players[state.winnerSlot]?.name ?? null : null,
    isDraw: state.isDraw,
    currentTurn: state.currentTurn,
    currentTurnName:
      state.currentTurn !== null ? state.players[state.currentTurn]?.name ?? null : null,
    currentStarter: state.currentStarter,
    currentStarterName:
      state.currentStarter !== null
        ? state.players[state.currentStarter]?.name ?? null
        : null,
    rematchReady: state.rematchReady,
    bothConnected: bothPlayersConnected()
  };
}

function broadcastLobbyUpdate() {
  io.emit("lobby_update", {
    connectedPlayers: connectedPlayersCount(),
    namedPlayers: namedPlayersCount(),
    maxPlayers: MAX_PLAYERS,
    players: getPublicPlayers()
  });
}

function broadcastState() {
  io.emit("state_update", getStatePayload());
}

function addHistoryEntry(winnerSlot, isDraw) {
  state.history.push({
    game: state.gameNumber,
    timestamp: new Date().toISOString(),
    winner: isDraw ? "Draw" : state.players[winnerSlot]?.name ?? "Unknown",
    starter: state.players[state.currentStarter]?.name ?? "Unknown"
  });
}

function startGame(starterSlot) {
  if (!bothPlayersPresent()) return;

  state.gameNumber += 1;
  state.board = createEmptyBoard();
  state.gameActive = true;
  state.winnerSlot = null;
  state.isDraw = false;
  state.currentStarter = starterSlot;
  state.currentTurn = starterSlot;
  state.rematchReady = [false, false];

  io.emit("start_game", {
    gameNumber: state.gameNumber,
    starterSlot,
    starterName: state.players[starterSlot]?.name ?? "Unknown"
  });

  broadcastState();
}

function startFirstGameIfReady() {
  if (!bothPlayersPresent() || state.startedOnce) return;
  const randomStarter = Math.random() < 0.5 ? 0 : 1;
  state.startedOnce = true;
  state.nextStarter = 1 - randomStarter;
  startGame(randomStarter);
}

function finishGame(winnerSlot, isDraw) {
  state.gameActive = false;
  state.winnerSlot = winnerSlot;
  state.isDraw = isDraw;
  state.rematchReady = [false, false];
  addHistoryEntry(winnerSlot, isDraw);

  io.emit("game_over", {
    winnerSlot,
    winnerName: winnerSlot !== null ? state.players[winnerSlot]?.name ?? null : null,
    isDraw,
    history: state.history
  });

  broadcastState();
}

function getLowestOpenRow(column) {
  for (let row = ROWS - 1; row >= 0; row -= 1) {
    if (!state.board[row][column]) return row;
  }
  return -1;
}

function boardIsFull() {
  return state.board.every((row) => row.every((cell) => Boolean(cell)));
}

function didMoveWin(row, col, color) {
  // Win detection checks lines through the latest disc in all 4 directions.
  // If 4 or more contiguous matching discs are found, that move wins.
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
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS && state.board[r][c] === color) {
      count += 1;
      r += dr;
      c += dc;
    }

    r = row - dr;
    c = col - dc;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS && state.board[r][c] === color) {
      count += 1;
      r -= dr;
      c -= dc;
    }

    if (count >= 4) return true;
  }

  return false;
}

function registerPlayer(socket, name, clientId) {
  const existingSlot = clientIdToSlot.get(clientId);
  if (existingSlot !== undefined && state.players[existingSlot]) {
    const player = state.players[existingSlot];
    player.name = name;
    player.socketId = socket.id;
    player.connected = true;

    socketToSlot.set(socket.id, existingSlot);
    socket.emit("join_success", {
      slot: existingSlot,
      color: player.color,
      player: {
        name: player.name,
        slot: existingSlot,
        color: player.color
      },
      clientId
    });
    broadcastLobbyUpdate();
    broadcastState();
    return true;
  }

  const openSlot = state.players.findIndex((player) => player === null);
  if (openSlot === -1) {
    socket.emit("room_full", {
      message: "Game is full. Try again when a seat opens."
    });
    return false;
  }

  state.players[openSlot] = {
    name,
    color: COLORS[openSlot],
    socketId: socket.id,
    connected: true,
    clientId
  };

  clientIdToSlot.set(clientId, openSlot);
  socketToSlot.set(socket.id, openSlot);

  socket.emit("join_success", {
    slot: openSlot,
    color: COLORS[openSlot],
    player: {
      name,
      slot: openSlot,
      color: COLORS[openSlot]
    },
    clientId
  });

  broadcastLobbyUpdate();
  broadcastState();
  startFirstGameIfReady();
  return true;
}

io.on("connection", (socket) => {
  // Socket events:
  // - join(name, clientId): claims/reattaches a seat
  // - make_move(column): server-validated Connect Four move
  // - request_rematch: marks this player ready for rematch
  socket.emit("state_update", getStatePayload());
  socket.emit("lobby_update", {
    connectedPlayers: connectedPlayersCount(),
    namedPlayers: namedPlayersCount(),
    maxPlayers: MAX_PLAYERS,
    players: getPublicPlayers()
  });

  socket.on("join", (payload = {}) => {
    const name = normalizeName(payload.name);
    if (!isValidName(name)) {
      socket.emit("join_error", {
        message: "Name is required (2-20 characters)."
      });
      return;
    }

    const clientId = String(payload.clientId || `client-${Math.random().toString(36).slice(2, 10)}`);
    registerPlayer(socket, name, clientId);
  });

  socket.on("make_move", (payload = {}) => {
    const slot = socketToSlot.get(socket.id);
    if (slot === undefined) return;

    if (!state.gameActive) {
      socket.emit("action_error", { message: "Game is not active right now." });
      return;
    }

    if (!bothPlayersConnected()) {
      socket.emit("action_error", {
        message: "Opponent disconnected. Waiting for reconnection..."
      });
      return;
    }

    if (state.currentTurn !== slot) {
      socket.emit("action_error", { message: "Wait for your turn." });
      return;
    }

    const column = Number(payload.column);
    if (!Number.isInteger(column) || column < 0 || column >= COLS) {
      socket.emit("action_error", { message: "Invalid column." });
      return;
    }

    const row = getLowestOpenRow(column);
    if (row === -1) {
      socket.emit("action_error", { message: "Column is full." });
      return;
    }

    const color = state.players[slot].color;
    state.board[row][column] = color;

    if (didMoveWin(row, column, color)) {
      finishGame(slot, false);
      return;
    }

    if (boardIsFull()) {
      finishGame(null, true);
      return;
    }

    state.currentTurn = 1 - state.currentTurn;
    broadcastState();
  });

  socket.on("request_rematch", () => {
    const slot = socketToSlot.get(socket.id);
    if (slot === undefined) return;
    if (state.gameActive) return;
    if (state.winnerSlot === null && !state.isDraw) return;

    state.rematchReady[slot] = true;
    io.emit("rematch_status", {
      rematchReady: state.rematchReady,
      readyNames: state.rematchReady
        .map((isReady, index) => (isReady ? state.players[index]?.name : null))
        .filter(Boolean)
    });
    broadcastState();

    if (state.rematchReady.every(Boolean) && bothPlayersPresent() && bothPlayersConnected()) {
      const starter = state.nextStarter ?? (state.currentStarter === 0 ? 1 : 0);
      state.nextStarter = 1 - starter;
      startGame(starter);
    }
  });

  socket.on("reset_game", () => {
    state.players = [null, null];
    state.board = createEmptyBoard();
    state.history = [];
    state.gameNumber = 0;
    state.gameActive = false;
    state.winnerSlot = null;
    state.isDraw = false;
    state.currentTurn = null;
    state.currentStarter = null;
    state.nextStarter = null;
    state.rematchReady = [false, false];
    state.startedOnce = false;

    socketToSlot.clear();
    clientIdToSlot.clear();

    io.emit("game_reset");
    broadcastLobbyUpdate();
    broadcastState();
  });

  socket.on("disconnect", () => {
    const slot = socketToSlot.get(socket.id);
    if (slot === undefined) return;

    socketToSlot.delete(socket.id);
    const player = state.players[slot];
    if (player && player.socketId === socket.id) {
      player.connected = false;
      player.socketId = null;
      io.emit("opponent_disconnected", {
        slot,
        message: "Opponent disconnected. Waiting for reconnection..."
      });
    }

    broadcastLobbyUpdate();
    broadcastState();
  });
});

const parsedPort = Number(process.env.PORT);
const PORT = Number.isFinite(parsedPort) && parsedPort >= 0 ? parsedPort : 3000;
server.listen(PORT, "0.0.0.0", () => {
  // Replit-compatible bind for external/mobile access.
  // eslint-disable-next-line no-console
  console.log(`Connect Four server running on http://0.0.0.0:${PORT}`);
});
