// ══════════════════════════════════════════════════════
// MYSQL DRIVER  (Postgres-flavoured SQL ko MySQL me tarjuma)
// ══════════════════════════════════════════════════════
// server.js ke 247 DB calls mysql2 ke andaz me likhe hain, isliye is driver ka
// bada hissa seedha passthrough hai — mysql2 khud hi [rows, fields] deta hai
// aur insertId/affectedRows bhi.
//
// Par waqt ke saath app ki SQL me kuch Postgres-only cheezein aa gayi hain
// (ON CONFLICT, EXCLUDED, make_interval, date_trunc). Unhe har call site par
// badalne ke bajay yahi layer tarjuma kar deti hai — bilkul waise hi jaise
// db-postgres.js `?` ko `$1` banata hai. Nateeja: ek hi app code dono DB par
// chalta hai, .env ka DB_KIND tay karta hai kaunsa.
//
// db.js ise tab load karti hai jab DB_KIND=mysql ho (ya DATABASE_URL mysql://).

const mysql = require('mysql2/promise');

// ── 1. Double-quoted identifiers ─────────────────────
// App me 30 jagah `SELECT u.id AS "userId"` jaisa likha hai. Postgres me bina
// quote ke identifier lowercase ho jaata hai (userId -> userid) aur phir JS me
// row.userId undefined milta — isliye wahan quotes zaroori the.
//
// MySQL default me `"` ko STRING samajhta hai, to wahi query "userId" naam ka
// literal de deti — har row me ek hi value, koi error nahi, bas chup-chaap
// galat data. ANSI_QUOTES mode `"` ko identifier bana deta hai, yaani dono DB
// par matlab ek jaisa. Poori app me `"` sirf aliases me hai, kisi string
// literal me nahi (email templates ka HTML SQL ke bahar hai) — isliye safe hai.
//
// ONLY_FULL_GROUP_BY jaan-boojh kar hata nahi rahe: Postgres bhi utna hi sakht
// hai, to jo GROUP BY wahan chalti hai wo yahan bhi chalegi. Hataane par galat
// GROUP BY chup-chaap kisi bhi row ki value uthane lagti.
const SESSION_SQL =
  "SET SESSION sql_mode = CONCAT(@@sql_mode, ',ANSI_QUOTES'), time_zone = '+05:30'";

// ── 2. Postgres -> MySQL tarjuma ─────────────────────
// String literals ko chhodna zaroori hai — bilkul waise hi jaise db-postgres.js
// ka toPositional() karta hai. Bina iske `WHERE note = 'excluded.x'` jaisi
// bebaak query me bhi (c) wala replacement chal jaata aur literal chup-chaap
// 'VALUES(x)' ban jaata: koi error nahi, bas galat data.
//
// Tarika wahi hai — regex pehle POORA quoted literal match karti hai (do
// single-quote '' escape ke saath), tabhi asli pattern dekhti hai. Literal
// mila to use jyon ka tyon wapas kar dete hain.
function replaceOutsideStrings(sql, pattern, replacement) {
  const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
  const guarded = new RegExp(`'(?:[^']|'')*'|${pattern.source}`, flags);
  // Andar wali regex se `g` hata rahe hain: /g/ ke saath lastIndex yaad rehta
  // hai, aur wahi object baar-baar chalane par doosri call kahin beech se shuru
  // ho jaati. Har match ek chhota tukda hai, isliye ek baar chalna hi kaafi hai.
  const once = new RegExp(pattern.source, pattern.flags.replace('g', ''));
  return sql.replace(guarded, (m) => (m.startsWith("'") ? m : m.replace(once, replacement)));
}

// ── TO_CHAR ka format string ─────────────────────────
// Postgres apne token likhta hai (YYYY, MI, HH12), MySQL % wale (%Y, %i, %h).
// App me abhi chaar format chal rahe hain — 'YYYY-MM-DD', 'DD-MM-YYYY',
// 'DD/MM/YYYY' aur 'YYYY-MM-DD HH12:MI AM' — par poori table isliye likhi hai
// ki naya format add karne par yahan kuch chhuna na pade.
//
// Kram maayne rakhta hai: lambe token pehle (YYYY se pehle YY match ho gaya to
// '%y%y' ban jaata). Isi liye replace EK hi pass me hota hai — alag-alag pass
// karte to `%m` ke `M` ko agla pass dobara pakad leta.
const PG_FMT = {
  YYYY: '%Y', HH24: '%H', HH12: '%h', Month: '%M', Mon: '%b', Day: '%W',
  Dy: '%a', YY: '%y', MM: '%m', DD: '%d', HH: '%h', MI: '%i', SS: '%s',
  AM: '%p', PM: '%p',
};
const PG_FMT_RE = /YYYY|HH24|HH12|Month|Mon|Day|Dy|YY|MM|DD|HH|MI|SS|AM|PM/g;
function pgFormatToMysql(fmt) {
  return fmt.replace(PG_FMT_RE, (tok) => PG_FMT[tok]);
}

// Sirf utne hi patterns jitne app me sach me likhe hain. Har ek ke saath uska
// call site likha hai, taaki naya pattern aane par pata rahe ki yahan jodna hai.
function toMysql(sql) {
  let out = sql;

  // (a) UPSERT — routes/week-plan.js x3, routes/departments.js
  //     ON CONFLICT (cols) DO UPDATE SET a=EXCLUDED.a -> ON DUPLICATE KEY UPDATE a=VALUES(a)
  //     MySQL khud dekh leta hai kaunsi unique key tuti, isliye (cols) gir jaata hai.
  //     VALUES() 8.0.20 me deprecated hai par 5.7 aur 8.x dono par chalta hai —
  //     shared hosting par MySQL ka version pakka nahi hota, isliye yahi.
  out = replaceOutsideStrings(out, /\bON\s+CONFLICT\s*(?:\([^)]*\))?\s*DO\s+UPDATE\s+SET\b/gi,
                              'ON DUPLICATE KEY UPDATE');
  out = replaceOutsideStrings(out, /\bEXCLUDED\.(\w+)/gi, 'VALUES($1)');

  // (b) ON CONFLICT DO NOTHING — server.js:588 (app_state seed)
  //     MySQL ka badal INSERT IGNORE hai, jo statement ke shuru me lagta hai.
  const beforeDoNothing = out;
  out = replaceOutsideStrings(out, /\bON\s+CONFLICT\s*(?:\([^)]*\))?\s*DO\s+NOTHING\b/gi, '');
  // IGNORE tabhi lagao jab sach me DO NOTHING hata ho — warna har INSERT
  // chup-chaap duplicate/FK errors nigalne lagti.
  if (out !== beforeDoNothing) {
    out = out.replace(/^(\s*)INSERT\s+INTO\b/i, '$1INSERT IGNORE INTO');
  }

  // (c) RETURNING (xmax = 0) AS inserted — routes/week-plan.js:30
  //     Postgres ki chaal hai ye pata karne ki row nayi bani ya update hui.
  //     MySQL ye affectedRows me batata hai, isliye clause hata dete hain aur
  //     run() neeche wahi shakl ka row khud bana deta hai.
  out = replaceOutsideStrings(out, /\bRETURNING\s*\(\s*xmax\s*=\s*0\s*\)\s*AS\s+"?inserted"?/gi, '');

  // (d) Din jodna — server.js:1996 (bulk due-date shift)
  out = replaceOutsideStrings(out,
    /([\w.]+)\s*\+\s*make_interval\(\s*days\s*=>\s*\?::int\s*\)/gi,
    'DATE_ADD($1, INTERVAL ? DAY)');

  // (e) Mahine ka aakhri din — routes/dashboard.js:83 ('upcoming' list)
  //     Ye AKELA replacement hai jo string-literal guard ke bahar hai, aur hona
  //     bhi chahiye: pattern ke andar hi do literal hain ('month' aur
  //     '1 month - 1 day'). Guard lagate to wo literals pehle match ho jaate
  //     aur poora pattern kabhi banta hi nahi.
  out = out.replace(
    /\(\s*date_trunc\(\s*'month'\s*,\s*CURRENT_DATE\s*\)\s*\+\s*interval\s*'1 month - 1 day'\s*\)\s*::date/gi,
    'LAST_DAY(CURRENT_DATE)');

  // (f) TO_CHAR -> DATE_FORMAT — 38 jagah (server.js, dashboard, week-plan,
  //     queries, transfers, employee-records). Frontend ko hamesha bani-banayi
  //     'YYYY-MM-DD' string chahiye, ISO timestamp nahi.
  //
  //     (e) ki tarah ye bhi guard ke BAHAR hai — pattern ke andar hi format
  //     wala string literal hai, guard lagate to wo pehle match ho jaata.
  //
  //     Pehla argument `[^,]` par rukta hai, yaani `TO_CHAR(COALESCE(a,b),...)`
  //     jaisa nested comma abhi support nahi hai. App me har call sadha column
  //     reference hai; aisa kuch aaye to yahin badalna padega.
  out = out.replace(/\bTO_CHAR\s*\(\s*([^,]+?)\s*,\s*'([^']*)'\s*\)/gi,
                    (_m, expr, fmt) => `DATE_FORMAT(${expr}, '${pgFormatToMysql(fmt)}')`);

  // (g) Recovery-path DDL — routes/week-plan.js ka catch block. Ye tabhi chalta
  //     hai jab table/column hi gayab ho, par tab sahi syntax chahiye warna
  //     recovery khud fail ho jaayegi.
  if (/^\s*(CREATE|ALTER)\b/i.test(out)) {
    out = replaceOutsideStrings(out, /\bserial\b/gi, 'INT NOT NULL AUTO_INCREMENT');
    // MySQL me CREATE INDEX / ADD COLUMN par IF NOT EXISTS nahi hota — hata kar
    // "already exists" error ko run() me nigal lete hain (neeche IGNORABLE).
    out = replaceOutsideStrings(out, /\bCREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\b/gi, 'CREATE INDEX');
    out = replaceOutsideStrings(out, /\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/gi, 'ADD COLUMN');
  }

  return out;
}

// ── 3. Error codes ka tarjuma ────────────────────────
// App jagah-jagah Postgres SQLSTATE dekhti hai (week-plan.js me 42P01/42703,
// db-postgres.js me bhi). mysql2 apne naam deta hai. Har catch block badalne ke
// bajay yahin error par wahi code chipka dete hain jo app pehle se samajhti hai.
const ERR_MAP = {
  ER_NO_SUCH_TABLE: '42P01',   // undefined_table
  ER_BAD_FIELD_ERROR: '42703', // undefined_column
};
// Ye tabhi nigalne hain jab call site ne IF NOT EXISTS maanga tha (upar (f)).
const IGNORABLE = new Set(['ER_DUP_KEYNAME', 'ER_DUP_FIELDNAME']);

function translateError(e) {
  const pg = ERR_MAP[e.code];
  if (pg) e.code = pg;
  return e;
}

// ── 4. Query runner ──────────────────────────────────
// mysql2 ka query() use karte hain, execute() nahi. Do wajah:
//   1. `INSERT ... VALUES ?` wala bulk insert (server.js:1596) sirf query() me
//      chalta hai — execute() prepared statement banata hai jo nested array
//      expand nahi karta.
//   2. App dono naam se bulaati hai par ummeed ek jaisi rakhti hai.
async function run(runner, sql, params = []) {
  const wantsInsertedFlag = /\bRETURNING\s*\(\s*xmax\s*=\s*0\s*\)/i.test(sql);
  const hadIfNotExists = /\bIF\s+NOT\s+EXISTS\b/i.test(sql);
  const text = toMysql(sql);

  let rows, fields;
  try {
    [rows, fields] = await runner(text, params);
  } catch (e) {
    // CREATE INDEX IF NOT EXISTS / ADD COLUMN IF NOT EXISTS ka MySQL badal
    if (hadIfNotExists && IGNORABLE.has(e.code)) return [{ affectedRows: 0 }, []];
    throw translateError(e);
  }

  // week-plan.js ko rows[0].inserted chahiye. MySQL me ON DUPLICATE KEY UPDATE
  // par affectedRows: 1 = nayi row, 2 = update hui, 0 = update hui par value
  // wahi thi. Yaani sirf 1 ka matlab "inserted".
  if (wantsInsertedFlag) {
    return [[{ inserted: rows.affectedRows === 1 }], fields];
  }
  return [rows, fields];
}

module.exports = function createMysql() {
  // ── Connection ─────────────────────────────────────
  // Hosted MySQL DATABASE_URL deta hai; Hostinger jaise panel alag-alag DB_*
  // vars dete hain. Dono chalte hain.
  const rawUrl = (process.env.DATABASE_URL || '').trim();
  if (rawUrl && !/^mysql:\/\//i.test(rawUrl)) {
    throw new Error(
      `DATABASE_URL theek nahi lag raha: "${rawUrl.slice(0, 24)}…"\n` +
      '  DB_KIND=mysql ke saath ye mysql://user:pass@host:port/dbname jaisa hona chahiye.\n' +
      '  (Alag-alag DB_* vars use kar rahe ho to DATABASE_URL khaali chhod do.)'
    );
  }

  const base = {
    // Hindi/Devanagari aur emoji ke liye — utf8 (3-byte) me emoji tut jaate hain.
    charset: 'utf8mb4',
    waitForConnections: true,
    // DATE ko string hi rehne do. JS Date banane par local timezone me shift
    // hokar due_date ek din peeche dikh sakti hai — db-postgres.js bhi yahi
    // karta hai (type parser 1082) aur poora code 'YYYY-MM-DD' maan kar chalta hai.
    dateStrings: ['DATE'],
    timezone: '+05:30',
    connectionLimit: parseInt(process.env.DB_POOL_MAX || (process.env.VERCEL ? '1' : '10'), 10),
    idleTimeout: 10000,
    connectTimeout: 10000,
  };

  const connConfig = rawUrl
    ? { uri: rawUrl, ...base }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '3306', 10),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'task_manager',
        ...base,
      };

  // Serverless par har invocation naya module load kar sakta hai; pool ko
  // globalThis par rakhne se warm instance wahi pool dobara use karta hai.
  const g = globalThis;
  const pool = g.__smMyPool || (g.__smMyPool = mysql.createPool(connConfig));

  // ANSI_QUOTES aur IST har NAYE connection par. Pool ke connection event me
  // bheji gayi query us connection ki queue me sabse pehle lagti hai, isliye
  // koi asli query isse pehle nahi chal sakti.
  if (!g.__smMyPoolInit) {
    g.__smMyPoolInit = true;
    pool.on('connection', (conn) => { conn.query(SESSION_SQL); });
    pool.on('error', (err) => { console.error('  ❌ MySQL pool error:', err.message); });
  }

  return {
    kind: 'mysql',
    query: (sql, params) => run((t, p) => pool.query(t, p), sql, params),
    execute: (sql, params) => run((t, p) => pool.query(t, p), sql, params),

    async getConnection() {
      const conn = await pool.getConnection();
      return {
        query: (sql, params) => run((t, p) => conn.query(t, p), sql, params),
        execute: (sql, params) => run((t, p) => conn.query(t, p), sql, params),
        beginTransaction: () => conn.beginTransaction(),
        commit: () => conn.commit(),
        rollback: () => conn.rollback(),
        release: () => conn.release(),
      };
    },

    end: () => pool.end(),
    pool,
    _toMysql: toMysql, // tests ke liye
  };
};
