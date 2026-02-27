const socket = io();

const ROWS = 6;
const COLS = 7;
const SOUND_PREF_KEY = "connect4-sound-enabled";
const NAME_KEY = "connect4-player-name";
const CLIENT_ID_KEY = "connect4-client-id";

let mySlot = null;
let myName = "";
let currentRoomId = null;
let gameState = null;
let previousBoard = null;
let gameOverHandledFor = null;
let audioUnlocked = false;
let soundEnabled = localStorage.getItem(SOUND_PREF_KEY) !== "false";
let boardBuilt = false;

const loginScreen = document.getElementById("loginScreen");
const loginForm = document.getElementById("loginForm");
const nameInput = document.getElementById("nameInput");
const loginError = document.getElementById("loginError");

const lobbyScreen = document.getElementById("lobbyScreen");
const lobbyPlayerName = document.getElementById("lobbyPlayerName");
const createRoomBtn = document.getElementById("createRoomBtn");
const createRoomForm = document.getElementById("createRoomForm");
const roomNameInput = document.getElementById("roomNameInput");
const confirmCreateBtn = document.getElementById("confirmCreateBtn");
const cancelCreateBtn = document.getElementById("cancelCreateBtn");
const roomList = document.getElementById("roomList");
const noRoomsMsg = document.getElementById("noRoomsMsg");
const logoutBtn = document.getElementById("logoutBtn");

const gameScreenEl = document.getElementById("gameScreen");
const gameRoomName = document.getElementById("gameRoomName");
const waitingScreen = document.getElementById("waitingScreen");
const playScreen = document.getElementById("playScreen");
const youName = document.getElementById("youName");
const statusText = document.getElementById("statusText");
const resultBanner = document.getElementById("resultBanner");
const disconnectBanner = document.getElementById("disconnectBanner");
const turnBanner = document.getElementById("turnBanner");
const turnIndicatorDot = document.getElementById("turnIndicatorDot");
const turnIndicatorText = document.getElementById("turnIndicatorText");
const rematchArea = document.getElementById("rematchArea");
const rematchBtn = document.getElementById("rematchBtn");
const rematchStatus = document.getElementById("rematchStatus");
const historyList = document.getElementById("historyList");
const leaveRoomBtn = document.getElementById("leaveRoomBtn");
const startOverBtn = document.getElementById("startOverBtn");
const audioHint = document.getElementById("audioHint");
const boardEl = document.getElementById("board");
const boardColumnsEl = document.getElementById("boardColumns");

const soundToggle = document.getElementById("soundToggle");
const gameSoundToggle = document.getElementById("gameSoundToggle");

const playerCards = [
  document.getElementById("player0Card"),
  document.getElementById("player1Card")
];
const playerNames = [
  document.getElementById("player0Name"),
  document.getElementById("player1Name")
];
const playerConns = [
  document.getElementById("player0Conn"),
  document.getElementById("player1Conn")
];

const sounds = {
  win: new Audio("/sounds/win.wav"),
  lose: new Audio("/sounds/lose.wav"),
  draw: new Audio("/sounds/draw.wav")
};

Object.values(sounds).forEach((audio) => {
  audio.preload = "auto";
});

function showScreen(screen) {
  loginScreen.classList.add("hidden");
  lobbyScreen.classList.add("hidden");
  gameScreenEl.classList.add("hidden");
  screen.classList.remove("hidden");
}

function setSoundToggleLabels() {
  const label = soundEnabled ? "Sound On" : "Sound Off";
  const pressed = soundEnabled ? "true" : "false";
  soundToggle.textContent = label;
  soundToggle.setAttribute("aria-pressed", pressed);
  gameSoundToggle.textContent = label;
  gameSoundToggle.setAttribute("aria-pressed", pressed);
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem(SOUND_PREF_KEY, String(soundEnabled));
  setSoundToggleLabels();
}

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  audioHint.classList.add("hidden");
  Object.values(sounds).forEach((audio) => {
    audio.volume = 0;
    audio
      .play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = 1;
      })
      .catch(() => {
        audio.volume = 1;
      });
  });
}

let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playMoveSound() {
  if (!soundEnabled || !audioUnlocked) return;
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(520, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(260, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.12);
  } catch (e) {}
}

function playOutcomeSound(outcome) {
  if (!soundEnabled || !audioUnlocked) return;
  const sound = sounds[outcome];
  if (!sound) return;
  sound.currentTime = 0;
  sound.play().catch(() => {});
}

function buildBoard() {
  if (boardBuilt) return;
  boardBuilt = true;

  const fragment = document.createDocumentFragment();
  for (let i = 0; i < ROWS * COLS; i += 1) {
    const slot = document.createElement("div");
    slot.className = "slot";
    slot.dataset.index = String(i);
    fragment.appendChild(slot);
  }
  boardEl.appendChild(fragment);

  for (let col = 0; col < COLS; col += 1) {
    const button = document.createElement("button");
    button.className = "column-btn";
    button.type = "button";
    button.dataset.column = String(col);
    button.setAttribute("aria-label", `Drop disc in column ${col + 1}`);
    button.addEventListener("click", () => {
      socket.emit("make_move", { column: col });
    });
    button.addEventListener(
      "touchstart",
      (event) => {
        event.preventDefault();
        socket.emit("make_move", { column: col });
      },
      { passive: false }
    );
    boardColumnsEl.appendChild(button);
  }
}

function renderBoard(board) {
  const slots = boardEl.children;
  let hasNewDisc = false;
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const value = board[row][col];
      const index = row * COLS + col;
      const slot = slots[index];
      slot.innerHTML = "";
      if (!value) continue;
      const disc = document.createElement("div");
      const changed = !previousBoard || previousBoard[row][col] !== value;
      if (changed) hasNewDisc = true;
      disc.className = `disc ${value}${changed ? " drop" : ""}`;
      slot.appendChild(disc);
    }
  }
  if (hasNewDisc && previousBoard) {
    playMoveSound();
  }
}

function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function renderHistory(history) {
  historyList.innerHTML = "";
  if (!history.length) {
    const empty = document.createElement("li");
    empty.textContent = "No completed games yet.";
    historyList.appendChild(empty);
    return;
  }
  history.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = `Game ${item.game} - ${formatTime(item.timestamp)} - Winner: ${item.winner} - Started: ${item.starter}`;
    historyList.appendChild(li);
  });
}

function updatePlayerPanels(players, currentTurn) {
  players.forEach((player, slot) => {
    if (!player) {
      playerNames[slot].textContent = "Waiting...";
      playerConns[slot].textContent = "Disconnected";
      playerCards[slot].classList.remove("active-turn");
      return;
    }
    playerNames[slot].textContent = player.name;
    playerConns[slot].textContent = player.connected ? "Connected" : "Disconnected";
    if (currentTurn === slot) {
      playerCards[slot].classList.add("active-turn");
    } else {
      playerCards[slot].classList.remove("active-turn");
    }
  });
}

function renderStatus(state) {
  const playersPresent = state.players.filter(Boolean).length === 2;
  const bothConnected = state.bothConnected;

  if (!playersPresent) {
    statusText.textContent = "Waiting for another player to join...";
    return;
  }
  if (!bothConnected) {
    statusText.textContent = "Opponent disconnected. Waiting for reconnection...";
    return;
  }
  if (state.gameActive) {
    if (state.currentTurn === mySlot) {
      statusText.textContent = "Your turn";
    } else {
      statusText.textContent = `${state.currentTurnName}'s turn`;
    }
    return;
  }
  if (state.isDraw) {
    statusText.textContent = "Draw game";
    return;
  }
  if (state.winnerSlot !== null) {
    statusText.textContent = `${state.winnerName} wins!`;
  }
}

function renderRematch(state) {
  if (state.gameActive || (state.winnerSlot === null && !state.isDraw)) {
    rematchArea.classList.add("hidden");
    rematchStatus.textContent = "";
    return;
  }
  rematchArea.classList.remove("hidden");
  const meReady = state.rematchReady[mySlot];
  const oppSlot = mySlot === 0 ? 1 : 0;
  const oppReady = state.rematchReady[oppSlot];

  if (meReady && oppReady) {
    rematchStatus.textContent = "Starting rematch...";
  } else if (meReady) {
    rematchStatus.textContent = "Waiting for opponent...";
  } else {
    rematchStatus.textContent = "Ready for another game?";
  }
  rematchBtn.disabled = meReady;
}

function handleGameOver(state) {
  if (state.gameNumber === gameOverHandledFor) return;
  if (state.gameActive) return;
  if (state.winnerSlot === null && !state.isDraw) return;

  gameOverHandledFor = state.gameNumber;
  if (state.isDraw) {
    resultBanner.textContent = "Draw";
    playOutcomeSound("draw");
    return;
  }
  resultBanner.textContent = `${state.winnerName} wins!`;
  if (state.winnerSlot === mySlot) {
    playOutcomeSound("win");
  } else {
    playOutcomeSound("lose");
  }
}

function renderTurnBanner(state) {
  if (!state.gameActive || state.currentTurn === null) {
    turnBanner.classList.add("hidden");
    return;
  }

  const currentPlayer = state.players[state.currentTurn];
  if (!currentPlayer) {
    turnBanner.classList.add("hidden");
    return;
  }

  turnBanner.classList.remove("hidden");
  turnBanner.classList.remove("your-turn", "opponent-turn");
  turnIndicatorDot.classList.remove("red", "yellow");
  turnIndicatorDot.classList.add(currentPlayer.color);

  if (state.currentTurn === mySlot) {
    turnBanner.classList.add("your-turn");
    turnIndicatorText.textContent = "Your turn!";
  } else {
    turnBanner.classList.add("opponent-turn");
    turnIndicatorText.textContent = `${currentPlayer.name}'s turn`;
  }
}

function renderRoomState(state) {
  gameState = state;
  const playersPresent = state.players.filter(Boolean).length === 2;

  if (playersPresent) {
    waitingScreen.classList.add("hidden");
    playScreen.classList.remove("hidden");
  } else {
    waitingScreen.classList.remove("hidden");
    playScreen.classList.add("hidden");
  }

  renderStatus(state);
  renderHistory(state.history);
  updatePlayerPanels(state.players, state.currentTurn);

  disconnectBanner.classList.toggle(
    "hidden",
    !(playersPresent && !state.bothConnected)
  );

  if (state.gameActive) {
    resultBanner.textContent = `${state.currentStarterName} starts`;
    gameOverHandledFor = null;
  }

  renderTurnBanner(state);
  renderRematch(state);
  renderBoard(state.board);
  handleGameOver(state);
  previousBoard = state.board.map((row) => row.slice());

  if (!state.gameActive) {
    turnBanner.classList.add("hidden");
  }
}

function renderRoomList(roomsList) {
  roomList.innerHTML = "";

  if (!roomsList.length) {
    noRoomsMsg.classList.remove("hidden");
    return;
  }

  noRoomsMsg.classList.add("hidden");

  roomsList.forEach((room) => {
    const card = document.createElement("div");
    card.className = "room-card";

    const info = document.createElement("div");
    info.className = "room-card-info";

    const name = document.createElement("p");
    name.className = "room-card-name";
    name.textContent = room.name;

    const players = document.createElement("p");
    players.className = "room-card-players";
    const playerNamesList = room.players
      .filter(Boolean)
      .map((p) => p.name)
      .join(", ");
    players.textContent = `Players: ${playerNamesList || "None"} (${room.playerCount}/2)`;

    const status = document.createElement("p");
    status.className = "room-card-status";
    if (room.isFull && room.gameActive) {
      status.textContent = "In game";
      status.classList.add("in-game");
    } else if (room.isFull) {
      status.textContent = "Full";
      status.classList.add("full");
    } else {
      status.textContent = "Waiting for player...";
      status.classList.add("waiting");
    }

    info.appendChild(name);
    info.appendChild(players);
    info.appendChild(status);

    const joinBtn = document.createElement("button");
    joinBtn.className = "join-room-btn";
    joinBtn.type = "button";

    if (room.isFull) {
      joinBtn.textContent = "Full";
      joinBtn.disabled = true;
    } else {
      joinBtn.textContent = "Join";
      joinBtn.addEventListener("click", () => {
        socket.emit("join_room", { roomId: room.id });
      });
    }

    card.appendChild(info);
    card.appendChild(joinBtn);
    roomList.appendChild(card);
  });
}

function getClientId() {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = `c4-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = nameInput.value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 20) {
    loginError.textContent = "Please enter a name between 2 and 20 characters.";
    return;
  }
  loginError.textContent = "";
  socket.emit("set_name", { name, clientId: getClientId() });
});

logoutBtn.addEventListener("click", () => {
  myName = "";
  currentRoomId = null;
  mySlot = null;
  localStorage.removeItem(NAME_KEY);
  localStorage.removeItem(CLIENT_ID_KEY);
  showScreen(loginScreen);
  nameInput.value = "";
});

createRoomBtn.addEventListener("click", () => {
  createRoomForm.classList.remove("hidden");
  roomNameInput.focus();
});

cancelCreateBtn.addEventListener("click", () => {
  createRoomForm.classList.add("hidden");
  roomNameInput.value = "";
});

confirmCreateBtn.addEventListener("click", () => {
  const roomName = roomNameInput.value.trim();
  socket.emit("create_room", { roomName });
  createRoomForm.classList.add("hidden");
  roomNameInput.value = "";
});

roomNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    confirmCreateBtn.click();
  }
});

leaveRoomBtn.addEventListener("click", () => {
  socket.emit("leave_room");
});

startOverBtn.addEventListener("click", () => {
  if (confirm("Reset the game? This will restart for both players.")) {
    socket.emit("reset_game");
  }
});

rematchBtn.addEventListener("click", () => {
  socket.emit("request_rematch");
});

soundToggle.addEventListener("click", toggleSound);
gameSoundToggle.addEventListener("click", toggleSound);

["pointerdown", "keydown", "touchstart"].forEach((eventName) => {
  window.addEventListener(eventName, unlockAudio, { once: true, passive: true });
});

let lobbyPollInterval = null;

function startLobbyPolling() {
  stopLobbyPolling();
  socket.emit("get_rooms");
  lobbyPollInterval = setInterval(() => {
    socket.emit("get_rooms");
  }, 3000);
}

function stopLobbyPolling() {
  if (lobbyPollInterval) {
    clearInterval(lobbyPollInterval);
    lobbyPollInterval = null;
  }
}

socket.on("name_set", (payload) => {
  myName = payload.name;
  localStorage.setItem(NAME_KEY, myName);
  if (payload.clientId) {
    localStorage.setItem(CLIENT_ID_KEY, payload.clientId);
  }
  lobbyPlayerName.textContent = myName;
  youName.textContent = myName;
  showScreen(lobbyScreen);
  startLobbyPolling();
});

socket.on("name_error", (payload) => {
  loginError.textContent = payload.message || "Invalid name.";
});

socket.on("room_list", (list) => {
  renderRoomList(list);
});

socket.on("joined_room", (payload) => {
  currentRoomId = payload.roomId;
  mySlot = payload.slot;
  gameRoomName.textContent = payload.roomName;
  youName.textContent = myName;
  previousBoard = null;
  gameOverHandledFor = null;
  resultBanner.textContent = "";
  rematchArea.classList.add("hidden");
  buildBoard();
  stopLobbyPolling();
  showScreen(gameScreenEl);
});

socket.on("left_room", () => {
  currentRoomId = null;
  mySlot = null;
  gameState = null;
  previousBoard = null;
  gameOverHandledFor = null;
  showScreen(lobbyScreen);
  startLobbyPolling();
});

socket.on("room_state", (state) => {
  if (state.roomId !== currentRoomId) return;
  renderRoomState(state);
});

socket.on("start_game", (payload) => {
  resultBanner.textContent = `${payload.starterName} starts`;
});

socket.on("game_over", (payload) => {
  if (payload.isDraw) {
    resultBanner.textContent = "Draw";
    return;
  }
  resultBanner.textContent = `${payload.winnerName} wins!`;
});

socket.on("rematch_status", (payload) => {
  if (!payload.readyNames || payload.readyNames.length === 0) {
    rematchStatus.textContent = "";
    return;
  }
  rematchStatus.textContent = `Rematch ready: ${payload.readyNames.join(", ")}`;
});

socket.on("game_reset", () => {
  previousBoard = null;
  gameOverHandledFor = null;
  resultBanner.textContent = "";
  rematchArea.classList.add("hidden");
  rematchStatus.textContent = "";
});

socket.on("opponent_disconnected", () => {
  disconnectBanner.classList.remove("hidden");
});

socket.on("action_error", (payload) => {
  if (currentRoomId) {
    statusText.textContent = payload.message || "That action is not allowed.";
  } else {
    loginError.textContent = payload.message || "Something went wrong.";
  }
});

socket.on("connect", () => {
  const savedName = localStorage.getItem(NAME_KEY);
  if (savedName && savedName.length >= 2) {
    nameInput.value = savedName;
    socket.emit("set_name", { name: savedName, clientId: getClientId() });
  }
});

setSoundToggleLabels();
