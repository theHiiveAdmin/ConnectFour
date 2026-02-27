# Realtime Connect Four

A two-player real-time Connect Four game using Node.js, Express, and Socket.IO.

## Architecture

- **Backend/Frontend**: Single Node.js server (`server.js`) that serves static files from `public/` and handles real-time game logic via Socket.IO
- **Frontend**: Static HTML/CSS/JS in `public/` (no build step)
- **Port**: 5000

## Stack

- Node.js 20
- Express 4
- Socket.IO 4

## Running

```bash
npm start
```

This starts the server on port 5000.

## Project Structure

```
server.js          # Express + Socket.IO server with game logic
public/
  index.html       # Game UI
  client.js        # Socket.IO client + game rendering
  styles.css       # Styles
  sounds/          # Win/lose/draw audio
package.json
```

## Game Features

- Two-player real-time Connect Four
- Reconnection support via clientId
- Win/draw detection
- Rematch system (alternates who goes first)
- Game history tracking
