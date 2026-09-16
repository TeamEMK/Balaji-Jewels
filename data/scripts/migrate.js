// Database schema chadhane ka script.
//
//   npm run db:migrate
//
// PostgreSQL aur MySQL 8 dono chalte hain. Kaunsa, ye .env ka DB_KIND tay
// karta hai (DATABASE_URL ke scheme se bhi pehchan lete hain), bilkul db.js
// ki tarah. Us hisaab se data/migrations/postgres/ ya data/migrations/mysql/ ki saari
// .sql files naam ke kram me chalti hain.
//
// Har chali hui file schema_migrations me darj hoti hai, isliye dobara
// chalane par pehle se lagayi migrations skip ho jaati hain.
require('dotenv').config();
const fs = require('fs');
const path = require('path');

if (!process.env.PGCLIENTENCODING) process.env.PGCLIENTENCODING = 'UTF8';

function pickDialect() {
  const explicit = (process.env.DB_KIND || '').trim().toLowerCase();
  if (explicit === 'mysql') return 'mysql';
  if (explicit === 'postgres' || explicit === 'postgresql') return 'postgres';
  if (explicit) throw new Error(`DB_KIND "${explicit}" samajh nahi aaya — 'postgres' ya 'mysql' likho.`);
  return /^mysql:\/\//i.test((process.env.DATABASE_URL || '').trim()) ? 'mysql' : 'postgres';
}

const DIALECT = pickDialect();
const dir = path.join(__dirname, '..', 'migrations', DIALECT);

if (!fs.existsSync(dir)) {
  console.error(`  ❌ ${path.relative(process.cwd(), dir)} nahi mila.`);
  console.error(`     Har client copy sirf ek database ke saath aati hai — .env me`);
  console.error(`     DB_KIND wahi rakho jo download karte waqt chuna tha.`);
  process.exit(1);
}

// ── Dono dialect ke liye ek jaisa chhota interface ────
// { connect, query(sql, params), begin, commit, rollback, tableCount, end }
async function openPostgres() {
  const { Client } = require('pg');
  const cfg = process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.PGSSL_DISABLE === 'true' ? false : { rejectUnauthorized: false },
      }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'task_manager',
        ssl: false,
      };
  const c = new Client(cfg);
  await c.connect();
  return {
    label: 'PostgreSQL',
    query: (sql, params) => c.query(sql, params).then(r => r.rows),
    ensureLog: () => c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT NOW()
    )`),
    markDone: f => c.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [f]),
    begin: () => c.query('BEGIN'),
    commit: () => c.query('COMMIT'),
    rollback: () => c.query('ROLLBACK'),
    tableCount: () => c.query(
      `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`
    ).then(r => r.rows[0].n),
    end: () => c.end(),
  };
}

async function openMysql() {
  const mysql = require('mysql2/promise');
  const base = { multipleStatements: true, charset: 'utf8mb4_general_ci' };
  const c = process.env.DATABASE_URL
    ? await mysql.createConnection({ uri: process.env.DATABASE_URL, ...base })
    : await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '3306', 10),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'task_manager',
        ...base,
      });
  return {
    label: 'MySQL',
    query: (sql, params) => c.query(sql, params).then(([rows]) => rows),
    ensureLog: () => c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename varchar(255) NOT NULL,
      applied_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (filename)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`),
    markDone: f => c.query('INSERT INTO schema_migrations (filename) VALUES (?)', [f]),
    // MySQL me DDL implicit commit karta hai — transaction se schema wapas
    // nahi mudta. Isliye yahan BEGIN/ROLLBACK ka dikhawa nahi karte; fail hone
    // par neeche saaf-saaf bata dete hain ki kya karna hai.
    begin: async () => {},
    commit: async () => {},
    rollback: async () => {},
    tableCount: () => c.query(
      `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE()`
    ).then(([rows]) => Number(rows[0].n)),
    end: () => c.end(),
  };
}

// Asli kaam — CLI (`npm run db:migrate`) aur server boot (auto-migrate,
// backend/server.js) dono isi ko bulaate hain. `throwOnFail` CLI ke liye true
// (ek migration fail ho to turant ruk jao, DB half-migrated maloom pade), aur
// server boot ke liye false (ek file fail ho to log karke agli try karo — poori
// app is wajah se boot hone se nahi rukni chahiye).
async function runMigrations({ throwOnFail = true, log = console.log } = {}) {
  const db = DIALECT === 'mysql' ? await openMysql() : await openPostgres();
  log(`  ${db.label} — data/migrations/${DIALECT}/`);
  try {
    await db.ensureLog();
    const done = new Set((await db.query('SELECT filename FROM schema_migrations')).map(r => r.filename));
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

    let applied = 0;
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      try {
        await db.begin();
        await db.query(sql);
        await db.markDone(f);
        await db.commit();
        log(`  ✅ migration: ${f}`);
        applied++;
      } catch (e) {
        await db.rollback().catch(() => {});
        // "Already exists" class ki error — is migration ka kaam pehle se hi
        // maujood hai. Aam taur par tab hota hai jab database phpMyAdmin/raw
        // SQL se seedha set up hua ho (schema_migrations kabhi bhara hi nahi),
        // isliye 001_init.sql jaisi purani migration "pending" dikhti hai par
        // uske tables/columns pehle se hain. Usse hard-fail maan ke rukne se
        // 001 hamesha atka reh jaata aur 005+ (asli naye) kabhi kabhi nahi
        // lagte — isliye "already applied" maan ke done mark karo, aage badho.
        const ALREADY_EXISTS = new Set([
          'ER_TABLE_EXISTS_ERROR', 'ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', // mysql
          '42P07', '42701', '42P06', '42710',                            // postgres
        ]);
        if (!throwOnFail && ALREADY_EXISTS.has(e.code)) {
          log(`  ⏭️  migration ${f} — already applied outside migrate.js (${e.code}), marking done`);
          await db.markDone(f).catch(() => {});
          continue;
        }
        const hint = DIALECT === 'mysql'
          ? ' (MySQL me DDL rollback nahi hota — aadhi tables ban chuki hongi.)'
          : '';
        log(`  ❌ migration ${f} failed: ${e.message}${hint}`);
        if (throwOnFail) throw e;
        // Server-boot mode, koi aur (genuine) error — is file ko chhod ke
        // aage mat badho, baaki files isi par depend kar sakti hain, galat
        // kram me lagana asli nuksaan hai.
        break;
      }
    }
    return { applied, total: await db.tableCount() };
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  runMigrations({ throwOnFail: true })
    .then(({ applied, total }) => {
      console.log(`\n  ${applied} migration lagi. Ab database me ${total} tables hain.`);
    })
    .catch(e => { console.error('migrate failed:', e.message); process.exit(1); });
} else {
  module.exports = { runMigrations };
}
