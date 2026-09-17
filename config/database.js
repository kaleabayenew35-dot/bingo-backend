const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, '..', 'data', 'bingo.db');
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Failed to open database:', err.message);
    process.exit(1);
  }
  console.log('Connected to SQLite database.');
});

const initSql = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL UNIQUE,
  stage INTEGER NOT NULL DEFAULT 1,
  amount INTEGER NOT NULL DEFAULT 10,
  players INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'waiting',
  draw_sequence TEXT,
  draw_index INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  phone TEXT,
  balance INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS game_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (game_id) REFERENCES games(game_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES players(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (game_id) REFERENCES games(game_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES players(user_id) ON DELETE CASCADE
);
`;

// Execute base schema
db.exec(initSql, (err) => {
  if (err) {
    console.error('Failed to initialize database:', err.message);
    process.exit(1);
  }

  // After base tables, create stage/amount specific tables
  const amounts = [10, 20, 30, 50, 100, 200];
  const stages = [1, 2, 3];
  const tableStatements = [];

  stages.forEach((s) => {
    amounts.forEach((a) => {
      const tname = `stage${s}_${a}`;
      const stmt = `CREATE TABLE IF NOT EXISTS ${tname} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id TEXT NOT NULL,
        total_players INTEGER NOT NULL DEFAULT 0,
        mark TEXT,
        payout REAL DEFAULT 0,
        owner TEXT,
        winner_id TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME,
        meta TEXT,
        FOREIGN KEY (game_id) REFERENCES games(game_id) ON DELETE CASCADE,
        FOREIGN KEY (owner) REFERENCES players(user_id) ON DELETE SET NULL,
        FOREIGN KEY (winner_id) REFERENCES players(user_id) ON DELETE SET NULL
      );`;
      tableStatements.push(stmt);
    });
  });

  db.serialize(() => {
    tableStatements.forEach((sql) => {
      db.run(sql, (e) => {
        if (e) console.error('Failed to create table:', e.message);
      });
    });
  });
});

module.exports = db;
