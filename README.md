# Real-Time Connect Four

Two-player, real-time Connect Four using Node.js, Express, Socket.IO, and plain HTML/CSS/JS.

## Features
- 7x6 classic Connect Four board with red/yellow discs
- Server-authoritative turn/move/win/draw logic
- Live multiplayer across desktop and mobile browsers
- Waiting room + connected player count
- Rematch flow (both players must confirm)
- Starter logic:
  - First game starter is random
  - Rematches alternate starter
- Disconnect handling with automatic resync on reconnect
- Game history (persists while server is running)
- Mobile-safe audio:
  - Local sound files in `public/sounds/`
  - Sound toggle
  - First-interaction audio unlock hint

## Run Locally (Mac)
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   npm start
   ```
3. Open:
   - `http://localhost:3000`

## Run on Replit
1. Import this project into Replit.
2. Run:
   ```bash
   npm install
   npm start
   ```
3. Replit will expose your app URL automatically.

## How to Join From Phone
- Open the same Replit Webview URL on your phone to join as Player 2.
- Both devices can be on Wi-Fi or cellular.
- If one player disconnects, the other sees a waiting message. Reconnecting to the same URL restores state.

## Project Structure
- `server.js` - Express + Socket.IO game server
- `public/index.html` - UI markup
- `public/styles.css` - responsive/mobile-first styling
- `public/client.js` - socket + UI + audio logic
- `public/sounds/` - local `win.wav`, `lose.wav`, `draw.wav`
