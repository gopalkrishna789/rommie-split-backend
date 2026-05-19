/**
 * Database abstraction layer
 * - Uses MongoDB when MONGODB_URI is set
 * - Uses SQLite (better-sqlite3) when DATABASE_URL is not set (local dev)
 * - Uses PostgreSQL (pg) when DATABASE_URL is set (production)
 */
import dotenv from 'dotenv';
dotenv.config();

const USE_MONGODB = !!process.env.MONGODB_URI;
const USE_SQLITE = !USE_MONGODB && (!process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith('sqlite'));

let _query;
let _getClient;

if (USE_MONGODB) {
  // ── MongoDB adapter ─────────────────────────────────────────────────────
  console.log('📦 Using MongoDB database');
  
  const { connectMongoDB } = await import('./mongodb.js');
  await connectMongoDB();
  
  const mongoAdapter = await import('./mongoAdapter.js');
  _query = mongoAdapter.query;
  _getClient = mongoAdapter.getClient;

} else if (USE_SQLITE) {
  // ── SQLite adapter ──────────────────────────────────────────────────────
  const { default: Database } = await import('better-sqlite3');
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  const dbPath = process.env.SQLITE_PATH || path.join(__dirname, '../../../roomie.db');
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  console.log(`📦 Using SQLite database: ${dbPath}`);

  // Run migrations inline for SQLite
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
      name TEXT NOT NULL,
      invite_code TEXT UNIQUE NOT NULL,
      rent_amount INTEGER NOT NULL DEFAULT 450000,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
      room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT,
      upi_id TEXT NOT NULL,
      qr_code_base64 TEXT,
      color TEXT NOT NULL DEFAULT '#6366f1',
      avatar_initials TEXT NOT NULL,
      fcm_token TEXT,
      push_subscription TEXT,
      tour_completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
      room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
      payer_id TEXT REFERENCES members(id),
      purpose TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      notes TEXT,
      total_amount INTEGER NOT NULL,
      date TEXT NOT NULL DEFAULT (date('now')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS splits (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
      expense_id TEXT REFERENCES expenses(id) ON DELETE CASCADE,
      member_id TEXT REFERENCES members(id),
      share INTEGER NOT NULL,
      paid INTEGER NOT NULL DEFAULT 0,
      paid_at TEXT,
      carry_forward INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_splits_member   ON splits(member_id);
    CREATE INDEX IF NOT EXISTS idx_splits_expense  ON splits(expense_id);
    CREATE INDEX IF NOT EXISTS idx_expenses_room   ON expenses(room_id);
    CREATE INDEX IF NOT EXISTS idx_members_room    ON members(room_id);

    CREATE TABLE IF NOT EXISTS payment_attempts (
      id TEXT PRIMARY KEY,
      split_id TEXT NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
      member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      upi_app TEXT NOT NULL DEFAULT 'unknown',
      amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_payment_attempts_split  ON payment_attempts(split_id);
    CREATE INDEX IF NOT EXISTS idx_payment_attempts_member ON payment_attempts(member_id);
    CREATE INDEX IF NOT EXISTS idx_payment_attempts_status ON payment_attempts(status);

    CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
      member_name TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      amount INTEGER,
      expense_id TEXT REFERENCES expenses(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_activity_room ON activity_log(room_id);
    CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);

    -- Phase 1: user_rooms — allows one user (email) to belong to multiple rooms
    CREATE TABLE IF NOT EXISTS user_rooms (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
      email TEXT NOT NULL,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      joined_at TEXT DEFAULT (datetime('now')),
      UNIQUE(email, room_id)
    );
    CREATE INDEX IF NOT EXISTS idx_user_rooms_email ON user_rooms(email);
    CREATE INDEX IF NOT EXISTS idx_user_rooms_room  ON user_rooms(room_id);

    -- Phase 1: expense_edits — audit trail for expense changes
    CREATE TABLE IF NOT EXISTS expense_edits (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
      expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
      edited_by_id TEXT REFERENCES members(id) ON DELETE SET NULL,
      edited_by_name TEXT NOT NULL,
      field_changed TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      edited_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_expense_edits_expense ON expense_edits(expense_id);
  `);

  // Add new columns to existing databases (safe — ignored if column already exists)
  const alterStatements = [
    `ALTER TABLE expenses ADD COLUMN category TEXT NOT NULL DEFAULT 'other'`,
    `ALTER TABLE expenses ADD COLUMN notes TEXT`,
    `ALTER TABLE expenses ADD COLUMN receipt_base64 TEXT`,
    `ALTER TABLE expenses ADD COLUMN is_recurring INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE expenses ADD COLUMN recurring_day INTEGER`,
    `ALTER TABLE members ADD COLUMN email TEXT`,
    `ALTER TABLE members ADD COLUMN password_hash TEXT`,
    `ALTER TABLE members ADD COLUMN photo_base64 TEXT`,
    `ALTER TABLE members ADD COLUMN tour_completed INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE splits ADD COLUMN amount_paid INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE splits ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid'`,
    `ALTER TABLE rooms ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE rooms ADD COLUMN max_members INTEGER NOT NULL DEFAULT 10`,
    // Phase 1: audit trail for expense edits
    `ALTER TABLE expenses ADD COLUMN edit_history TEXT`,
    // Phase 1: split type for percentage/exclude modes
    `ALTER TABLE splits ADD COLUMN split_type TEXT NOT NULL DEFAULT 'equal'`,
    `ALTER TABLE splits ADD COLUMN split_percent REAL`,
    // Phase 2: soft delete for expenses
    `ALTER TABLE expenses ADD COLUMN deleted_at TEXT DEFAULT NULL`,
  ];
  for (const sql of alterStatements) {
    try { 
      db.exec(sql);
      console.log(`✅ Migration: ${sql.split('ADD COLUMN')[1]?.split('TEXT')[0]?.split('INTEGER')[0]?.trim() || 'executed'}`);
    } catch (err) { 
      // Column already exists — ignore
      if (!err.message.includes('duplicate column')) {
        console.warn(`⚠️  Migration warning: ${err.message}`);
      }
    }
  }

  // UUID v4 generator for SQLite (since it lacks uuid_generate_v4)
  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Translate PostgreSQL-style $1, $2 params to SQLite ? params
   * Also handles RETURNING clause (SQLite doesn't support it natively)
   */
  function translateQuery(text, params) {
    // Replace $1, $2... with ?
    let sql = text.replace(/\$(\d+)/g, '?');

    // SQLite uses 1/0 for booleans — convert boolean params
    const convertedParams = params
      ? params.map((p) => {
          if (p === true) return 1;
          if (p === false) return 0;
          if (p instanceof Date) return p.toISOString();
          return p;
        })
      : [];

    return { sql, convertedParams };
  }

  /**
   * Execute a query — returns { rows, rowCount } like pg
   */
  _query = async function query(text, params = []) {
    const start = Date.now();

    // Check if this is a RETURNING query
    const hasReturning = /RETURNING/i.test(text);
    const isSelect = /^\s*SELECT/i.test(text);
    const isInsert = /^\s*INSERT/i.test(text);
    const isUpdate = /^\s*UPDATE/i.test(text);
    const isDelete = /^\s*DELETE/i.test(text);

    // Strip RETURNING clause for SQLite — we'll fetch separately
    let returningCols = null;
    let cleanText = text;
    if (hasReturning) {
      const match = text.match(/RETURNING\s+(.*?)$/is);
      if (match) {
        returningCols = match[1].trim();
        cleanText = text.replace(/\s*RETURNING\s+.*$/is, '');
      }
    }

    // Handle uuid_generate_v4() — replace with our UUID
    cleanText = cleanText.replace(/uuid_generate_v4\(\)/gi, `'${generateUUID()}'`);

    // Handle NOW() → datetime('now')
    cleanText = cleanText.replace(/\bNOW\(\)/gi, "datetime('now')");

    // Handle CURRENT_DATE → date('now')
    cleanText = cleanText.replace(/\bCURRENT_DATE\b/gi, "date('now')");

    // Handle TIMESTAMPTZ → TEXT (SQLite has no types)
    cleanText = cleanText.replace(/TIMESTAMPTZ/gi, 'TEXT');

    // Handle COALESCE with SUM — SQLite handles this fine
    // Handle ::integer casts
    cleanText = cleanText.replace(/::\w+/g, '');

    const { sql, convertedParams } = translateQuery(cleanText, params);

    if (process.env.NODE_ENV === 'development') {
      console.log('DB query:', { sql: sql.slice(0, 100), duration: Date.now() - start });
    }

    try {
      if (isSelect) {
        const stmt = db.prepare(sql);
        const rows = stmt.all(...convertedParams);
        // Convert SQLite integers back to booleans for 'paid' field
        const normalizedRows = rows.map(normalizeRow);
        return { rows: normalizedRows, rowCount: normalizedRows.length };
      }

      if (isInsert || isUpdate || isDelete) {
        const stmt = db.prepare(sql);
        const info = stmt.run(...convertedParams);

        if (hasReturning && returningCols) {
          // Fetch the inserted/updated row
          let fetchSql;
          if (isInsert) {
            // Get last inserted row from the table
            const tableMatch = cleanText.match(/INSERT\s+INTO\s+(\w+)/i);
            const tableName = tableMatch ? tableMatch[1] : null;
            if (tableName) {
              fetchSql = `SELECT * FROM ${tableName} WHERE rowid = ${info.lastInsertRowid}`;
              const fetchStmt = db.prepare(fetchSql);
              const row = fetchStmt.get();
              return { rows: row ? [normalizeRow(row)] : [], rowCount: 1 };
            }
          } else if (isUpdate) {
            // For UPDATE ... WHERE id = $1, fetch by the first param (usually the id)
            const tableMatch = cleanText.match(/UPDATE\s+(\w+)/i);
            const whereMatch = cleanText.match(/WHERE\s+id\s*=\s*\?/i);
            if (tableMatch && whereMatch && convertedParams.length > 0) {
              fetchSql = `SELECT * FROM ${tableMatch[1]} WHERE id = ?`;
              const fetchStmt = db.prepare(fetchSql);
              // Find the id param — usually the first one for UPDATE SET ... WHERE id = $1
              // or the last one for UPDATE SET col=$2 WHERE id=$1
              const idParam = convertedParams[convertedParams.length - 1];
              const row = fetchStmt.get(idParam);
              return { rows: row ? [normalizeRow(row)] : [], rowCount: info.changes };
            }
          }
          return { rows: [], rowCount: info.changes };
        }

        return { rows: [], rowCount: info.changes };
      }

      // DDL or other
      db.exec(sql);
      return { rows: [], rowCount: 0 };
    } catch (err) {
      console.error('SQLite query error:', err.message, '\nSQL:', sql.slice(0, 200));
      throw err;
    }
  };

  _getClient = async function getClient() {
    // SQLite is synchronous — return a fake client
    return {
      query: _query,
      release: () => {},
    };
  };

  function normalizeRow(row) {
    if (!row) return row;
    const out = { ...row };
    // Convert 0/1 to false/true for boolean fields
    if ('paid' in out) out.paid = out.paid === 1 || out.paid === true;
    // Parse push_subscription JSON if stored as string
    if (out.push_subscription && typeof out.push_subscription === 'string') {
      try { out.push_subscription = JSON.parse(out.push_subscription); } catch {}
    }
    return out;
  }

} else {
  // ── PostgreSQL adapter ──────────────────────────────────────────────────
  const pg = await import('pg');
  const { Pool } = pg.default;

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  pool.on('error', (err) => console.error('PostgreSQL pool error:', err));
  console.log('🐘 Using PostgreSQL database');

  _query = async function query(text, params) {
    const start = Date.now();
    const res = await pool.query(text, params);
    if (process.env.NODE_ENV === 'development') {
      console.log('DB query:', { text: text.slice(0, 80), duration: Date.now() - start, rows: res.rowCount });
    }
    return res;
  };

  _getClient = async function getClient() {
    return pool.connect();
  };
}

export const query = _query;
export const getClient = _getClient;
export default { query: _query, getClient: _getClient };
