# Realtime Connect Four

A two-player real-time Connect Four game with lobby and room system, using Node.js, Express, and Socket.IO.

## Architecture

- **Backend/Frontend**: Single Node.js server (`server.js`) that serves static files from `public/` and handles real-time game logic via Socket.IO
- **Frontend**: Static HTML/CSS/JS in `public/` (no build step)
- **Port**: 5000

## User Flow

1. **Login Screen** - Enter a display name (2-20 chars)
2. **Lobby Screen** - View available game rooms, create new rooms, or join existing ones
3. **Game Screen** - Play Connect Four in a room. Includes rematch, reset, and leave room options

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
server.js          # Express + Socket.IO server with room management & game logic
public/
  index.html       # Multi-screen SPA (login, lobby, game)
  client.js        # Socket.IO client, screen management, game rendering
  styles.css       # Styles for all screens
  sounds/          # Win/lose/draw audio
package.json
```

## Game Features

- Multi-room lobby system
- Room creation with custom names
- Real-time room list updates
- Two-player Connect Four per room
- Disconnection handling (30s timeout before slot freed)
- Win/draw detection
- Rematch system (alternates who goes first)
- Game history tracking per room
- Reset game button
- Leave room to return to lobby
