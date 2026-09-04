/*
 * login-animation.js — login page ke mascots.
 *
 * index.html ise `defer` ke saath load karti hai, isliye markup pehle se
 * maujood hota hai. Har block pehle apne elements dhoondhta hai aur na milne
 * par chup-chaap laut jaata hai — mascots ka SVG hata do to page waise ka
 * waisa chalta rehta hai.
 *
 * Kaun kya dhoondhta hai:
 *   .mascots, .mascot, .pupil, .turn   index.html ka inline SVG
 *   #password + #capsHint              password field aur uski hint line
 *
 * Page ko sirf do function bulane hote hain, login ka jawab aane par:
 *   mascotOops()    galat login  — group sihar jaata hai, muskaan gir jaati hai
 *   mascotCheer()   sahi login   — ek uchhaal, phir redirect
 *
 * Baaki sab — jhoolna, palak jhapakna, pupils ka pointer follow karna,
 * password dikhne par mooh pherna — apne aap chalta hai.
 */

// ── Mascots: har pupil pointer ko dekhta hai ──
// Pupils saade <circle> hain; unke cx/cy aankh ka centre hain aur JS uske upar
// sirf ek CSS transform lagata hai — SVG khud kabhi nahi badalta.
(function mascotEyes(){
  const svg = document.querySelector('.mascots');
  if (!svg) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const VB_W = 420, VB_H = 274;   // SVG ke viewBox se milna chahiye
  const MAX  = 4.2;               // pupil apne centre se itni door tak ja sakta hai

  const pupils = Array.from(svg.querySelectorAll('.pupil')).map(el => ({
    el,
    x: parseFloat(el.getAttribute('cx')),
    y: parseFloat(el.getAttribute('cy'))
  }));

  let frame = null;
  function look(clientX, clientY){
    frame = null;
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return;
    // Pointer ki jagah SVG ke apne coordinate space me
    const ux = (clientX - r.left) / r.width  * VB_W;
    const uy = (clientY - r.top)  / r.height * VB_H;
    for (const p of pupils){
      const dx = ux - p.x, dy = uy - p.y;
      const dist = Math.hypot(dx, dy);
      // MAX par clamp, par aankh ke bilkul paas wala pointer pupil ko poora
      // nahi kheenchta
      const k = dist > MAX ? MAX / dist : 1;
      p.el.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    }
  }

  window.addEventListener('mousemove', e => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => look(e.clientX, e.clientY));
  });
  // Pointer window se bahar — seedha saamne dekho
  document.addEventListener('mouseleave', () => {
    if (frame) { cancelAnimationFrame(frame); frame = null; }
    for (const p of pupils) p.el.style.transform = 'translate(0px, 0px)';
  });

  // Touch device kabhi mousemove nahi bhejta, to aankhein hamesha ke liye jam
  // jaati. Jis field par abhi focus aaya hai, use hi dekh lete hain; desktop
  // par agla mouse move waise bhi ise apne aap hata deta hai.
  document.querySelectorAll('input').forEach(input => {
    input.addEventListener('focus', () => {
      const b = input.getBoundingClientRect();
      look(b.left + b.width * 0.28, b.top + b.height / 2);
    });
  });
})();

// ── Mascots: beech-beech me palak jhapakna ──
// Har character ka apna timer, taaki sab ek saath na jhapkein.
(function mascotBlink(){
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.querySelectorAll('.mascot').forEach(m => {
    (function schedule(){
      setTimeout(() => {
        m.classList.add('is-blinking');
        setTimeout(() => { m.classList.remove('is-blinking'); schedule(); }, 130);
      }, 3200 + Math.random() * 3800);
    })();
  });
})();

// ── Caps Lock warning ──
// Sahi dikhta password reject hone ki sabse aam wajah yahi hoti hai.
(function capsLockHint(){
  const svg   = document.querySelector('.mascots');
  const field = document.getElementById('password');
  const hint  = document.getElementById('capsHint');
  if (!field || !hint) return;

  function check(e){
    // Modifier ki sthiti sirf asli key event me hoti hai
    const on = typeof e.getModifierState === 'function' && e.getModifierState('CapsLock');
    hint.classList.toggle('show', on);
    if (svg) svg.classList.toggle('is-alert', on);
  }
  field.addEventListener('keydown', check);
  field.addEventListener('keyup',   check);
  field.addEventListener('blur', () => {
    hint.classList.remove('show');
    if (svg) svg.classList.remove('is-alert');
  });
})();

// ── Login ke nateeje par reaction ──
// Global isliye ki index.html ka login() inhe seedha bulata hai; yahan koi
// module system nahi hai.
function mascotOops(){
  const svg = document.querySelector('.mascots');
  if (!svg) return;
  svg.classList.remove('is-sad');
  svg.getBoundingClientRect();          // reflow, taaki dobara fail hone par phir se sihre
  svg.classList.add('is-sad');
  setTimeout(() => svg.classList.remove('is-sad'), 1200);
}
function mascotCheer(){
  const svg = document.querySelector('.mascots');
  if (svg) svg.classList.add('is-happy');
}

// ── Mascots: password screen par dikhte hi mooh pher lete hain ──
// Chhupe hue dots me dekhne layak kuch hai hi nahi, isliye trigger focus nahi
// — reveal hai. Aankh wala button input ka `type` 'password' aur 'text' ke
// beech palatta hai, to usi attribute par nazar rakhna kaafi hai; button me
// kuch badalna nahi padta.
(function mascotPrivacy(){
  const svg   = document.querySelector('.mascots');
  const field = document.getElementById('password');
  if (!svg || !field) return;

  function update(){ svg.classList.toggle('is-hiding', field.type === 'text'); }

  new MutationObserver(update).observe(field, { attributes:true, attributeFilter:['type'] });
  update();
})();
