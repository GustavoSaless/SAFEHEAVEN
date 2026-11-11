// Banco de dados Postgres.
// Na nuvem: defina DATABASE_URL (ex.: Neon, Supabase) e o servidor usa o driver "pg".
// No computador: sem DATABASE_URL, usa o PGlite, um Postgres embutido que grava numa pasta. Nada para instalar.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            text NOT NULL,
  email           text NOT NULL UNIQUE,
  password_hash   text NOT NULL,
  role            text NOT NULL DEFAULT 'patient' CHECK (role IN ('patient','psychologist','admin')),
  status          text NOT NULL DEFAULT 'active'  CHECK (status IN ('active','pending','blocked')),
  crp             text,
  bamboo          integer NOT NULL DEFAULT 3,
  psychologist_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS access_keys (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code            text NOT NULL UNIQUE,
  psychologist_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label           text,
  used_by         integer REFERENCES users(id) ON DELETE SET NULL,
  used_at         timestamptz,
  expires_at      timestamptz NOT NULL,
  revoked         integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reminders (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       text NOT NULL,
  category   text NOT NULL DEFAULT 'Estudos',
  time       text NOT NULL DEFAULT '--:--',
  done       integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('user','ai')),
  message    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS live_messages (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id      integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  psychologist_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id       integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            text NOT NULL,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_pair ON live_messages (patient_id, psychologist_id, id);

CREATE TABLE IF NOT EXISTS prescriptions (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id      integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  psychologist_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           text NOT NULL,
  body            text NOT NULL DEFAULT '',
  frequency       text NOT NULL DEFAULT '',
  active          integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prescription_logs (
  prescription_id integer NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  day             date NOT NULL,
  PRIMARY KEY (prescription_id, day)
);

CREATE TABLE IF NOT EXISTS journal (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       text NOT NULL,
  mood       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feedback (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    integer REFERENCES users(id) ON DELETE SET NULL,
  message    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`

// Mesmo jeito de consultar nos dois motores: all() devolve as linhas, one() a primeira, run() quantas mudaram.
function wrap(query) {
  return {
    all: async (sql, params = []) => (await query(sql, params)).rows,
    one: async (sql, params = []) => (await query(sql, params)).rows[0],
    run: async (sql, params = []) => {
      const r = await query(sql, params)
      return { changes: r.rowCount ?? r.affectedRows ?? 0, rows: r.rows }
    },
  }
}

async function openPg(url) {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30_000 })
  // O Neon gratuito desliga o banco quando fica parado; a conexão ociosa cai e o pool reconecta sozinho.
  pool.on('error', (err) => console.warn('[banco] conexão ociosa encerrada:', err.message))
  await pool.query(SCHEMA)
  return {
    kind: 'postgres',
    ...wrap((sql, params) => pool.query(sql, params)),
    async tx(fn) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await fn(wrap((sql, params) => client.query(sql, params)))
        await client.query('COMMIT')
        return result
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
      } finally {
        client.release()
      }
    },
    close: () => pool.end(),
  }
}

async function openPglite(dir) {
  const { PGlite } = await import('@electric-sql/pglite')
  const db = dir ? new PGlite(dir) : new PGlite()
  await db.exec(SCHEMA)
  return {
    kind: dir ? `pglite (${dir})` : 'pglite (memória)',
    ...wrap((sql, params) => db.query(sql, params)),
    tx: (fn) => db.transaction((t) => fn(wrap((sql, params) => t.query(sql, params)))),
    close: () => db.close(),
  }
}

// openDb({ url }) para a nuvem, openDb({ dir }) para uma pasta local, openDb() para um banco só na memória (testes).
export function openDb({ url, dir } = {}) {
  return url ? openPg(url) : openPglite(dir)
}
