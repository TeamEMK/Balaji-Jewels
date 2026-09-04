// ══════════════════════════════════════════════════════
// POSTGRES DRIVER  (mysql2 compatibility layer)
// ══════════════════════════════════════════════════════
// server.js ke 247 DB calls mysql2 ke andaz me likhe hain:
//
//   const [rows] = await db.query('SELECT ... WHERE id=?', [id]);
//   const [r]    = await db.query('INSERT ...');  r.insertId
//
// Har call site badalne ke bajay ye layer wahi shakl bana kar deti hai, aur
// beech me Postgres ke liye zaroori teen tarjume karti hai:
//
//   1. `?` -> `$1, $2 …`   (Postgres positional placeholders maangta hai)
//   2. INSERT me RETURNING id jodna, taaki `insertId` milta rahe
//   3. bigint/numeric ko number banana (warna COUNT(*) string aata hai)
//
// db.js ise tab load karti hai jab DB_KIND=postgres ho (ya DATABASE_URL
// postgres:// se shuru ho).

// pg connection ka client_encoding OS locale se uthata hai. Windows par wo
// WIN1252 hota hai aur tab Hindi/emoji text par "no equivalent in encoding"
// aata hai. Linux/Railway par pehle se UTF8 hai, par yahan pin kar dena
// dono jagah ek jaisa vyavhaar deta hai. Ye pg ke load hone se PEHLE set
// hona chahiye, isliye require se upar hai.
if (!process.env.PGCLIENTENCODING) process.env.PGCLIENTENCODING = 'UTF8';

const { Pool, types } = require('pg');

// ── Type parsers ─────────────────────────────────────
// pg by default int8 (bigint) aur numeric ko STRING deta hai — precision na
// khoye isliye. Par is app me COUNT(*)/SUM(...) sab jagah number ki tarah use
// hote hain (`total > 0`, `a + b`), aur string aane par `5 + 1` = "51" ho jaata
// hai — koi error nahi, bas chup-chaap galat aankda. Isliye number bana rahe
// hain; yahan ki ginti kabhi 2^53 ke aas-paas bhi nahi jaati.
types.setTypeParser(20, v => (v === null ? null : parseInt(v, 10)));    // int8
types.setTypeParser(1700, v => (v === null ? null : parseFloat(v)));    // numeric

// DATE (1082) ko pg JS Date bana deta hai, jo local timezone me shift ho kar
// due_date ek din peeche dikha sakti hai. String hi rehne do — MySQL driver
// bhi 'YYYY-MM-DD' string hi deta hai aur poora code usi hisaab se likha hai.
types.setTypeParser(1082, v => v);

// ── `?` -> `$1, $2 …` ────────────────────────────────
// String literals ko chhodna zaroori hai: DATE_FORMAT ke patterns aur
// LIKE '%?%' jaise text me `?` aa sakta hai, use placeholder samajh lena
// query ko chup-chaap todta hai. Regex pehle poora quoted literal match karti
// hai (do single-quote '' escape ke saath), tabhi akela `?` dekhti hai.
function toPositional(sql) {
  let n = 0;
  return sql.replace(/'(?:[^']|'')*'|\?/g, (m) => (m === '?' ? '$' + ++n : m));
}

// ── mysql2 ka bulk insert: `VALUES ?` ────────────────
// mysql2 me ek hi `?` ke badle nested array de sakte the:
//
//   db.query('INSERT INTO t (a,b) VALUES ?', [[[1,2],[3,4]]])
//   -> INSERT INTO t (a,b) VALUES (1,2),(3,4)
//
// Postgres ke paas aisa kuch nahi hai. Bina is handling ke wo query
// `VALUES $1` ban jaati aur ek array parameter ke saath fail hoti — aur
// caller ko sirf 500 dikhta, asli wajah nahi. Isliye tuples yahin khol
// dete hain, taaki call sites mysql2 wale andaz me hi likhe reh sakein.
function expandBulkValues(sql, params) {
  if (!/VALUES\s*\?/i.test(sql)) return null;
  if (!Array.isArray(params) || params.length !== 1) return null;
  const rows = params[0];
  if (!Array.isArray(rows) || !rows.length || !Array.isArray(rows[0])) return null;
  const width = rows[0].length;
  if (!rows.every(r => Array.isArray(r) && r.length === width)) {
    throw new Error('bulk insert: har row me barabar columns hone chahiye');
  }
  let n = 0;
  const tuples = rows.map(r => '(' + r.map(() => '$' + ++n).join(',') + ')').join(',');
  return { text: sql.replace(/VALUES\s*\?/i, 'VALUES ' + tuples), values: rows.flat() };
}

// Kis table me `id` column nahi hai — pehli baar fail hone par yaad rakh lete
// hain, taaki har INSERT par dobara wahi error na aaye.
const noIdColumn = new Set();

function tableOf(sql) {
  const m = sql.match(/^\s*INSERT\s+INTO\s+["`]?(\w+)["`]?/i);
  return m ? m[1].toLowerCase() : null;
}

function isSelectLike(sql) {
  return /^\s*(SELECT|WITH|SHOW|EXPLAIN)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);
}

// Ek query chalao aur mysql2 jaisa [result, fields] wapas do.
async function run(runner, sql, params = []) {
  const bulk = expandBulkValues(sql, params);
  if (bulk) { sql = bulk.text; params = bulk.values; }
  const text = bulk ? sql : toPositional(sql);
  const table = tableOf(sql);
  const wantsReturning =
    table && !noIdColumn.has(table) && !/\bRETURNING\b/i.test(sql);

  if (wantsReturning) {
    try {
      const res = await runner(text.replace(/;?\s*$/, '') + ' RETURNING id', params);
      return [{ insertId: res.rows[0] && res.rows[0].id, affectedRows: res.rowCount, rows: res.rows }, res.fields];
    } catch (e) {
      // 42703 = undefined_column. Is table me `id` hai hi nahi (jaise
      // client_handlers ki composite key) — yaad rakho aur bina RETURNING chalao.
      if (e.code !== '42703') throw e;
      noIdColumn.add(table);
    }
  }

  const res = await runner(text, params);
  if (isSelectLike(sql)) return [res.rows, res.fields];
  return [{ insertId: undefined, affectedRows: res.rowCount, rows: res.rows }, res.fields];
}

module.exports = function createPostgres() {
  // ── Pool ───────────────────────────────────────────
  // Hosted Postgres DATABASE_URL deta hai; alag-alag DB_* vars bhi chalte hain
  // taaki local development pehle jaisa hi rahe.
  // .env me DATABASE_URL bharna bhool jana aam hai. Bina check ke pg "ENOTFOUND
  // REPLACE_ME" jaisi kuch phenkta hai jisse asli wajah nahi dikhti — isliye
  // yahin saaf message dete hain.
  const rawUrl = (process.env.DATABASE_URL || '').trim();
  if (rawUrl && !/^postgres(ql)?:\/\//i.test(rawUrl)) {
    throw new Error(
      `DATABASE_URL theek nahi lag raha: "${rawUrl.slice(0, 24)}…"\n` +
      '  Ye postgresql://user:pass@host:port/dbname jaisa hona chahiye.\n' +
      '  (Local Postgres use kar rahe ho to DATABASE_URL hata do aur DB_* vars bharo.)'
    );
  }

  const connConfig = rawUrl
    ? {
        connectionString: rawUrl,
        // Kai managed Postgres TLS par hote hain par certificate self-signed hai
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

  // Serverless par har invocation naya module load kar sakta hai. globalThis par
  // pool rakhne se warm instance wahi pool dobara use karta hai — warna har
  // request naya pool banati aur Postgres ke connection limit bhar jaate.
  const g = globalThis;
  const pool = g.__smPgPool || (g.__smPgPool = new Pool({
    ...connConfig,
    // Har connection IST par — poora code NOW()/CURRENT_DATE ko IST maan kar
    // chalta hai. Connection option ke roop me dete hain (baad me `SET TIME ZONE`
    // query bhejne ke bajay), taaki pehli asli query se pehle hi tay ho jaye
    // aur usse race na kare.
    options: '-c timezone=Asia/Kolkata',
    // Serverless par ek function instance ek hi request handle karta hai,
    // isliye per-instance pool chhota rakhna zaroori hai.
    max: parseInt(process.env.DB_POOL_MAX || (process.env.VERCEL ? '1' : '10'), 10),
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
  }));

  pool.on('error', (err) => {
    console.error('  ❌ Postgres pool error:', err.message);
  });

  return {
    kind: 'postgres',
    query: (sql, params) => run((t, p) => pool.query(t, p), sql, params),
    execute: (sql, params) => run((t, p) => pool.query(t, p), sql, params),

    // Transactions. mysql2 me conn.beginTransaction()/commit()/rollback()/release()
    // hota hai; pg me BEGIN/COMMIT/ROLLBACK aur client.release().
    async getConnection() {
      const client = await pool.connect();
      return {
        query: (sql, params) => run((t, p) => client.query(t, p), sql, params),
        execute: (sql, params) => run((t, p) => client.query(t, p), sql, params),
        beginTransaction: () => client.query('BEGIN'),
        commit: () => client.query('COMMIT'),
        rollback: () => client.query('ROLLBACK'),
        release: () => client.release(),
      };
    },

    end: () => pool.end(),
    pool,
    _toPositional: toPositional, // tests ke liye
  };
};
