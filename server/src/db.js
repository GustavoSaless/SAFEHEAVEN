// SQLite embutido no próprio Node (22.13+ ou 24 LTS): nada para compilar, funciona igual no Windows e no Linux.
const emit = process.emitWarning
process.emitWarning = (warning, ...rest) => {
  if (String(warning?.message ?? warning).includes('SQLite is an experimental feature')) return
  return emit.call(process, warning, ...rest)
}
const { DatabaseSync } = await import('node:sqlite')

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'patient' CHECK (role IN ('patient','psychologist','admin')),
  status          TEXT NOT NULL DEFAULT 'active'  CHECK (status IN ('active','pending','blocked')),
  crp             TEXT,
  bamboo          INTEGER NOT NULL DEFAULT 3,
  psychologist_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS access_keys (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT NOT NULL UNIQUE,
  psychologist_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label           TEXT,
  used_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  used_at         TEXT,
  expires_at      TEXT NOT NULL,
  revoked         INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reminders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT 'Estudos',
  time       TEXT NOT NULL DEFAULT '--:--',
  done       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user','ai')),
  message    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS live_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  psychologist_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  read_at         TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS live_pair ON live_messages (patient_id, psychologist_id, id);

CREATE TABLE IF NOT EXISTS prescriptions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  psychologist_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL DEFAULT '',
  frequency       TEXT NOT NULL DEFAULT '',
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prescription_logs (
  prescription_id INTEGER NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  day             TEXT NOT NULL,
  PRIMARY KEY (prescription_id, day)
);

CREATE TABLE IF NOT EXISTS journal (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  mood       TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  message    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`

export function openDb(file = ':memory:') {
  const sqlite = new DatabaseSync(file)
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  sqlite.exec(SCHEMA)

  let depth = 0
  return {
    prepare: (sql) => sqlite.prepare(sql),
    exec: (sql) => sqlite.exec(sql),
    close: () => sqlite.close(),
    // Envolve fn numa transação: tudo é gravado junto ou nada é. Aceita transações dentro de transações.
    transaction(fn) {
      return (...args) => {
        const sp = `sp${depth}`
        sqlite.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${sp}`)
        depth++
        try {
          const result = fn(...args)
          depth--
          sqlite.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`)
          return result
        } catch (err) {
          depth--
          sqlite.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`)
          throw err
        }
      }
    },
  }
}
