// Pehla admin banane ka script — fresh database par login karne ke liye.
//
//   npm run db:seed-admin
//
// Email/password `.env` se aate hain — ADMIN_EMAIL aur ADMIN_PASSWORD. Koi
// default nahi hai: dono na hon to script chalti hi nahi. Password bcrypt
// hash hokar jaata hai (wahi tarika jo app khud use karti hai).
//
//   ADMIN_EMAIL=you@company.com ADMIN_PASSWORD=something npm run db:seed-admin
//
// Dobara chalane par maujooda admin ka password reset ho jaata hai — bhoolne
// par yahi sabse aasan raasta hai.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../db');

// Pehle in dono ka hardcoded default tha. Nateeja ye ki har client copy me ek
// hi admin id aur ek hi password bhar jaata tha — aur wo password source me
// likha hone ki wajah se har repo me saaf dikhta tha. Ab dono .env se hi aate
// hain; na milein to kaam yahin ruk jaata hai.
const email = (process.env.ADMIN_EMAIL || '').trim();
const password = process.env.ADMIN_PASSWORD || '';
const name = (process.env.ADMIN_NAME || '').trim() || 'Admin';

if (!email || !password) {
  console.error('  ADMIN_EMAIL aur ADMIN_PASSWORD dono .env me hone chahiye.');
  console.error('  .env kholo aur bharo, ya ek baar ke liye:');
  console.error('  ADMIN_EMAIL=you@company.com ADMIN_PASSWORD=kuch-strong npm run db:seed-admin');
  process.exit(1);
}
// Poora email validation yahan bekaar hai — sirf itna dekhna hai ki galti se
// naam ya adhoora pata to nahi bhar diya.
const at = email.indexOf('@');
if (at < 1 || at !== email.lastIndexOf('@') || !email.slice(at).includes('.') || email.includes(' ')) {
  console.error(`  ADMIN_EMAIL theek nahi lagta: ${email}`);
  process.exit(1);
}

(async () => {
  const hash = bcrypt.hashSync(password, 10);
  const [existing] = await db.query('SELECT id FROM users WHERE email=?', [email]);

  if (existing.length) {
    await db.query(
      'UPDATE users SET password=?, role=?, session_version=session_version+1 WHERE email=?',
      [hash, 'admin', email]);
    console.log(`  ♻️  Maujooda admin ka password reset: ${email}`);
    console.log('     (session_version badha diya — purane login sab logout ho jayenge)');
  } else {
    const [r] = await db.query(
      'INSERT INTO users (name,email,password,role,department,staff_type) VALUES (?,?,?,?,?,?)',
      [name, email, hash, 'admin', 'Management', 'office']);
    console.log(`  ✅ Admin bana: ${email} (id ${r.insertId})`);
  }

  if (password.length < 8) {
    console.log('\n  ⚠️  Password 8 character se chhota hai. Login karke badal do,');
    console.log('     ya ADMIN_PASSWORD badal kar ye script dobara chalao.');
  }
  await db.end();
})().catch(e => { console.error('seed failed:', e.message); process.exit(1); });
