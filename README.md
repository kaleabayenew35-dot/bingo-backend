# Bingo Backend

Express backend with PostgreSQL for the Bingo app.

## Setup

1. Open a terminal in `bingo_backend`
2. Set `DATABASE_URL` to your PostgreSQL connection string.
3. Run `npm install`
4. Run `npm start` or `npm run dev`

## API Endpoints

- `GET /api/games` - list games
- `GET /api/games/:gameId` - get a game
- `POST /api/games` - create a game
- `PUT /api/games/:gameId` - update game amount/players/status
- `POST /api/games/:gameId/bets` - place a bet
- `GET /api/games/:gameId/bets` - list bets for a game
- `GET /api/bets` - list all bets
