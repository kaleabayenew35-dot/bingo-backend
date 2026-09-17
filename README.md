# Bingo Backend

Simple Express backend with SQLite for the Bingo app.

## Setup

1. Open a terminal in `backend`
2. Run `npm install`
3. Run `npm start` or `npm run dev`

## API Endpoints

- `GET /api/games` - list games
- `GET /api/games/:gameId` - get a game
- `POST /api/games` - create a game
- `PUT /api/games/:gameId` - update game stage/amount/players/status
- `POST /api/games/:gameId/bets` - place a bet
- `GET /api/games/:gameId/bets` - list bets for a game
- `GET /api/bets` - list all bets
