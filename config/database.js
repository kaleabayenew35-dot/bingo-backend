const { Pool } = require('pg');
require('dotenv').config();
const { AMOUNTS, PREFIX_BY_AMOUNT } = require('./amounts');

const configuredDatabaseUrl = process.env.DATABASE_URL?.trim();
if (process.env.NODE_ENV === 'production' && (!configuredDatabaseUrl || configuredDatabaseUrl.endsWith('.db'))) {
  throw new Error('DATABASE_URL must be a PostgreSQL connection string in production.');
}

const databaseUrl = configuredDatabaseUrl || 'postgresql://postgres:password@localhost:5432/bingo';
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 10,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (error) => console.error('PostgreSQL pool error:', error.message));

function translateParams(sql) {
  let index = 0;
  return sql
    .replace(/\?/g, () => `$${++index}`)
    .replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO');
}

function addConflictHandling(sql) {
  if (/^\s*INSERT\s+INTO\s+/i.test(sql) && !/\bON\s+CONFLICT\b/i.test(sql)) {
    return `${sql.trim().replace(/;$/, '')} ON CONFLICT DO NOTHING`;
  }
  return sql;
}

function insertTable(sql) {
  return sql.match(/^\s*INSERT\s+INTO\s+([\w"]+)/i)?.[1]?.replace(/"/g, '').toLowerCase();
}

function addReturningId(sql) {
  const table = insertTable(sql);
  if (!table || /\bRETURNING\b/i.test(sql)) return sql;
  return `${sql.trim().replace(/;$/, '')} RETURNING id`;
}

async function query(sql, params = [], { returningId = false } = {}) {
  let statement = translateParams(sql);
  if (returningId) statement = addReturningId(statement);
  statement = addConflictHandling(statement);
  return pool.query(statement, params);
}

function callbackError(callback, error) {
  if (typeof callback === 'function') callback(error);
}

function normalizeRunArgs(args) {
  const values = [...args];
  const callback = typeof values[values.length - 1] === 'function' ? values.pop() : () => {};
  return { values, callback };
}

function run(sql, params = [], callback = () => {}) {
  if (typeof params === 'function') {
    callback = params;
    params = [];
  }
  databaseReady.then(async () => {
    const result = await query(sql, params, { returningId: true });
    callback.call({ lastID: result.rows[0]?.id, changes: result.rowCount || 0 }, null);
  }).catch((error) => callbackError(callback, error));
}

function prepare(sql) {
  return {
    run(...args) {
      const { values, callback } = normalizeRunArgs(args);
      run(sql, values, callback);
    },
  };
}

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS games (
    id SERIAL PRIMARY KEY,
    game_id TEXT NOT NULL UNIQUE,
    amount INTEGER NOT NULL DEFAULT 10,
    players INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'waiting',
    draw_sequence TEXT,
    draw_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS players (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL,
    phone TEXT,
    balance INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS game_players (
    id SERIAL PRIMARY KEY,
    game_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (game_id) REFERENCES games(game_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES players(user_id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS bets (
    id SERIAL PRIMARY KEY,
    game_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    number INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (game_id) REFERENCES games(game_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES players(user_id) ON DELETE CASCADE
  )`,
];

for (const amount of AMOUNTS) {
  schemaStatements.push(`
    CREATE TABLE IF NOT EXISTS amount_${amount} (
      id SERIAL PRIMARY KEY,
      game_id TEXT NOT NULL,
      total_players INTEGER NOT NULL DEFAULT 0,
      mark TEXT,
      payout REAL DEFAULT 0,
      owner TEXT,
      winner_id TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP,
      meta TEXT,
      FOREIGN KEY (game_id) REFERENCES games(game_id) ON DELETE CASCADE,
      FOREIGN KEY (owner) REFERENCES players(user_id) ON DELETE SET NULL,
      FOREIGN KEY (winner_id) REFERENCES players(user_id) ON DELETE SET NULL
    )
  `);
}

schemaStatements.push('ALTER TABLE games DROP COLUMN IF EXISTS stage');
for (const stage of [1, 2, 3]) {
  for (const amount of AMOUNTS) {
    schemaStatements.push(`DROP TABLE IF EXISTS stage${stage}_${amount} CASCADE`);
  }
}

async function seedInitialRounds() {
  for (const amount of AMOUNTS) {
    const prefix = PREFIX_BY_AMOUNT[amount];
    const gameId = `${prefix}1`;
    await query(
      `INSERT INTO games (game_id, amount, players, status)
       VALUES (?, ?, 0, 'waiting')
       ON CONFLICT (game_id) DO NOTHING`,
      [gameId, amount]
    );
    await query(
      `INSERT INTO amount_${amount} (game_id, total_players, mark, payout, owner, winner_id)
       SELECT ?, 0, NULL, 0, NULL, NULL
       WHERE NOT EXISTS (SELECT 1 FROM amount_${amount} WHERE game_id = ?)`,
      [gameId, gameId]
    );
  }
}

const databaseReady = (async () => {
  for (const statement of schemaStatements) await query(statement);
  await seedInitialRounds();
  console.log('PostgreSQL schema ready');
})().catch((error) => {
  console.error('PostgreSQL initialization failed:', error);
  throw error;
});

const db = {
  run,
  prepare,
  get(sql, params = [], callback = () => {}) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    databaseReady.then(() => query(sql, params))
      .then((result) => callback(null, result.rows[0]))
      .catch((error) => callbackError(callback, error));
  },
  all(sql, params = [], callback = () => {}) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    databaseReady.then(() => query(sql, params))
      .then((result) => callback(null, result.rows))
      .catch((error) => callbackError(callback, error));
  },
  serialize(callback) {
    callback();
  },
  close(callback = () => {}) {
    databaseReady.then(() => pool.end()).then(() => callback(null)).catch(callback);
  },
};

module.exports = db;
module.exports.databaseReady = databaseReady;
