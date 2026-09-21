// ══════════════════════════════════════════════════════
// WORKING DAYS
// ══════════════════════════════════════════════════════
// Kaunsa din chhutti ka hai aur agla kaam wala din kaunsa — sirf date ka hisaab,
// koi database nahi. Isi liye ye alag file me hai: leaves, MIS aur task shifting
// teeno ko yahi niyam chahiye, aur bina DB ke ise seedha test kiya ja sakta hai.
//
// Chhutti ke teen source hain:
//   Sunday        — poori company ki, hamesha
//   week_off      — user ka apna, "0,6" jaise comma-separated day numbers
//   extra_off     — [{day:6, weeks:[2,4]}] = mahine ka 2nd aur 4th Saturday

// "0,6" -> [0,6]. Kachra chup-chaap chhod deta hai.
function parseWeekOff(s) {
  return (s || '').split(',').map(x => parseInt(x.trim())).filter(n => !isNaN(n));
}

// JSON text -> array. Toota hua JSON ho to khaali, taaki ek user ka galat data
// poori list na giraye.
function parseExtraOff(s) {
  try { const v = s ? JSON.parse(s) : []; return Array.isArray(v) ? v : []; } catch (e) { return []; }
}

// extra_off: [{day:6, weeks:[2,4]}] => mahine ka 2nd & 4th Saturday
function isExtraOff(date, extraOff) {
  const dow = date.getDay();
  const nth = Math.ceil(date.getDate() / 7);
  return extraOff.some(e => e && e.day === dow && Array.isArray(e.weeks) && e.weeks.includes(nth));
}

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Agla working day — Sunday, week off, extra off aur approved leave dates skip
// karke. 400 din ka guard hai: agar kisi user ka data aisa ho ki har din chhutti
// banti ho, to loop hamesha ke liye nahi ghoomega — null lautega.
function nextWorkingDay(fromISO, weekOff, extraOff, leaveDates) {
  const d = new Date(fromISO + 'T00:00:00');
  for (let i = 0; i < 400; i++) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() === 0) continue;              // Sunday company-wide off
    if (weekOff.includes(d.getDay())) continue;
    if (isExtraOff(d, extraOff)) continue;
    if (leaveDates.has(toISO(d))) continue;
    return toISO(d);
  }
  return null;
}

// Kisi mahine me is user ke liye kitne "working days" hain — Sunday, week_off
// aur extra_off (jaise mahine ka 2nd/4th Saturday) sab chhod kar. Payroll ke
// per-day rate ka "working days" basis isi se nikalta hai.
function workingDaysInMonth(year, month, weekOffStr, extraOffJson) {
  const weekOff = parseWeekOff(weekOffStr);
  const extraOff = parseExtraOff(extraOffJson);
  const daysInMonth = new Date(year, month, 0).getDate(); // month 1-indexed yahan
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d);
    if (date.getDay() === 0) continue;
    if (weekOff.includes(date.getDay())) continue;
    if (isExtraOff(date, extraOff)) continue;
    count++;
  }
  return count;
}

// Kisi bhi date range (mahina boundary se bandhe bina) me is user ke liye
// kitne working days hain — Employee 360 Score ke "Daily Task fill rate" ke
// liye chahiye, jahan range ek hafta, mahina, ya kuch bhi ho sakta hai.
function workingDaysInRange(startISO, endISO, weekOffStr, extraOffJson) {
  const weekOff = parseWeekOff(weekOffStr);
  const extraOff = parseExtraOff(extraOffJson);
  let count = 0;
  const d = new Date(startISO + 'T00:00:00');
  const end = new Date(endISO + 'T00:00:00');
  while (d <= end) {
    if (d.getDay() !== 0 && !weekOff.includes(d.getDay()) && !isExtraOff(d, extraOff)) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

module.exports = { parseWeekOff, parseExtraOff, isExtraOff, toISO, nextWorkingDay, workingDaysInMonth, workingDaysInRange };
