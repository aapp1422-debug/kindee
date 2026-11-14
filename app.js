/* แอปบันทึกพฤติกรรม (ฝั่งผู้ป่วย) — เชื่อมกับ Apps Script backend */
'use strict';
const $ = id => document.getElementById(id);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GNAME = { ckd: '🫘 กลุ่มชะลอไต', dm: '🏃 กลุ่มลดหวานลดพุง' };
const MEALS = ['เช้า', 'กลางวัน', 'เย็น'];
const MOVE = [{ e: '🚶', n: 'เดิน' }, { e: '🌾', n: 'ทำนา ทำไร่' }, { e: '🌱', n: 'ทำสวน' }, { e: '🧹', n: 'งานบ้าน' }, { e: '🚲', n: 'ปั่นจักรยาน' }, { e: '💃', n: 'รำ / แอโรบิก' }];
const NSAID = ['ยาแก้ปวดข้อ ปวดเมื่อย', 'ยาชุด / ยาซอง', 'ไปฉีดยาแก้ปวด', 'ไม่รู้ชื่อยา'];

/* ---------- API ---------- */
async function api(action, data) {
  const res = await fetch(window.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ action }, data || {})) });
  const j = await res.json();
  if (!j.ok) { const e = new Error(j.error || 'เกิดข้อผิดพลาด'); e.server = true; throw e; }
  return j;
}

/* ---------- token จากลิงก์ส่วนตัว ---------- */
let TOKEN = new URLSearchParams(location.search).get('t');
if (TOKEN) store.set('token', TOKEN); else TOKEN = store.get('token');

/* ---------- สถานะฟอร์ม ---------- */
let ME = null, FOODS = [], GROUP = 'ckd';
const S = { meal: 0, meals: [new Set(), new Set(), new Set()], other: ['', '', ''], otherOpen: [false, false, false], veg: 0, rice: 0, v: {}, water: 0, move: new Set(), min: 0, med: null, nsaidList: new Set() };

/* ---------- เริ่มต้น ---------- */
async function boot() {
  if (!TOKEN) return bootMsg('🔗', 'กรุณาเปิดจากลิงก์หรือ QR ที่ได้รับจาก รพ.สต.<br><small>ถ้าหาไม่เจอ ติดต่อเจ้าหน้าที่ได้เลยค่ะ</small>');
  setManifest();
  try {
    await flushPending();
    ME = await api('me', { token: TOKEN });
    store.set('me', ME);
  } catch (e) {
    if (e.server) return bootMsg('⚠️', esc(e.message));
    ME = store.get('me');
    if (!ME) return bootMsg('📶', 'เชื่อมต่ออินเทอร์เน็ตไม่ได้<br><small>ลองใหม่อีกครั้งเมื่อมีสัญญาณ</small><br><br><button class="btn-retry" onclick="location.reload()" style="padding:12px 24px;font:inherit;border-radius:12px;border:2px solid #0f7a5c;background:#fff;color:#0f7a5c">ลองใหม่</button>');
    $('offlineBar').classList.add('show');
  }
  FOODS = ME.foods || [];
  GROUP = ME.patient.group;
  document.body.className = GROUP;
  $('hello').textContent = 'สวัสดีค่ะ คุณ' + ME.patient.name.replace(/^(นาย|นางสาว|นาง)\s*/, '') + ' 👋';
  $('today').textContent = new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('grpBadge').textContent = GNAME[GROUP];
  setStreak(ME.streak);
  $('wGoal').textContent = ME.patient.water_goal || 8;
  $('mGoal').textContent = ME.patient.move_goal || 30;
  $('riceRow').style.display = GROUP === 'dm' ? 'flex' : 'none';
  restore(ME.log || pendingToday());
  bindStatic();
  renderAll();
  $('boot').style.display = 'none';
  ['vLog', 'saveBar', 'nav'].forEach(id => $(id).style.display = id === 'nav' ? 'flex' : 'block');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
function bootMsg(em, html) { $('boot').innerHTML = '<span class="em">' + em + '</span>' + html; }
function setStreak(n) { $('streakBadge').textContent = n ? '🔥 บันทึกต่อเนื่อง ' + n + ' วัน' : '🌱 เริ่มบันทึกวันนี้กันเลย'; }

/** manifest ที่มี token ใน start_url เพื่อให้ไอคอนบนหน้าจอเปิดถูกคน */
function setManifest() {
  try {
    const base = location.href.split('?')[0].replace(/[^/]*$/, '');
    const m = { name: 'บันทึกสุขภาพ รพ.สต.', short_name: 'บันทึกสุขภาพ', start_url: base + 'index.html?t=' + encodeURIComponent(TOKEN), scope: base, display: 'standalone', background_color: '#f3f6f4', theme_color: '#0f7a5c',
      icons: [{ src: base + 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: base + 'icon-512.png', sizes: '512x512', type: 'image/png' }] };
    $('manifestLink').href = URL.createObjectURL(new Blob([JSON.stringify(m)], { type: 'application/manifest+json' }));
  } catch (e) {}
}

/* ---------- เติมข้อมูลเดิม (เปิดซ้ำวันเดียวกัน) ---------- */
function restore(l) {
  if (!l) return;
  let meals = l.meals_json;
  try { if (typeof meals === 'string') meals = meals ? JSON.parse(meals) : []; } catch (e) { meals = []; }
  (meals || []).forEach(m => { const i = MEALS.indexOf(m.meal); if (i < 0) return; (m.items || []).forEach(c => S.meals[i].add(c)); if (m.other) { S.other[i] = m.other; S.otherOpen[i] = true; } });
  S.veg = num(l.veg); S.rice = num(l.rice); S.water = num(l.water); S.min = num(l.move_min);
  String(l.move_types || '').split(',').filter(Boolean).forEach(n => { const i = MOVE.findIndex(m => m.n === n); if (i >= 0) S.move.add(i); });
  S.med = l.med || null;
  String(l.nsaid_types || '').split(',').filter(Boolean).forEach(n => S.nsaidList.add(n));
  ['soup_lv', 'dip_lv', 'season', 'sweet', 'nsaid', 'herb', 'hypo'].forEach(k => { if (l[k] !== '' && l[k] != null) S.v[k] = num(l[k]); });
  if (l.bp) $('bp').value = l.bp; if (l.dtx) $('dtx').value = l.dtx; if (l.weight) $('wt').value = l.weight;
}
const num = v => (v === '' || v == null || isNaN(Number(v))) ? 0 : Number(v);

/* ---------- ผูกปุ่ม ---------- */
function bindStatic() {
  document.querySelectorAll('#mealTabs button').forEach(b => b.onclick = () => { S.meal = +b.dataset.m; document.querySelectorAll('#mealTabs button').forEach(x => x.classList.toggle('on', x === b)); renderFood(); });
  $('otherTxt').oninput = () => { S.other[S.meal] = $('otherTxt').value.trim(); upd(); };
  document.querySelectorAll('.lv').forEach(w => w.querySelectorAll('button').forEach(b => b.onclick = () => { S.v[w.dataset.q] = +b.dataset.v; renderChoices(); upd(); }));
  document.querySelectorAll('.yn').forEach(w => w.querySelectorAll('button').forEach(b => b.onclick = () => { S.v[w.dataset.q] = +b.dataset.v; renderChoices(); upd(); }));
  document.querySelectorAll('#medBig button').forEach(b => b.onclick = () => { S.med = b.dataset.v; renderChoices(); upd(); });
  document.querySelectorAll('nav div').forEach(n => n.onclick = () => show(n.dataset.v));
  window.addEventListener('online', () => { $('offlineBar').classList.remove('show'); flushPending(); });
  window.addEventListener('offline', () => $('offlineBar').classList.add('show'));
}
function renderAll() { renderFood(); renderWater(); renderMove(); renderNsaid(); renderChoices(); upd(); }
function stepV(k, d) { S[k] = Math.max(0, Math.min(20, S[k] + d)); $(k).textContent = S[k]; upd(); }

function renderFood() {
  const g = $('foodGrid'); g.innerHTML = '';
  FOODS.forEach(f => {
    const b = document.createElement('button');
    b.className = 'chip' + (S.meals[S.meal].has(f.code) ? ' on' : '');
    const tag = GROUP === 'ckd' && f.salty ? '<span class="tag t-salt">เค็ม</span>' : (GROUP === 'dm' && f.carb ? '<span class="tag t-sugar">แป้ง/หวาน</span>' : '');
    b.innerHTML = tag + '<span class="em">' + esc(f.emoji) + '</span>' + esc(f.name);
    b.onclick = () => { const m = S.meals[S.meal]; m.has(f.code) ? m.delete(f.code) : m.add(f.code); renderFood(); upd(); };
    g.appendChild(b);
  });
  const open = S.otherOpen[S.meal] || !!S.other[S.meal];
  const o = document.createElement('button');
  o.className = 'chip' + (open ? ' on' : ''); o.innerHTML = '<span class="em">✏️</span>อื่นๆ (พิมพ์เอง)';
  o.onclick = () => { S.otherOpen[S.meal] = !open; if (open) S.other[S.meal] = ''; renderFood(); upd(); if (!open) $('otherTxt').focus(); };
  g.appendChild(o);
  $('otherBox').classList.toggle('show', open); $('otherTxt').value = S.other[S.meal];
  $('veg').textContent = S.veg; $('rice').textContent = S.rice;
}
function renderWater() {
  const goal = ME.patient.water_goal || 8, g = $('glasses'); g.innerHTML = '';
  for (let i = 0; i < Math.max(goal, S.water + 1) && i < 15; i++) {
    const d = document.createElement('div'); d.className = 'glass' + (i < S.water ? ' full' : '');
    d.onclick = () => { S.water = (S.water === i + 1) ? i : i + 1; renderWater(); upd(); }; g.appendChild(d);
  }
  $('wCount').textContent = S.water;
}
function renderMove() {
  const g = $('moveGrid'); g.innerHTML = '';
  MOVE.forEach((m, i) => { const b = document.createElement('button'); b.className = 'chip' + (S.move.has(i) ? ' on' : ''); b.innerHTML = '<span class="em">' + m.e + '</span>' + m.n; b.onclick = () => { S.move.has(i) ? S.move.delete(i) : S.move.add(i); renderMove(); upd(); }; g.appendChild(b); });
  const mm = $('mins'); mm.innerHTML = '';
  [10, 20, 30, 45, 60].forEach(v => { const b = document.createElement('button'); b.className = S.min === v ? 'on' : ''; b.textContent = v + ' น.'; b.onclick = () => { S.min = v; renderMove(); upd(); }; mm.appendChild(b); });
}
function renderNsaid() {
  const g = $('nsaidGrid'); g.innerHTML = '';
  NSAID.forEach(n => { const b = document.createElement('button'); b.className = 'chip' + (S.nsaidList.has(n) ? ' on' : ''); b.style.minHeight = '54px'; b.textContent = n; b.onclick = () => { S.nsaidList.has(n) ? S.nsaidList.delete(n) : S.nsaidList.add(n); renderNsaid(); }; g.appendChild(b); });
}
function renderChoices() {
  document.querySelectorAll('.lv').forEach(w => w.querySelectorAll('button').forEach(b => { const on = S.v[w.dataset.q] === +b.dataset.v; b.className = on ? 'on' + (b.dataset.hi ? ' hi' : '') : ''; }));
  document.querySelectorAll('.yn').forEach(w => w.querySelectorAll('button').forEach(b => { const v = +b.dataset.v; b.className = S.v[w.dataset.q] === v ? (v ? 'on-yes' : 'on-no') : ''; }));
  document.querySelectorAll('#medBig button').forEach(b => b.classList.toggle('on', b.dataset.v === S.med));
  $('nsaidSub').classList.toggle('show', S.v.nsaid === 1);
}
function sections() {
  const r = { 'c-food': S.meals.some(m => m.size) || S.other.some(Boolean), 'c-water': S.water > 0, 'c-move': S.min > 0, 'c-med': !!S.med };
  if (GROUP === 'ckd') r['c-risk'] = 'nsaid' in S.v && 'herb' in S.v; else r['c-hypo'] = 'hypo' in S.v;
  return r;
}
function upd() {
  const s = sections(); let n = 0;
  for (const k in s) { $(k).classList.toggle('done', s[k]); if (s[k]) n++; }
  $('progBar').style.width = (n / 5 * 100) + '%'; $('progTxt').textContent = 'บันทึกแล้ว ' + n + ' จาก 5 หมวด';
}

/* ---------- บันทึก ---------- */
function buildLog() {
  const log = {
    meals_json: MEALS.map((m, i) => ({ meal: m, items: [...S.meals[i]], other: S.other[i] })).filter(m => m.items.length || m.other),
    veg: S.veg, water: S.water, move_types: [...S.move].map(i => MOVE[i].n).join(','), move_min: S.min, med: S.med || ''
  };
  ['soup_lv', 'dip_lv', 'season', 'sweet', 'nsaid', 'herb', 'hypo'].forEach(k => { if (k in S.v) log[k] = S.v[k]; });
  if (GROUP === 'dm') log.rice = S.rice;
  if (S.v.nsaid === 1) log.nsaid_types = [...S.nsaidList].join(',');
  const bp = $('bp').value.trim(), dtx = $('dtx').value.trim(), wt = $('wt').value.trim();
  if (GROUP === 'ckd' && bp) log.bp = bp;
  if (GROUP === 'dm' && dtx) log.dtx = Number(dtx);
  if (GROUP === 'dm' && wt) log.weight = Number(wt);
  return log;
}
function validate(log) {
  if (log.bp && !/^\d{2,3}\/\d{2,3}$/.test(log.bp)) return 'ความดันให้พิมพ์แบบ 130/80';
  if (log.dtx && !(log.dtx >= 20 && log.dtx <= 600)) return 'ค่าน้ำตาลปลายนิ้วไม่ถูกต้อง (20–600)';
  if (log.weight && !(log.weight >= 30 && log.weight <= 200)) return 'น้ำหนักไม่ถูกต้อง (30–200 กก.)';
  return '';
}
function save() {
  const err = validate(buildLog());
  if (err) return sheet('<h3>⚠️ ตรวจสอบอีกครั้ง</h3><div class="alert">' + err + '</div><button onclick="closeOv()">กลับไปแก้</button>');
  const miss = Object.keys(sections()).filter(k => !sections()[k]);
  const name = { 'c-food': 'อาหาร', 'c-water': 'น้ำ', 'c-move': 'ออกแรง', 'c-med': 'ยา', 'c-risk': 'เรื่องระวังไต', 'c-hypo': 'น้ำตาลต่ำ' };
  if (miss.length) return sheet('<h3>ยังขาดอีก ' + miss.length + ' หมวด</h3><div class="line">' + miss.map(k => '• ' + name[k]).join('<br>') + '</div><div class="hint" style="margin-top:8px">ถ้าไม่มีข้อมูลบางหมวด กดบันทึกเท่าที่มีได้เลยค่ะ</div><button onclick="closeOv()">กลับไปกรอกต่อ</button><button style="background:#fff;color:#0f7a5c;border:2px solid #0f7a5c" onclick="send()">บันทึกเท่าที่มี</button>');
  send();
}
async function send() {
  const log = buildLog(); log.date = todayStr();
  $('saveBtn').disabled = true; $('saveBtn').textContent = '⏳ กำลังบันทึก...';
  let res = null, offline = false;
  try { res = await api('saveLog', { token: TOKEN, log }); setStreak(res.streak); }
  catch (e) {
    if (e.server) { $('saveBtn').disabled = false; $('saveBtn').textContent = '💾 บันทึกวันนี้'; return sheet('<h3>⚠️ บันทึกไม่สำเร็จ</h3><div class="alert">' + esc(e.message) + '</div><button onclick="closeOv()">ปิด</button>'); }
    offline = true; queue(log);
  }
  $('saveBtn').disabled = false; $('saveBtn').textContent = '💾 บันทึกอีกครั้ง (แก้ไขได้)';
  feedback(log, res, offline);
}
function feedback(log, res, offline) {
  const foodsById = {}; FOODS.forEach(f => foodsById[f.code] = f);
  const all = new Set(); S.meals.forEach(m => m.forEach(c => all.add(c)));
  const others = S.other.map((t, i) => t ? MEALS[i] + ': ' + esc(t) : '').filter(Boolean);
  const salty = [...all].filter(c => foodsById[c] && foodsById[c].salty).length, sweet = [...all].filter(c => foodsById[c] && foodsById[c].carb).length;
  let h = offline ? '<h3>📶 บันทึกไว้ในเครื่องแล้ว</h3><div class="hint">จะส่งให้ รพ.สต. อัตโนมัติเมื่อมีอินเทอร์เน็ต</div>' : '<h3>✅ บันทึกเรียบร้อยค่ะ</h3>';
  h += '<div class="line">🍲 อาหาร ' + (all.size + others.length) + ' รายการ · 🥬 ผัก ' + S.veg + ' กำมือ</div><div class="line">💧 น้ำ ' + S.water + ' แก้ว · 🚶 ออกแรง ' + S.min + ' นาที</div><div class="line">💊 ยา: ' + (S.med || '-') + '</div>';
  const good = [], bad = [];
  const wg = ME.patient.water_goal || 8, mg = ME.patient.move_goal || 30;
  if (GROUP === 'ckd') {
    const tips = [];
    if (S.v.soup_lv >= 2) tips.push('ซดน้ำแกงแค่ 2–3 ช้อน');
    if (S.v.dip_lv === 2) tips.push('จ้ำน้ำพริก/แจ่วแค่ปลายผัก ไม่จุ่มทั้งคำ');
    if (S.v.season === 1) tips.push('ไม่เติมผงปรุง น้ำปลาเพิ่ม');
    if (salty >= 3 || tips.length) bad.push('วันนี้ได้เกลือค่อนข้างมาก พรุ่งนี้ลอง' + (tips.length ? ': ' + tips.join(', ') : 'เลือกเมนูต้ม นึ่ง แทนเมนูเค็ม') + ' นะคะ');
    else if (all.size || others.length) good.push('วันนี้คุมเค็มได้ดีมากค่ะ 👏');
    if (S.v.nsaid === 1) bad.push('ยาแก้ปวด/ยาฉีดอาจทำให้ไตเสื่อมเร็วขึ้น <b>เจ้าหน้าที่ รพ.สต. จะติดต่อกลับเพื่อแนะนำค่ะ</b>');
    if (S.v.herb === 1) bad.push('สมุนไพร/อาหารเสริมบางชนิดมีผลต่อไต ถ่ายรูปขวดหรือซองไว้ให้เจ้าหน้าที่ดูนะคะ');
  } else {
    const dtx = Number(log.dtx);
    if (S.v.hypo === 1 || (dtx && dtx < 70)) bad.push('<b>ถ้ามีอาการตอนนี้:</b> ดื่มน้ำหวานหรือน้ำผลไม้ครึ่งแก้ว หรืออมลูกอม 3–4 เม็ด พัก 15 นาที ถ้าไม่ดีขึ้นทำซ้ำ ถ้าซึมหรือเรียกไม่รู้สึกตัว โทร 1669 · <b>เจ้าหน้าที่จะได้รับแจ้งค่ะ</b>');
    if (S.rice > 3 || S.v.sweet === 1 || sweet >= 3) bad.push('วันนี้แป้งและน้ำตาลค่อนข้างมาก พรุ่งนี้ลองลดข้าวเหนียวลง 1 ปั้นนะคะ');
    else if (all.size || others.length) good.push('วันนี้คุมแป้งและน้ำตาลได้ดีค่ะ 👏');
  }
  if (S.water >= wg) good.push('ดื่มน้ำครบเป้าหมายแล้ว 💧');
  if (S.min >= mg) good.push('ออกแรงครบ ' + mg + ' นาทีแล้ว เยี่ยมมาก 💪');
  if (S.med === 'ครบ') good.push('กินยาครบ ดีมากค่ะ');
  if (S.med && S.med !== 'ครบ') bad.push('อย่าหยุดยาเองนะคะ ถ้ามีปัญหาเรื่องยาให้บอกเจ้าหน้าที่');
  good.forEach(g => h += '<div class="good">' + g + '</div>');
  bad.forEach(b => h += '<div class="alert">' + b + '</div>');
  if (res && res.streak) h += '<div class="good" style="background:#fff8e6;color:#7a5600">🔥 บันทึกต่อเนื่อง ' + res.streak + ' วัน! พรุ่งนี้มาบันทึกต่อนะคะ</div>';
  h += '<button onclick="closeOv()">ปิด</button>';
  sheet(h);
}
function sheet(h) { $('sheet').innerHTML = h; $('ov').classList.add('show'); }
function closeOv() { $('ov').classList.remove('show'); }

/* ---------- เก็บในเครื่องเมื่อออฟไลน์ ---------- */
function queue(log) { const q = (store.get('pending') || []).filter(x => x.date !== log.date); q.push(log); store.set('pending', q); }
function pendingToday() { return (store.get('pending') || []).find(x => x.date === todayStr()) || null; }
async function flushPending() {
  const q = store.get('pending') || []; if (!q.length) return;
  const left = [];
  for (const log of q) { try { await api('saveLog', { token: TOKEN, log }); } catch (e) { if (!e.server) left.push(log); } }
  store.set('pending', left);
}
function todayStr() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

/* ---------- เปลี่ยนหน้า ---------- */
function show(v) {
  document.querySelectorAll('nav div').forEach(x => x.classList.toggle('on', x.dataset.v === v));
  $('vLog').style.display = v === 'log' ? 'block' : 'none';
  $('vRes').style.display = v === 'res' ? 'block' : 'none';
  $('vKb').style.display = v === 'kb' ? 'block' : 'none';
  $('saveBar').style.display = v === 'log' ? 'block' : 'none';
  if (v === 'res') loadResults();
  if (v === 'kb') renderKb();
  window.scrollTo(0, 0);
}

/* ================= ผลของฉัน ================= */
const GOPT = {
  ckd: [['soup', 5, '🥣 ไม่ซดน้ำแกง (ซดไม่เกินนิดหน่อย) อย่างน้อย 5 วัน'], ['dip', 5, '🌶️ จ้ำน้ำพริก/แจ่ว แค่ปลายผัก อย่างน้อย 5 วัน'], ['season', 7, '🧂 ไม่เติมผงปรุงเพิ่ม ทุกวัน'], ['water', 6, '💧 ดื่มน้ำครบเป้า อย่างน้อย 6 วัน'], ['walk', 5, '🚶 ออกแรง 20 นาทีขึ้นไป อย่างน้อย 5 วัน']],
  dm: [['rice', 5, '🍙 ข้าวเหนียวไม่เกิน 2 ปั้น อย่างน้อย 5 วัน'], ['veg', 5, '🥬 กินผัก 3 กำมือขึ้นไป อย่างน้อย 5 วัน'], ['sweet', 6, '🥤 ไม่ดื่มน้ำหวาน/กาแฟ 3in1 อย่างน้อย 6 วัน'], ['walk', 5, '🚶 ออกแรง 20 นาทีขึ้นไป อย่างน้อย 5 วัน'], ['fruit', 5, '🍌 ไม่กินผลไม้หวาน อย่างน้อย 5 วัน']]
};
function goalMet(code, l) {
  const meals = parseMeals(l.meals_json);
  switch (code) {
    case 'soup': return num(l.soup_lv) <= 1 && l.soup_lv !== '';
    case 'dip': return num(l.dip_lv) <= 1 && l.dip_lv !== '';
    case 'season': return l.season !== '' && num(l.season) === 0;
    case 'water': return num(l.water) >= (ME.patient.water_goal || 8);
    case 'walk': return num(l.move_min) >= 20;
    case 'rice': return num(l.rice) <= 2;
    case 'veg': return num(l.veg) >= 3;
    case 'sweet': return l.sweet !== '' && num(l.sweet) === 0;
    case 'fruit': return !meals.some(m => (m.items || []).indexOf('F10') >= 0);
  }
  return false;
}
function parseMeals(v) { try { return typeof v === 'string' ? (v ? JSON.parse(v) : []) : (v || []); } catch (e) { return []; } }
const parseGoal = s => { const p = String(s || '').split('|'); return p.length >= 3 ? { code: p[0], need: +p[1], text: p.slice(2).join('|') } : (s ? { code: '', need: 0, text: s } : null); };
function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function weekDates(offsetWeeks) { const d = new Date(); d.setHours(12); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd - 7 * offsetWeeks); return Array.from({ length: 7 }, (_, i) => { const x = new Date(d); x.setDate(d.getDate() + i); return ymd(x); }); }

let RES = null, gSel = null;
async function loadResults() {
  $('resSub').textContent = GNAME[GROUP];
  try { RES = await api('results', { token: TOKEN }); store.set('res', RES); }
  catch (e) { RES = store.get('res'); if (!RES) { $('resBody').innerHTML = '<div class="card empty">โหลดผลไม่ได้ ลองใหม่เมื่อมีอินเทอร์เน็ต</div>'; return; } }
  renderRes();
}
function renderRes() {
  const logs = {}; (RES.last14 || []).forEach(l => logs[l.date] = l);
  const wk = weekDates(0), days = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'], tdy = todayStr();
  const rows = GROUP === 'ckd'
    ? [['💧 ดื่มน้ำครบ', 'water'], ['🚶 ออกแรง 20 นาที', 'walk'], ['💊 กินยาครบ', 'med'], ['🥣 ไม่ซดน้ำแกง', 'soup'], ['🌶️ จ้ำน้อย', 'dip']]
    : [['💧 ดื่มน้ำครบ', 'water'], ['🚶 ออกแรง 20 นาที', 'walk'], ['💊 กินยาครบ', 'med'], ['🍙 ข้าวเหนียว ≤ 2 ปั้น', 'rice'], ['🥤 ไม่ดื่มน้ำหวาน', 'sweet']];
  let t = '<tr><th></th>' + days.map(d => '<th>' + d + '</th>').join('') + '<th>รวม</th></tr>';
  rows.forEach(([n, c]) => {
    let s = 0;
    const cells = wk.map(d => { if (d > tdy) return '<td></td>'; const l = logs[d]; const ok = l && (c === 'med' ? l.med === 'ครบ' : goalMet(c, l)); if (ok) s++; return '<td><span class="dot d' + (ok ? 1 : 0) + '">' + (ok ? '✓' : '') + '</span></td>'; }).join('');
    t += '<tr><td>' + n + '</td>' + cells + '<td class="score">' + s + '/7</td></tr>';
  });
  let h = '<section class="card"><h2>🗓️ สัปดาห์นี้ทำได้กี่วัน</h2><div class="hint">สีเขียว = ทำได้ตามเป้า · บันทึกต่อเนื่อง ' + (RES.streak || 0) + ' วัน</div><table class="wk">' + t + '</table></section>';
  // เป้าหมาย
  const cur = parseGoal(RES.goal), last = parseGoal(RES.lastGoal);
  h += '<section class="card"><h2>🎯 เป้าหมายของสัปดาห์</h2>';
  if (last && last.code) {
    const got = weekDates(1).filter(d => logs[d] && goalMet(last.code, logs[d])).length, ok = got >= last.need;
    h += '<div class="goalbox' + (ok ? '' : ' miss') + '"><div style="font-size:15px;color:#5b6b64">เป้าหมายสัปดาห์ที่แล้ว</div><div style="font-weight:700">' + esc(last.text) + '</div><div style="margin-top:4px">ทำได้ <b>' + got + ' วัน</b> ' + (ok ? '🎉 ผ่านเป้าหมาย!' : '— เกือบแล้ว ลองต่ออีกสัปดาห์ไหมคะ') + '</div></div>';
  }
  if (cur) {
    const got = cur.code ? wk.filter(d => logs[d] && goalMet(cur.code, logs[d])).length : null;
    h += '<div class="goalbox"><div style="font-size:15px;color:#5b6b64">เป้าหมายสัปดาห์นี้</div><div style="font-weight:700">' + esc(cur.text) + '</div>' + (got !== null ? '<div style="margin-top:4px">ทำได้แล้ว <b>' + got + '/' + cur.need + ' วัน</b></div>' : '') + '<button class="btn-link" style="margin-top:6px;background:none;border:none;color:#0f7a5c;font:inherit;text-decoration:underline" onclick="RES.goal=\'\';renderRes()">เปลี่ยนเป้าหมาย</button></div>';
  } else {
    h += '<div style="margin-top:10px;font-weight:600">เลือกเป้าหมายสัปดาห์นี้ 1 ข้อ</div><div class="gopt" id="gopt">' + GOPT[GROUP].map((g, i) => '<button data-i="' + i + '">' + g[2] + '</button>').join('') + '</div><button class="gbtn" onclick="setGoal()">ตั้งเป้าหมายนี้</button><div id="goalErr"></div>';
  }
  h += '</section>';
  // ผลแล็บ
  const labs = RES.labs || [];
  if (GROUP === 'dm') {
    h += labCard('🩸 น้ำตาลสะสม (HbA1c)', '🟢 ต่ำกว่า 7% · 🟡 7–7.9% · 🔴 8% ขึ้นไป', labs.filter(l => l.type === 'HbA1c'), v => v < 7 ? 'lv-ok' : v < 8 ? 'lv-mid' : 'lv-hi', v => v.toFixed(1) + '%', () => '',
      list => { const f = list[0].value, l = list[list.length - 1].value; return list.length < 2 ? '' : (l < 6.5 ? '<div class="good">🎉 HbA1c ต่ำกว่า 6.5% แล้ว! เจ้าหน้าที่จะประเมินร่วมกับแพทย์</div>' : (l < f ? '<div class="good">ลดลงจาก ' + f.toFixed(1) + '% เหลือ ' + l.toFixed(1) + '% แล้ว 👏 อีก ' + (l - 6.5).toFixed(1) + '% จะถึงเป้า 6.5%</div>' : '<div class="alert">ค่ายังไม่ลดลง เจ้าหน้าที่จะชวนคุยหาวิธีที่เหมาะกับเราค่ะ</div>')); },
      '📌 เบาหวานระยะสงบ = HbA1c ต่ำกว่า 6.5% โดยไม่ใช้ยาเบาหวานอย่างน้อย 3 เดือน (แพทย์/พยาบาลเป็นผู้ประเมิน)');
    const w = labs.filter(l => l.type === 'weight').map(l => ({ d: l.date, v: l.value })).concat((RES.last14 || []).filter(l => num(l.weight) > 0).map(l => ({ d: l.date, v: num(l.weight) }))).sort((a, b) => a.d < b.d ? -1 : 1);
    if (w.length) {
      const b0 = w[0].v, lw = w[w.length - 1].v, lost = b0 - lw;
      h += '<section class="card"><h2>⚖️ น้ำหนักของฉัน</h2><div class="hint">เส้นประ = เป้าหมาย ลด 10 กก. และ 15 กก.</div>' + (w.length > 1 ? lineChart(w.map(x => x.v), { min: Math.floor(b0 - 17), max: Math.ceil(Math.max(...w.map(x => x.v)) + 2), refs: [{ v: b0 - 10, l: '−10 กก.', c: '#e8a317' }, { v: b0 - 15, l: '−15 กก.', c: '#0f7a5c' }] }) : '') +
        '<div class="kpi"><div>เริ่มต้น<b>' + b0 + '</b>กก.</div><div>ล่าสุด<b>' + lw + '</b>กก.</div><div>ลดแล้ว<b style="color:#0f7a5c">' + Math.max(0, lost).toFixed(1) + '</b>กก.</div></div>' +
        (lost < 10 ? '<div class="good">อีก ' + (10 - lost).toFixed(1) + ' กก. จะถึงเป้าแรก (ลด 10 กก.) สู้ ๆ ค่ะ 💪</div>' : '<div class="good">🎉 ลดได้ 10 กก. แล้ว!</div>') + '</section>';
    }
    const dt = (RES.last14 || []).filter(l => num(l.dtx) > 0);
    if (dt.length > 1) h += '<section class="card"><h2>🩸 น้ำตาลปลายนิ้ว (14 วัน)</h2>' + lineChart(dt.map(l => num(l.dtx)), { min: 50, max: 250, refs: [{ v: 70, l: '70', c: '#d0442c' }, { v: 130, l: '130', c: '#0f7a5c' }], pts: 1 }) + '</section>';
  } else {
    const stage = v => v >= 60 ? '' : v >= 45 ? 'ระยะ 3a' : v >= 30 ? 'ระยะ 3b' : v >= 15 ? 'ระยะ 4' : 'ระยะ 5';
    h += labCard('🫘 ค่าการทำงานของไต (eGFR)', '🟢 60 ขึ้นไป · 🟡 45–59 (ระยะ 3a) · 🟠 30–44 (ระยะ 3b) · 🔴 ต่ำกว่า 30', labs.filter(l => l.type === 'eGFR'), v => v >= 60 ? 'lv-ok' : v >= 45 ? 'lv-mid' : 'lv-hi', v => String(v), v => stage(v),
      list => { if (list.length < 2) return ''; const d = list[list.length - 2].value - list[list.length - 1].value; return d <= 0 ? '<div class="good">🎉 ค่าไตคงที่หรือดีขึ้น เยี่ยมมากค่ะ</div>' : d <= 2 ? '<div class="good">ค่าไตค่อนข้างคงที่ (ลดลง ' + d + ') 👏 รักษาพฤติกรรมดี ๆ ไว้นะคะ</div>' : '<div class="alert">ค่าไตลดลง ' + d + ' เจ้าหน้าที่จะนัดคุยเพื่อวางแผนร่วมกันค่ะ</div>'; },
      '📌 ค่า eGFR ยิ่งสูงยิ่งดี เป้าหมายคือให้ลดลง<b>ไม่เกิน 5 ต่อปี</b>');
    const sl = labs.filter(l => l.type === 'salt').slice(-4);
    if (sl.length) {
      const L = ['เค็มน้อย', 'ปานกลาง', 'เค็มมาก'], E = ['😊', '😐', '😢'], lv = x => x <= 0.70 ? 0 : x <= 0.90 ? 1 : 2;
      h += '<section class="card"><h2>🧂 ความเค็มของแกงที่บ้าน</h2><div class="hint">อสม. วัดด้วยเครื่อง CHEM METER<br>😊 ไม่เกิน 0.70% · 😐 0.71–0.90% · 😢 เกิน 0.90%</div><div class="salt">' +
        sl.map(s => { const v = lv(s.value); return '<div class="s' + v + '"><span class="em">' + E[v] + '</span>' + thDate(s.date) + '<br><b>' + s.value.toFixed(2) + '%</b><br>' + L[v] + '</div>'; }).join('') + '</div>' +
        (sl.length > 1 && sl[sl.length - 1].value < sl[0].value ? '<div class="good">แกงที่บ้านเค็มน้อยลงแล้ว เยี่ยมมากค่ะ 👏</div>' : '') + '</section>';
    }
    const bp = (RES.last14 || []).filter(l => /^\d+\//.test(String(l.bp)));
    if (bp.length > 1) h += '<section class="card"><h2>❤️ ความดันตัวบน (14 วัน)</h2><div class="hint">เส้นประ = เป้าหมายไม่เกิน 130</div>' + lineChart(bp.map(l => +String(l.bp).split('/')[0]), { min: 100, max: 180, refs: [{ v: 130, l: '130', c: '#0f7a5c' }], pts: 1 }) + '</section>';
  }
  $('resBody').innerHTML = h;
  const go = $('gopt'); if (go) go.querySelectorAll('button').forEach(b => b.onclick = () => { gSel = +b.dataset.i; go.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); });
}
function labCard(title, legend, list, cls, fmtV, sub, msg, note) {
  let h = '<section class="card"><h2>' + title + '</h2><div class="hint">เจ้าหน้าที่บันทึกผลเลือดให้ ตรวจทุก 3 เดือน<br>' + legend + '</div>';
  if (!list.length) return h + '<div class="empty">ยังไม่มีผลตรวจ</div></section>';
  const show = list.slice(-3);
  h += '<div class="a1c">' + show.map((l, i) => (i ? '<div class="arr">' + (l.value <= show[i - 1].value ? '<span>⬇</span>' : '<span>⬆</span>') + Math.abs(l.value - show[i - 1].value).toFixed(title.indexOf('HbA1c') >= 0 ? 1 : 0) + '</div>' : '') +
    '<div class="bx ' + cls(l.value) + '">' + (list.length - show.length + i === 0 ? 'ก่อนเริ่ม' : 'ครั้งที่ ' + (list.length - show.length + i + 1)) + '<b>' + fmtV(l.value) + '</b>' + (sub(l.value) ? sub(l.value) + '<br>' : '') + thDate(l.date) + '</div>').join('');
  const next = new Date(list[list.length - 1].date + 'T12:00:00'); next.setDate(next.getDate() + 90);
  h += '<div class="arr"><span>›</span></div><div class="bx lv-wait">ครั้งถัดไป<b>—</b>~' + thDate(ymd(next)) + '</div></div>';
  return h + msg(list) + '<div class="hint" style="margin-top:10px;font-size:14px">' + note + '</div></section>';
}
const thDate = s => { const d = new Date(String(s).slice(0, 10) + 'T12:00:00'); return isNaN(d) ? s : d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }); };
async function setGoal() {
  if (gSel === null) { $('goalErr').innerHTML = '<div class="alert">กรุณาเลือกเป้าหมาย 1 ข้อก่อนค่ะ</div>'; return; }
  const g = GOPT[GROUP][gSel], text = g[0] + '|' + g[1] + '|' + g[2];
  try { await api('setGoal', { token: TOKEN, goal_text: text }); RES.goal = text; gSel = null; renderRes(); }
  catch (e) { $('goalErr').innerHTML = '<div class="alert">' + esc(e.server ? e.message : 'ไม่มีอินเทอร์เน็ต ลองใหม่อีกครั้งค่ะ') + '</div>'; }
}
function lineChart(v, o) {
  const W = 440, H = 210, pl = 44, pr = 64, pt = 12, pb = 20, iw = W - pl - pr, ih = H - pt - pb;
  const x = i => pl + (v.length === 1 ? 0 : i * iw / (v.length - 1)), y = val => pt + ih - (Math.max(o.min, Math.min(o.max, val)) - o.min) / (o.max - o.min) * ih;
  let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" font-family="Sarabun,sans-serif">';
  for (let k = 0; k <= 4; k++) { const val = o.min + (o.max - o.min) * k / 4, yy = y(val); s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + yy + '" y2="' + yy + '" stroke="#eef3f0"/><text x="' + (pl - 6) + '" y="' + (yy + 4) + '" font-size="12" fill="#8a9893" text-anchor="end">' + Math.round(val) + '</text>'; }
  (o.refs || []).forEach(r => { const yy = y(r.v); s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + yy + '" y2="' + yy + '" stroke="' + r.c + '" stroke-width="2" stroke-dasharray="6 5"/><text x="' + (W - pr + 6) + '" y="' + (yy + 5) + '" font-size="14" font-weight="700" fill="' + r.c + '">' + r.l + '</text>'; });
  s += '<polyline fill="none" stroke="#1d6fb0" stroke-width="3" stroke-linejoin="round" points="' + v.map((val, i) => x(i) + ',' + y(val)).join(' ') + '"/>';
  v.forEach((val, i) => { if (o.pts || i === v.length - 1) s += '<circle cx="' + x(i) + '" cy="' + y(val) + '" r="' + (i === v.length - 1 ? 6 : 4) + '" fill="#1d6fb0"/>'; });
  s += '<text x="' + x(v.length - 1) + '" y="' + (y(v[v.length - 1]) - 12) + '" font-size="15" font-weight="700" fill="#1d6fb0" text-anchor="middle">' + v[v.length - 1] + '</text>';
  return s + '</svg>';
}

/* ================= ความรู้ ================= */
const KB = {
  both: [
    { e: '🚶', t: 'ออกแรงหลังกินข้าว ดีที่สุด', b: '<ul><li>เดินหรือทำงานบ้าน 10–15 นาที หลังกินข้าว ช่วยให้น้ำตาลไม่พุ่ง</li><li>ทำนา ทำสวน กวาดบ้าน ก็นับเป็นการออกแรง</li><li>รวมให้ได้วันละ 30 นาที แบ่งทำหลายครั้งได้</li></ul>' },
    { e: '💊', t: 'กินยาให้ตรงเวลา อย่าหยุดเอง', b: '<ul><li>ตั้งยาไว้ข้างจานข้าว หรือตั้งปลุกในมือถือ</li><li>ลืม 1 มื้อ ไม่ต้องกินเพิ่มเป็น 2 เท่า</li><li>ถ้ากินยาแล้วรู้สึกผิดปกติ ให้บอกเจ้าหน้าที่ก่อนหยุดยา</li></ul>' }
  ],
  ckd: [
    { e: '🧂', t: 'เค็มซ่อนอยู่ที่ไหนบ้าง', b: '<ul><li>ปลาร้า น้ำปลา ผงปรุงรส ผงชูรส ซีอิ๊ว ซอส</li><li>ปลาส้ม ไส้กรอก หมูยอ บะหมี่กึ่งสำเร็จรูป</li><li>ผงชูรสไม่เค็ม แต่มีโซเดียม ทำร้ายไตเหมือนกัน</li></ul><div class="tip">💡 ลดทีละน้อย ลิ้นจะชินภายใน 2–3 สัปดาห์</div>' },
    { e: '🥣', t: 'ทำไมไม่ควรซดน้ำแกง', b: '<ul><li>เกลือและผงปรุงละลายอยู่ในน้ำแกงเกือบทั้งหมด</li><li>ตักแต่เนื้อและผัก เหลือน้ำไว้ในถ้วย</li><li>ถ้าอยากซด ซดแค่ 2–3 ช้อน</li></ul>' },
    { e: '🌶️', t: 'จ้ำแจ่ว จ้ำปลาร้า ให้น้อยลง', b: '<ul><li>แจ่วและน้ำพริก 1 ถ้วยเล็ก เค็มมาก</li><li>จ้ำแค่ปลายผัก ไม่จุ่มทั้งคำ</li><li>ตักแจ่วแบ่งใส่ถ้วยเล็กของตัวเอง จะรู้ว่ากินไปเท่าไร</li></ul>' },
    { e: '💊', t: 'ยาแก้ปวด ยาชุด ฉีดยา ทำร้ายไต', b: '<ul><li>ยาแก้ปวดข้อ ปวดเมื่อย (กลุ่ม NSAIDs) ยาชุด และยาฉีดแก้ปวด ทำให้ไตเสื่อมเร็วขึ้น</li><li>ปวดเมื่อย ลองประคบร้อน หรือนวดแผนไทยที่ รพ.สต.</li><li>ก่อนซื้อยาเอง ถามเจ้าหน้าที่ก่อนทุกครั้ง</li></ul>' },
    { e: '🌿', t: 'สมุนไพร ยาหม้อ อาหารเสริม', b: '<ul><li>บางชนิดมีผลต่อไต หรือทำปฏิกิริยากับยาที่กินอยู่</li><li>ถ่ายรูปขวด/ซอง หรือนำมาให้เจ้าหน้าที่ดูวันนัด</li></ul>' },
    { e: '🔢', t: 'ค่าไต (eGFR) ของฉันหมายถึงอะไร', b: '<ul><li>eGFR บอกว่าไตยังทำงานได้ประมาณเท่าไร</li><li>ระยะ 3a = 45–59 · ระยะ 3b = 30–44</li><li>เป้าหมายของเรา: ให้ค่าลดลงช้าที่สุด ไม่เกิน 5 ต่อปี</li></ul><div class="tip">💡 ดูค่าไตของตัวเองได้ในแท็บ "ผลของฉัน"</div>' },
    { e: '💧', t: 'ดื่มน้ำเท่าไรดี', b: '<ul><li>ดื่มตามเป้าที่เจ้าหน้าที่ตั้งให้ในแอป</li><li>ใช้แก้วใบเดิมทุกวัน จะนับง่าย</li><li>ถ้าบวม หอบเหนื่อย ปัสสาวะน้อยลง ให้รีบบอกเจ้าหน้าที่</li></ul>' }
  ],
  dm: [
    { e: '⚖️', t: 'ทำไมลดพุงแล้วเบาหวานดีขึ้น', b: '<ul><li>ไขมันที่สะสมในตับและตับอ่อน ทำให้ร่างกายคุมน้ำตาลไม่ได้</li><li>เมื่อน้ำหนักลด ไขมันส่วนนี้ลดลง น้ำตาลจะดีขึ้นจนบางคนลดยาได้</li><li>เป้าหมาย: ลด 10–15 กก. ภายใน 1 ปี</li></ul>' },
    { e: '🍙', t: 'ข้าวเหนียว กินเท่าไรดี', b: '<ul><li>ปั้นเล็กขนาดประมาณไข่ไก่ มื้อละ 1–2 ปั้น</li><li>ปั้นใส่จานไว้ก่อน ไม่หยิบจากกระติบไปเรื่อย ๆ</li><li>กินผักและเนื้อก่อน แล้วค่อยกินข้าว</li></ul>' },
    { e: '🍽️', t: 'จานสุขภาพ 2:1:1', b: '<ul><li>ผัก 2 ส่วน (ครึ่งจาน)</li><li>ข้าว/แป้ง 1 ส่วน</li><li>เนื้อสัตว์ไม่ติดมัน ปลา ไข่ 1 ส่วน</li></ul>' },
    { e: '🥤', t: 'น้ำตาลซ่อนในเครื่องดื่ม', b: '<ul><li>กาแฟ 3in1 น้ำอัดลม ชาเย็น นมเปรี้ยว น้ำผลไม้กล่อง</li><li>เปลี่ยนเป็นน้ำเปล่า กาแฟดำ ชาไม่ใส่น้ำตาล</li></ul>' },
    { e: '🍌', t: 'ผลไม้ เลือกอย่างไร', b: '<ul><li>กินได้ แต่ครั้งละ 1 กำมือ</li><li>เลือก ฝรั่ง ชมพู่ แก้วมังกร แทน ทุเรียน ลำไย มะม่วงสุก</li><li>กินผลสด ไม่ดื่มน้ำผลไม้</li></ul>' },
    { e: '🆘', t: 'น้ำตาลต่ำ ทำอย่างไร', b: '<ul><li>อาการ: ใจสั่น เหงื่อออก มือสั่น หิวมาก หน้ามืด</li><li>ดื่มน้ำหวานหรือน้ำผลไม้ครึ่งแก้ว หรืออมลูกอม 3–4 เม็ด</li><li>พัก 15 นาที ถ้าไม่ดีขึ้นทำซ้ำ</li><li>ถ้าซึม เรียกไม่รู้สึกตัว โทร 1669 ทันที</li></ul><div class="tip">💡 ช่วงลดน้ำหนัก ถ้าเป็นบ่อย ต้องบอกเจ้าหน้าที่ เพื่อปรับยา</div>' },
    { e: '⚠️', t: 'เบาหวานระยะสงบ ไม่ใช่หายขาด', b: '<ul><li>ห้ามหยุดยาเอง ให้แพทย์/พยาบาลเป็นผู้ปรับยา</li><li>ยังต้องมาตรวจตามนัดและเจาะเลือดทุกครั้ง</li><li>ถ้าน้ำหนักกลับขึ้น น้ำตาลก็กลับมาสูงได้</li></ul>' }
  ]
};
function renderKb() {
  const list = KB[GROUP].concat(KB.both), read = new Set(store.get('kbRead') || []);
  $('kbSub').textContent = GNAME[GROUP];
  const ti = new Date().getDate() % list.length;
  const card = (k, i, today) => '<div class="kb' + (today ? ' today open' : '') + '"><div class="kh" onclick="this.parentNode.classList.toggle(\'open\')"><span class="em">' + k.e + '</span>' + k.t + '<span class="rd">' + (read.has(GROUP + i) ? '✓ อ่านแล้ว' : '') + '</span></div><div class="kb-body">' + k.b + (read.has(GROUP + i) ? '' : '<button class="read" onclick="markRead(' + i + ')">✓ อ่านแล้ว</button>') + '</div></div>';
  $('kbToday').innerHTML = card(list[ti], ti, true);
  $('kbList').innerHTML = list.map((k, i) => card(k, i, false)).join('');
  $('kbCount').textContent = 'อ่านแล้ว ' + list.filter((k, i) => read.has(GROUP + i)).length + '/' + list.length;
}
function markRead(i) { const r = new Set(store.get('kbRead') || []); r.add(GROUP + i); store.set('kbRead', [...r]); renderKb(); }

boot();
