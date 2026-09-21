# Bingo Backend

The Bingo API is amount-only. Supported amounts are `10`, `20`, `30`, `50`, `100`, and `200`.

Game IDs use amount-specific prefixes: `A` for 10, `B` for 20, `C` for 30, `D` for 50, `E` for 100, and `F` for 200.

Public round endpoints:

- `GET /api/amount/:amount`
- `GET /api/amount/:amount/timer`
- `POST /api/amount/:amount/bet`
- `POST /api/amount/:amount/cancel`
- `GET /api/health`

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
