# Hostinger Deployment — Balaji Jewels Task Manager

Frontend alag deploy nahi hota — wahi ek Express process [`frontend/`](../frontend/)
ko serve karta hai aur API bhi deta hai. Yaani ek hi Node app, ek hi database.

App ab **MySQL aur PostgreSQL dono** par chalti hai — `.env` ka `DB_KIND` tay
karta hai kaunsa. Hostinger ke liye **MySQL** chuno:

| Plan | MySQL | PostgreSQL |
|---|---|---|
| Web / Cloud (Premium, Business, Cloud Startup) | ✅ | ❌ |
| VPS | ✅ | ✅ |

PostgreSQL Hostinger ke shared plans par milta hi nahi — unki apni doc kehti hai
"VPS Hosting is the supported option". Isi wajah se MySQL port kiya gaya, taaki
sasta Business/Cloud plan kaafi ho jaye.

Node.js Business plan par 5 apps tak aur Cloud Startup par 10 tak chalta hai.

---

## A. Business / Cloud plan par (sasta raasta)

### 1. Database banao

hPanel → **Databases → MySQL Databases** → naya database + user.

⚠️ Hostinger dono naamon me **prefix** lagata hai. Aap `taskmanager` likhoge par
asli naam `u123456789_taskmanager` banega. `.env` me wahi poora naam jaana
chahiye jo panel dikhata hai — bina prefix ke sirf "Access denied" milta hai
aur asli wajah kahin nahi dikhti.

### 2. Code upload karo

GitHub → **Code → Download ZIP** → hPanel **File Manager** me upload → extract.

Do baatein:
- ZIP `balaji-jewels-task-manager-main/` folder banati hai. `package.json`
  wahin hona chahiye jahan app ka root set kar rahe ho.
- ZIP me `node_modules` **nahi** aata (gitignored hai) — ye achha hai. Apne
  Windows ka `node_modules` kabhi upload mat karna: usme
  `@napi-rs/canvas-win32-x64-msvc` hota hai jo Linux par chalta hi nahi, aur MIS
  report render crash karti hai. Server par hi install karo — wahan Linux wala
  binary apne aap aa jayega.

### 3. Node.js app set karo

hPanel → **Node.js** (ya "Node.js App"):

| Setting | Value |
|---|---|
| Node version | 20 ya usse upar (`package.json` me `engines: >=20`) |
| Application root | jahan `package.json` hai |
| Startup file | `backend/server.js` |

Phir **Run NPM Install**.

Port panel khud deta hai — `.env` me `PORT` likhne ki zarurat nahi, app
`process.env.PORT` utha leti hai ([server.js:50](../backend/server.js#L50)).

### 4. `.env` banao

File Manager se project root me `.env` banao aur
[`env.production.template`](env.production.template) copy karo. Har value ke
upar comment likha hai. Teen cheezein zaroor:

```bash
# SESSION_SECRET apne computer par generate karo
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- `SESSION_SECRET` — khaali chhoda to `'change-me'` fallback lagta hai, koi bhi admin JWT bana lega
- `ADMIN_PASSWORD` — koi strong password, local/dev wala dobara mat use karna
- `DB_KIND=mysql`, aur `DATABASE_URL` **khaali**

### 5. Schema chadhao

Shared plan par shell nahi milta, isliye do raaste hain — **Remote MySQL wala
behtar hai**, kyunki wo admin bhi bana deta hai.

**Raasta 1 — Remote MySQL (recommended)**

hPanel → **Databases → Remote MySQL** → apna IP whitelist karo. Phir apne
computer se, is project ke folder me:

```bash
DB_KIND=mysql \
DB_HOST=<hostinger ka mysql host> DB_PORT=3306 \
DB_USER=u123456789_xxx DB_PASSWORD=<pass> DB_NAME=u123456789_taskmanager \
DATABASE_URL= \
npm run db:migrate && npm run db:seed-admin
```

Kaam hone ke baad Remote MySQL band kar dena.

**Raasta 2 — phpMyAdmin**

hPanel → phpMyAdmin → SQL tab → [`../data/migrations/mysql/`](../data/migrations/mysql/)
ki chaaron file **naam ke kram me** chalao (001 → 002 → 003 → 004).

Isse admin nahi banta — `ADMIN_PASSWORD` ka bcrypt hash chahiye hota hai, jo
sirf `db:seed-admin` banata hai. Ya to Raasta 1 use karo, ya hash apne computer
par bana kar `users` row khud daalo.

### 6. App start karo

hPanel → Node.js → **Restart**. Logs me ye dikhna chahiye:

```
✦ Balaji Jewels: http://localhost:XXXX
```

---

## B. VPS par

Ubuntu 24.04 + Node 20 + PM2 + Nginx. Database ke liye MySQL bhi chalega aur
PostgreSQL bhi — `.env` me `DB_KIND` badal do.

```bash
# 1. VPS taiyar
adduser deploy && usermod -aG sudo deploy
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
# DB ka port (3306/5432) kabhi mat kholna — wo sirf localhost par rahe

# 2. Node
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs && sudo npm i -g pm2

# 3. MySQL
sudo apt install -y mysql-server && sudo systemctl enable --now mysql
sudo mysql
```

```sql
CREATE DATABASE task_manager CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'balaji_app'@'localhost' IDENTIFIED BY 'yahan-strong-password';
GRANT ALL ON task_manager.* TO 'balaji_app'@'localhost';
FLUSH PRIVILEGES;
```

⚠️ `utf8mb4` zaroori hai (`utf8` nahi). App me Hindi/Devanagari text aur emoji
jaate hain — 3-byte `utf8` par emoji toot jaate hain.

```bash
# 4. Code + deps
sudo mkdir -p /var/www/balaji-jewels && sudo chown -R deploy:deploy /var/www/balaji-jewels
cd /var/www/balaji-jewels && git clone <repo-url> . && npm ci --omit=dev

# 5. .env
cp deploy/env.production.template .env && nano .env && chmod 600 .env

# 6. Schema + admin
npm run db:migrate      # 4 migrations -> 29 tables
npm run db:seed-admin

# 7. PM2
sudo mkdir -p /var/log/balaji-jewels && sudo chown -R deploy:deploy /var/log/balaji-jewels
pm2 start deploy/ecosystem.config.js && pm2 save && pm2 startup

# 8. Nginx + SSL
sudo apt install -y nginx certbot python3-certbot-nginx
sudo cp deploy/nginx.conf /etc/nginx/sites-available/balaji-jewels
sudo nano /etc/nginx/sites-available/balaji-jewels        # server_name badlo
sudo ln -s /etc/nginx/sites-available/balaji-jewels /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d tasks.balajijewels.com
```

---

## ⚠️ Traps — ye padh lo

### 1. `NODE_ENV=production` + HTTP = login loop

[`server.js:1410`](../backend/server.js#L1410) par cookie `secure: isProduction`
set hoti hai — production me login cookie **sirf HTTPS par** jaati hai.

SSL lagne se pehle plain HTTP par test kiya, to login "success" dikhega par
cookie save nahi hogi — har baar wapas login page. App theek hai, ye expected
hai. **SSL ke baad hi domain se test karo.**

### 2. VPS par cron mat lagana

Vercel par schedulers band rehte the aur `/api/cron/reminders` +
`/api/cron/whatsapp` ko Vercel Cron bulata tha ([`vercel.json`](../vercel.json)).

VPS/Hostinger par `process.env.VERCEL` set nahi hota → `IS_SERVERLESS` false →
dono scheduler **khud hi** chalte hain ([`server.js:4143`](../backend/server.js#L4143)).
Upar se cron laga diya to reminders aur WhatsApp **do baar** jaayenge.

### 3. `instances: 1` mat badalna (VPS)

Reminder scheduler yaad rakhta hai ki aaj chal chuka — `_lastReminderRunDate`,
ek module-level variable ([`server.js:315`](../backend/server.js#L315)). Ye
**per-process** hai. PM2 cluster mode me 4 instances = har employee ko 4
reminder emails aur 4 WhatsApp messages. Load badhe to VPS bada karo.

### 4. Nginx ka 1MB default (VPS)

Proof video ka cap 25MB hai ([`server.js:1656`](../backend/server.js#L1656)) aur
photos base64 me 12MB tak. Nginx ka default `client_max_body_size 1m` dono ko
413 de kar rokta hai — aur frontend par sirf "upload failed" dikhta hai.
[`nginx.conf`](nginx.conf) me 30M set hai.

---

## Update deploy karna

**Shared:** nayi ZIP upload → extract → NPM Install → Restart.
**VPS:**

```bash
cd /var/www/balaji-jewels && git pull && npm ci --omit=dev
npm run db:migrate        # pehle se lagi migrations skip ho jaati hain
pm2 restart balaji-jewels
```

## Backup

```bash
# VPS — roz raat 2 baje
echo '0 2 * * * mysqldump -u balaji_app -p<pass> task_manager | gzip > /var/backups/bj-$(date +\%F).sql.gz' | crontab -
```

Shared plan par hPanel → Backups se automatic backup on kar do.

## Optional cheezein

Ye khaali rahe to app chalti hai, bas wo feature band rehta hai:

| Missing | Kya band hoga |
|---|---|
| `SMTP_USER` / `SMTP_PASS` | Email + reminder scheduler |
| `WAUMFY_*` | WhatsApp scheduler |
| `credentials.json` | Google Drive video upload |

`credentials.json` project root me chahiye — [`backend/lib/google.js`](../backend/lib/google.js)
wahin dhoondhti hai. Git me commit mat karna (already gitignored).

## Troubleshooting

| Dikkat | Wajah |
|---|---|
| `Access denied for user` | `DB_USER`/`DB_NAME` me Hostinger ka prefix nahi lagaya |
| Boot par `ECONNREFUSED` | `DATABASE_URL` bhara hua hai — khaali karo, `DB_*` use karo |
| Login ke baad wapas login page | SSL nahi laga aur `NODE_ENV=production` hai (trap #1) |
| Do-do reminder email | Cron bhi laga hai (trap #2) ya `instances > 1` (trap #3) |
| Upload par `413` | Nginx `client_max_body_size` (trap #4) |
| Hindi text ya emoji toot rahe | DB `utf8mb4` me nahi bani (`utf8` 3-byte hai) |
| MIS report render crash | Windows ka `node_modules` upload ho gaya |
