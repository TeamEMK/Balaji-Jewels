// PM2 config — Hostinger VPS ke liye.
//
//   pm2 start deploy/ecosystem.config.js
//   pm2 save && pm2 startup     (reboot ke baad bhi app uthe)
//
// ⚠️  instances: 1 — ISE BADALNA MAT.
// Is app ke dono scheduler in-process state par chalte hain: reminder wala
// `_lastReminderRunDate` (server.js:315) ek module-level variable hai jo yaad
// rakhta hai ki aaj chal chuka. Cluster mode me har instance ki apni copy hoti
// hai, isliye 4 instances = har employee ko 4 reminder emails aur 4 WhatsApp
// messages. Load badhe to instances mat badhao — VPS bada karo.
module.exports = {
  apps: [{
    name: 'balaji-jewels',
    script: 'backend/server.js',
    cwd: '/var/www/balaji-jewels',   // <-- apna actual path daalo
    instances: 1,
    exec_mode: 'fork',

    autorestart: true,
    max_memory_restart: '600M',
    // PDF/MIS render aur video upload spike me restart loop na bane
    min_uptime: '30s',
    max_restarts: 10,

    // .env server.js khud load karta hai (dotenv, project root se).
    // Yahan sirf wo rakho jo dotenv se pehle chahiye.
    env: {
      NODE_ENV: 'production',
      TZ: 'Asia/Kolkata',
    },

    time: true,                       // logs me timestamp
    error_file: '/var/log/balaji-jewels/error.log',
    out_file: '/var/log/balaji-jewels/out.log',
    merge_logs: true,
  }],
};
