const socket = io();

const ROWS = 6;
const COLS = 7;
const CLIENT_ID_KEY = "connect4-client-id";
const SOUND_PREF_KEY = "connect4-sound-enabled";

let mySlot = null;
let myName = "";
let gameState = null;
let previousBoard = null;
let gameOverHandledFor = null;
let audioUnlocked = false;
let soundEnabled = localStorage.getItem(SOUND_PREF_KEY) !== "false";

const joinOverlay = document.getElementById("joinOverlay");
const joinForm = document.getElementById("joinForm");
const nameInput = document.getElementById("nameInput");
const joinError = document.getElementById("joinError");
const appShell = document.getElementById("appShell");
const waitingScreen = document.getElementById("waitingScreen");
const gameScreen = document.getElementById("gameScreen");
const youName = document.getElementById("youName");
const connectedCount = document.getElementById("connectedCount");
const statusText = document.getElementById("statusText");
const resultBanner = document.getElementById("resultBanner");
const disconnectBanner = document.getElementById("disconnectBanner");
const rematchArea = document.getElementById("rematchArea");
const rematchBtn = document.getElementById("rematchBtn");
const rematchStatus = document.getElementById("rematchStatus");
const historyList = document.getElementById("historyList");
const soundToggle = document.getElementById("soundToggle");
const audioHint = document.getElementById("audioHint");
const boardEl = document.getElementById("board");
const boardColumnsEl = document.getElementById("boardColumns");
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

function getClientId() {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = `c4-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

function setSoundToggleLabel() {
  soundToggle.textContent = soundEnabled ? "Sound On" : "Sound Off";
  soundToggle.setAttribute("aria-pressed", soundEnabled ? "true" : "false");
}

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  audioHint.classList.add("hidden");

  // Prime audio after first gesture so future plays work on mobile browsers.
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

function playOutcomeSound(outcome) {
  if (!soundEnabled || !audioUnlocked) return;
  const sound = sounds[outcome];
  if (!sound) return;
  sound.currentTime = 0;
  sound.play().catch(() => {});
}

function buildBoard() {
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

function cellIndex(row, col) {
  return row * COLS + col;
}

function renderBoard(board) {
  const slots = boardEl.children;
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const value = board[row][col];
      const index = cellIndex(row, col);
      const slot = slots[index];
      slot.innerHTML = "";

      if (!value) continue;

      const disc = document.createElement("div");
      const changed =
        !previousBoard || previousBoard[row][col] !== value;
      disc.className = `disc ${value}${changed ? " drop" : ""}`;
      slot.appendChild(disc);
    }
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
    li.textContent = `Game ${item.game} — ${formatTime(item.timestamp)} — Winner: ${item.winner} — Started: ${item.starter}`;
    historyList.appendChild(li);
  });
}

function updatePlayerPanels(players, currentTurn) {
  players.forEach((player, slot) => {
    if (!player) {
      playerNames[slot].textContent = "Waiting…";
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
    statusText.textContent = "Waiting for another player to join…";
    return;
  }

  if (!bothConnected) {
    statusText.textContent = "Opponent disconnected. Waiting for reconnection…";
    return;
  }

  if (state.gameActive) {
    if (state.currentTurn === mySlot) {
      statusText.textContent = "Your turn";
    } else {
      statusText.textContent = `${state.currentTurnName}’s turn`;
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
    rematchStatus.textContent = "Starting rematch…";
  } else if (meReady) {
    rematchStatus.textContent = "Waiting for opponent…";
  } else {
    rematchStatus.textContent = "Ready for another game?";
  }
  rematchBtn.disabled = meReady;
}

function showScreenForState(state) {
  const playersPresent = state.players.filter(Boolean).length === 2;
  if (playersPresent) {
    waitingScreen.classList.add("hidden");
    gameScreen.classList.remove("hidden");
  } else {
    waitingScreen.classList.remove("hidden");
    gameScreen.classList.add("hidden");
  }
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

function renderState(state) {
  gameState = state;
  appShell.classList.remove("hidden");

  showScreenForState(state);
  renderStatus(state);
  renderHistory(state.history);
  updatePlayerPanels(state.players, state.currentTurn);
  connectedCount.textContent = String(state.players.filter((p) => p && p.connected).length);

  disconnectBanner.classList.toggle(
    "hidden",
    !(state.players.filter(Boolean).length === 2 && !state.bothConnected)
  );

  if (state.gameActive) {
    resultBanner.textContent = `${state.currentStarterName} starts`;
    gameOverHandledFor = null;
  }

  renderRematch(state);
  renderBoard(state.board);
  handleGameOver(state);
  previousBoard = state.board.map((row) => row.slice());
}

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = nameInput.value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 20) {
    joinError.textContent = "Please enter a name between 2 and 20 characters.";
    return;
  }
  myName = name;
  youName.textContent = myName;
  joinError.textContent = "";
  socket.emit("join", {
    name: myName,
    clientId: getClientId()
  });
});

soundToggle.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem(SOUND_PREF_KEY, String(soundEnabled));
  setSoundToggleLabel();
});

rematchBtn.addEventListener("click", () => {
  socket.emit("request_rematch");
});

["pointerdown", "keydown", "touchstart"].forEach((eventName) => {
  window.addEventListener(eventName, unlockAudio, { once: true, passive: true });
});

socket.on("join_success", (payload) => {
  mySlot = payload.slot;
  if (payload.player?.name) {
    myName = payload.player.name;
    youName.textContent = myName;
  }
  if (payload.clientId) {
    localStorage.setItem(CLIENT_ID_KEY, payload.clientId);
  }
  joinOverlay.classList.add("hidden");
  joinError.textContent = "";
});

socket.on("join_error", (payload) => {
  joinError.textContent = payload.message || "Unable to join.";
});

socket.on("room_full", (payload) => {
  joinError.textContent = payload.message || "Game is full.";
});

socket.on("lobby_update", (payload) => {
  connectedCount.textContent = String(payload.connectedPlayers ?? 0);
});

socket.on("start_game", (payload) => {
  resultBanner.textContent = `${payload.starterName} starts`;
});

socket.on("state_update", (state) => {
  renderState(state);
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

socket.on("opponent_disconnected", () => {
  disconnectBanner.classList.remove("hidden");
});

socket.on("action_error", (payload) => {
  statusText.textContent = payload.message || "That move is not allowed.";
});

buildBoard();
setSoundToggleLabel();
