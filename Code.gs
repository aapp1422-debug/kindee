/**
 * ระบบบันทึกพฤติกรรม "กลุ่มชะลอไต / กลุ่มลดหวานลดพุง"
 * รพ.สต.บ้านนาเพียงใหม่ — Backend (Google Apps Script + Google Sheets)
 * ฐานข้อมูล + API (v2: ระยะ CKD 3a/3b + โปรตีน, กลุ่มลดหวานบันทึกปริมาณราย 3 มื้อ, เมนูอีสานเพิ่ม)
 * อัปเดตจาก v1: วางโค้ดทับ → Run setup() 1 ครั้ง → Deploy เวอร์ชันใหม่ (ข้อมูลเดิมไม่หาย)
 *
 * วิธีใช้ (สรุป): วางโค้ดนี้ใน Apps Script ของ Google Sheet → รัน setup() 1 ครั้ง
 * → ตั้งรหัสเจ้าหน้าที่ด้วย setStaffPassword() → Deploy เป็น Web app
 */

/* ======================= ตั้งค่า ======================= */
const TZ = 'Asia/Bangkok';
const SHEETS = {
  Patients:    ['patient_id','token','name','age','moo','group','recorder','osm','phone','water_goal','move_goal','start_date','consent_date','status','created_at','ckd_stage','protein_goal'],
  WeeklyGoals: ['patient_id','week_start','goal_text','set_by','created_at'],
  DailyLog:    ['patient_id','date','recorder','meals_json','veg','rice','soup_lv','dip_lv','season','sweet','water','move_types','move_min','med','nsaid','nsaid_types','herb','hypo','dtx','bp','weight','created_at','updated_at',
                'protein','rice_white','veg_palm','fruit_n','milk_n','snack_n','coffee_n','energy_n','soda_n','noodle_n','supp_n','dm_meals_json'],
  Labs:        ['lab_id','patient_id','date','type','value','recorded_by','created_at'],
  Alerts:      ['alert_id','patient_id','date','type','level','message','status','follow_how','follow_note','follow_by','follow_at'],
  Notes:       ['note_id','patient_id','datetime','by','text'],
  FoodList:    ['code','name','emoji','salty','carb','active'],
  PushTokens:  ['patient_id','fcm_token','device','updated_at']
};
const FOODS = [
  ['F01','ส้มตำปลาร้า','🥗',1,0],['F02','แกงหน่อไม้','🍲',1,0],['F03','ป่นปลา / ซุบหน่อไม้','🐟',1,0],['F04','อ่อม / แกงอ่อม','🥘',1,0],
  ['F05','ปิ้งย่าง / ไก่ย่าง','🍖',0,0],['F06','ลาบ / ก้อย','🥩',1,0],['F07','ก๋วยเตี๋ยว','🍜',1,1],['F08','ปลานึ่ง / ต้ม','🐠',0,0],
  ['F09','ไข่ต้ม / ไข่เจียว','🥚',0,0],['F10','ผลไม้หวาน','🍌',0,1],['F11','ขนม / ของหวาน','🍰',0,1],['F12','ข้าวเจ้า','🍚',0,1],
  ['F13','แกงเห็ด','🍄',1,0],['F14','แกงผักหวาน','🥬',1,0],['F15','ต้มแซ่บ','🌶️',1,0],['F16','หมกปลา / หมกหน่อไม้','🍃',1,0],
  ['F17','แจ่วบอง / ปลาร้าบอง','🫙',1,0],['F18','ตำซั่ว / ตำถาด','🥗',1,1],['F19','ไข่มดแดง / ก้อยไข่มดแดง','🐜',1,0],['F20','ปลาส้ม / ปลาร้าทอด','🐟',1,0],
  ['F21','ไส้กรอกอีสาน / หมูยอ','🌭',1,0],['F22','จิ้มจุ่ม / หมูกระทะ','🍢',1,0],['F23','ขนมจีนน้ำยา / น้ำแจ่ว','🍝',1,1],['F24','บะหมี่กึ่งสำเร็จรูป','🍜',1,1],
  ['F25','ต้มไก่บ้าน / ต้มไก่ใบมะขาม','🐔',1,0],['F26','ผัดผัก','🥦',1,0],['F27','ต้มจืด / แกงจืด','🥣',0,0],['F28','ข้าวเปียกเส้น / ข้าวต้ม','🍲',1,1],
  ['F29','หลนปลาร้า / ปลาร้าสับ','🐠',1,0],['F30','ซุบมะเขือ / ซุบเห็ด','🍆',1,0],['F31','ไก่ทอด / หมูทอด','🍗',0,0],['F32','ปลาปิ้ง / ปลาเผา','🔥',0,0]
];
const LAB_RANGE = { HbA1c:[4,15], eGFR:[3,150], salt:[0,3], weight:[30,200] };
const LOG_FIELDS = SHEETS.DailyLog.filter(h => ['patient_id', 'date', 'created_at', 'updated_at'].indexOf(h) < 0);
const DEFAULT_PROTEIN_GOAL = 8; // ช้อนกินข้าว/วัน (ไข่ 1 ฟอง = 2 ช้อน) — เจ้าหน้าที่ปรับรายคน

/* ======================= ติดตั้ง ======================= */
function setup() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(TZ);
  Object.keys(SHEETS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const head = SHEETS[name];
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  const food = ss.getSheetByName('FoodList');
  const have = {}; rows_('FoodList').forEach(f => have[f.code] = 1);
  const add = FOODS.filter(f => !have[f[0]]).map(f => f.concat([1]));
  if (add.length) food.getRange(food.getLastRow() + 1, 1, add.length, 6).setValues(add); // เติมเฉพาะเมนูที่ยังไม่มี
  // คอลัมน์รหัส/วันที่ ให้เก็บเป็นข้อความ (กัน Sheets แปลงเป็นตัวเลข/วันที่)
  [['Patients',1],['Patients',2],['WeeklyGoals',1],['WeeklyGoals',2],['DailyLog',1],['DailyLog',2],['DailyLog',20],['DailyLog',35],['Labs',2],['Labs',3],['Alerts',2],['Alerts',3],['Notes',2],['PushTokens',1]]
    .forEach(([n,c]) => ss.getSheetByName(n).getRange(1, c, 1000, 1).setNumberFormat('@'));
  const d = ss.getSheetByName('Sheet1') || ss.getSheetByName('แผ่น1');
  if (d && d.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(d);
  Logger.log('✅ สร้างชีตครบแล้ว');
}

/** ตั้งรหัสผ่านเจ้าหน้าที่ — แก้คำว่า 'เปลี่ยนรหัสตรงนี้' แล้วกด Run 1 ครั้ง */
function setStaffPassword() {
  const pw = 'เปลี่ยนรหัสตรงนี้';
  if (pw === 'เปลี่ยนรหัสตรงนี้' || pw.length < 6) throw new Error('กรุณาแก้รหัสผ่านในโค้ดก่อน (อย่างน้อย 6 ตัว)');
  PropertiesService.getScriptProperties().setProperty('STAFF_PW_HASH', hash_(pw));
  Logger.log('✅ ตั้งรหัสผ่านเจ้าหน้าที่แล้ว (ลบรหัสออกจากโค้ดได้เลย)');
}

/** (ไม่บังคับ) แจ้งเตือน red flag ด่วนเข้า Telegram */
function setTelegram() {
  const BOT_TOKEN = 'ใส่ BOT TOKEN';
  const CHAT_ID = 'ใส่ CHAT ID';
  PropertiesService.getScriptProperties().setProperties({ TG_TOKEN: BOT_TOKEN, TG_CHAT: CHAT_ID });
  sendTelegram_('✅ ทดสอบ: เชื่อมระบบบันทึกพฤติกรรมกับ Telegram แล้ว');
}

/** ตั้งเวลาตรวจทุกวัน 20:00 (รัน 1 ครั้ง) */
function setupTriggers() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'dailyCheck').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyCheck').timeBased().atHour(20).everyDays(1).inTimezone(TZ).create();
  Logger.log('✅ ตั้งเวลาตรวจทุกวัน 20:00 แล้ว');
}

/* ======================= Web API ======================= */
function doGet(e) {
  return json_({ ok: true, app: 'kindee-backend', time: now_() });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'รูปแบบข้อมูลไม่ถูกต้อง' }); }
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const fn = ROUTES[req.action];
    if (!fn) return json_({ ok: false, error: 'ไม่รู้จักคำสั่ง ' + req.action });
    return json_(Object.assign({ ok: true }, fn(req)));
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

const ROUTES = {
  /* ---------- ฝั่งผู้ป่วย (ยืนยันตัวด้วย token ในลิงก์) ---------- */
  me:         r => { const p = patientByToken_(r.token); return { patient: publicPatient_(p), foods: foods_(), today: today_(), log: getLog_(p.patient_id, today_()), goal: currentGoal_(p.patient_id), streak: streak_(p.patient_id) }; },
  saveLog:    r => saveLog_(patientByToken_(r.token), r.log, r.recorder || 'ผู้ป่วย'),
  results:    r => results_(patientByToken_(r.token)),
  setGoal:    r => { const p = patientByToken_(r.token); setGoal_(p.patient_id, r.goal_text, 'ผู้ป่วย'); return {}; },
  savePush:   r => { const p = patientByToken_(r.token); upsert_('PushTokens', ['patient_id'], { patient_id: p.patient_id, fcm_token: r.fcm_token, device: r.device || '', updated_at: now_() }); return {}; },

  /* ---------- ฝั่งเจ้าหน้าที่ / อสม. ---------- */
  login:      r => { if (hash_(r.password || '') !== prop_('STAFF_PW_HASH')) throw new Error('รหัสผ่านไม่ถูกต้อง');
                     const s = Utilities.getUuid(); CacheService.getScriptCache().put('S_' + s, r.name || 'เจ้าหน้าที่', 21600); return { session: s, name: r.name || 'เจ้าหน้าที่' }; },
  overview:   r => { staff_(r); return overview_(); },
  patient:    r => { staff_(r); return patientDetail_(r.patient_id); },
  register:   r => register_(r.data, staff_(r)),
  saveLab:    r => saveLab_(r.patient_id, r.type, r.value, r.date, staff_(r)),
  saveNote:   r => { const by = staff_(r); requireText_(r.text, 'ข้อความบันทึก'); append_('Notes', { note_id: id_('N'), patient_id: r.patient_id, datetime: now_(), by, text: r.text }); return {}; },
  saveGoals:  r => { staff_(r); return saveGoals_(r.patient_id, r.water_goal, r.move_goal, r.ckd_stage, r.protein_goal); },
  followUp:   r => followUp_(r.alert_id, r.how, r.note, staff_(r)),
  staffLog:   r => saveLog_(patientById_(r.patient_id), r.log, staff_(r)) // อสม./ญาติ คีย์แทน
};

/* ======================= ผู้ป่วย ======================= */
function saveLog_(p, log, recorder) {
  if (!log || typeof log !== 'object') throw new Error('ไม่มีข้อมูลบันทึก');
  const date = log.date || today_();
  if (date > today_()) throw new Error('บันทึกล่วงหน้าไม่ได้');
  const row = { patient_id: p.patient_id, date, recorder, updated_at: now_() };
  LOG_FIELDS.forEach(k => { if (k in log) row[k] = (/_json$/.test(k) && typeof log[k] !== 'string') ? JSON.stringify(log[k]) : log[k]; });
  const isNew = upsert_('DailyLog', ['patient_id', 'date'], row, { created_at: now_() });
  const alerts = checkLogAlerts_(p, row);
  return { saved: true, isNew, alerts: alerts.map(a => a.message), streak: streak_(p.patient_id) };
}

function checkLogAlerts_(p, row) {
  const out = [];
  const dtx = Number(row.dtx);
  if (truthy_(row.hypo) || (dtx && dtx < 70)) out.push(['hypo', 3, 'น้ำตาลต่ำ' + (dtx ? ' DTX ' + dtx : '') + ' (' + row.date + ')']);
  if (truthy_(row.nsaid)) out.push(['nsaid', 3, 'ใช้ยาแก้ปวด/ฉีดยา' + (row.nsaid_types ? ': ' + row.nsaid_types : '') + ' (' + row.date + ')']);
  if (row.med === 'ไม่ได้กิน') out.push(['med', 2, 'ไม่ได้กินยา/หยุดยาเอง (' + row.date + ')']);
  return out.map(([type, level, msg]) => addAlert_(p, type, level, msg, row.date)).filter(Boolean);
}

function results_(p) {
  const logs = rows_('DailyLog').filter(r => r.patient_id === p.patient_id).sort((a, b) => a.date < b.date ? -1 : 1);
  const labs = rows_('Labs').filter(r => r.patient_id === p.patient_id).sort((a, b) => a.date < b.date ? -1 : 1);
  return {
    patient: publicPatient_(p),
    last14: logs.filter(l => l.date >= daysAgo_(13)),
    labs: labs.map(l => ({ date: l.date, type: l.type, value: Number(l.value) })),
    goal: currentGoal_(p.patient_id),
    lastGoal: lastWeekGoal_(p.patient_id),
    streak: streak_(p.patient_id)
  };
}

function setGoal_(pid, text, by) {
  requireText_(text, 'เป้าหมาย');
  upsert_('WeeklyGoals', ['patient_id', 'week_start'], { patient_id: pid, week_start: weekStart_(today_()), goal_text: text, set_by: by }, { created_at: now_() });
}

/* ======================= เจ้าหน้าที่ ======================= */
function register_(d, by) {
  if (!d) throw new Error('ไม่มีข้อมูล');
  requireText_(d.name, 'ชื่อ-สกุล');
  if (!(d.age >= 18 && d.age <= 100)) throw new Error('อายุไม่ถูกต้อง');
  if (['ckd', 'dm'].indexOf(d.group) < 0) throw new Error('กรุณาเลือกกลุ่ม');
  if (!d.consent) throw new Error('ต้องได้รับความยินยอมก่อนลงทะเบียน');
  const base = Number(d.baseline_lab);
  const labType = d.group === 'ckd' ? 'eGFR' : 'HbA1c';
  checkRange_(labType, base);
  if (d.group === 'dm') checkRange_('weight', Number(d.weight));
  const n = rows_('Patients').length + 1;
  const pid = 'P' + ('000' + n).slice(-3);
  const token = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  append_('Patients', { patient_id: pid, token, name: d.name, age: d.age, moo: d.moo, group: d.group, recorder: d.recorder || 'ผู้ป่วยบันทึกเอง',
    osm: d.osm || '', phone: d.phone || '', water_goal: d.water_goal || 8, move_goal: d.move_goal || 30, start_date: today_(), consent_date: today_(), status: 'active', created_at: now_(),
    ckd_stage: d.group === 'ckd' ? (['3a', '3b'].indexOf(d.ckd_stage) >= 0 ? d.ckd_stage : stageFromEgfr_(base)) : '',
    protein_goal: d.group === 'ckd' ? (Number(d.protein_goal) || DEFAULT_PROTEIN_GOAL) : '' });
  append_('Labs', { lab_id: id_('L'), patient_id: pid, date: d.lab_date || today_(), type: labType, value: base, recorded_by: by, created_at: now_() });
  if (d.weight) append_('Labs', { lab_id: id_('L'), patient_id: pid, date: today_(), type: 'weight', value: Number(d.weight), recorded_by: by, created_at: now_() });
  return { patient_id: pid, token, ckd_stage: d.group === 'ckd' ? (['3a', '3b'].indexOf(d.ckd_stage) >= 0 ? d.ckd_stage : stageFromEgfr_(base)) : '' };
}

function saveLab_(pid, type, value, date, by) {
  const p = patientById_(pid);
  if (!LAB_RANGE[type]) throw new Error('ประเภทผลตรวจไม่ถูกต้อง');
  const v = Number(value);
  checkRange_(type, v);
  date = date || today_();
  const prev = rows_('Labs').filter(l => l.patient_id === pid && l.type === type).sort((a, b) => a.date < b.date ? -1 : 1).pop();
  append_('Labs', { lab_id: id_('L'), patient_id: pid, date, type, value: v, recorded_by: by, created_at: now_() });
  const alerts = [];
  if (type === 'eGFR' && prev && Number(prev.value) - v > 2) alerts.push(addAlert_(p, 'egfr', 3, 'eGFR ลดลง ' + (Number(prev.value) - v) + ' (' + prev.value + ' → ' + v + ')', date));
  if (type === 'HbA1c' && prev && v >= Number(prev.value)) alerts.push(addAlert_(p, 'a1c', 2, 'HbA1c ไม่ลดลง (' + prev.value + ' → ' + v + '%)', date));
  if (type === 'salt' && v > 0.9) alerts.push(addAlert_(p, 'salt', 1, 'แกงเค็มมาก ' + v + '%', date));
  return { saved: true, alerts: alerts.filter(Boolean).map(a => a.message) };
}

function saveGoals_(pid, w, m, stage, prot) {
  w = Number(w); m = Number(m);
  if (!(w >= 1 && w <= 20) || !(m >= 0 && m <= 180)) throw new Error('เป้าหมายไม่ถูกต้อง (น้ำ 1–20 แก้ว, ออกแรง 0–180 นาที)');
  const p = patientById_(pid);
  const upd = { patient_id: pid, water_goal: w, move_goal: m };
  if (p.group === 'ckd') {
    if (stage !== undefined) { if (['3a', '3b'].indexOf(stage) < 0) throw new Error('ระยะ CKD ต้องเป็น 3a หรือ 3b'); upd.ckd_stage = stage; }
    if (prot !== undefined && prot !== '') { prot = Number(prot); if (!(prot >= 2 && prot <= 30)) throw new Error('เป้าโปรตีนต้องอยู่ระหว่าง 2–30 ช้อนกินข้าว/วัน'); upd.protein_goal = prot; }
  }
  upsert_('Patients', ['patient_id'], upd);
  return {};
}

function followUp_(alertId, how, note, by) {
  requireText_(note, 'สรุปการติดตาม');
  const a = rows_('Alerts').find(r => r.alert_id === alertId);
  if (!a) throw new Error('ไม่พบรายการแจ้งเตือน');
  upsert_('Alerts', ['alert_id'], { alert_id: alertId, status: 'done', follow_how: how || '', follow_note: note, follow_by: by, follow_at: now_() });
  append_('Notes', { note_id: id_('N'), patient_id: a.patient_id, datetime: now_(), by, text: '[' + (how || 'ติดตาม') + '] ' + note });
  return {};
}

function overview_() {
  const pts = rows_('Patients').filter(p => p.status === 'active');
  const logs = rows_('DailyLog').filter(l => l.date >= daysAgo_(13));
  const labs = rows_('Labs');
  const alerts = rows_('Alerts');
  const t = today_();
  return {
    today: t,
    patients: pts.map(p => {
      const L = logs.filter(l => l.patient_id === p.patient_id);
      const last7 = L.filter(l => l.date >= daysAgo_(6));
      const labType = p.group === 'ckd' ? 'eGFR' : 'HbA1c';
      const lab = labs.filter(l => l.patient_id === p.patient_id && l.type === labType).sort((a, b) => a.date < b.date ? -1 : 1).pop();
      return { patient_id: p.patient_id, name: p.name, age: p.age, moo: p.moo, group: p.group, ckd_stage: stageOf_(p), osm: p.osm,
        recToday: L.some(l => l.date === t), rec7: last7.length, goalPct: goalPct_(p, last7), noRecDays: noRecDays_(p, L),
        lastLab: lab ? { type: labType, value: Number(lab.value), date: lab.date } : null,
        openAlerts: alerts.filter(a => a.patient_id === p.patient_id && a.status === 'open').length };
    }),
    alerts: alerts.filter(a => a.status === 'open' || a.follow_at >= daysAgo_(7)).map(a => Object.assign({}, a, { level: Number(a.level) }))
  };
}

function patientDetail_(pid) {
  const p = patientById_(pid);
  const r = results_(p);
  r.patient = Object.assign({}, p, { ckd_stage: stageOf_(p), protein_goal: Number(p.protein_goal) || DEFAULT_PROTEIN_GOAL }); // เจ้าหน้าที่เห็นข้อมูลเต็ม (รวม token ไว้สร้าง QR)
  r.notes = rows_('Notes').filter(n => n.patient_id === pid).sort((a, b) => a.datetime > b.datetime ? -1 : 1);
  r.alerts = rows_('Alerts').filter(a => a.patient_id === pid).sort((a, b) => a.date > b.date ? -1 : 1);
  return r;
}

/* ======================= ตรวจรายวัน (trigger 20:00) ======================= */
function dailyCheck() {
  const pts = rows_('Patients').filter(p => p.status === 'active');
  const logs = rows_('DailyLog').filter(l => l.date >= daysAgo_(13));
  const notRecordedToday = [];
  pts.forEach(p => {
    const L = logs.filter(l => l.patient_id === p.patient_id);
    if (!L.some(l => l.date === today_())) notRecordedToday.push(p);
    const nr = noRecDays_(p, L);
    if (nr >= 3) addAlert_(p, 'norec', 2, 'ไม่บันทึก ' + nr + ' วัน → ส่ง ' + (p.osm || 'อสม.') + ' ติดตาม', today_(), true);
    if (p.group === 'dm') {
      const hi = L.filter(l => l.date >= daysAgo_(2) && Number(l.dtx) >= 180).length;
      if (hi >= 2) addAlert_(p, 'dtxhi', 2, 'DTX ≥180 จำนวน ' + hi + ' ใน 3 วันล่าสุด', today_(), true);
    }
  });
  // ขั้นที่ 4: ส่ง push เตือนคนที่ยังไม่บันทึก (Firebase) — จะเพิ่มภายหลัง
  Logger.log('ยังไม่บันทึกวันนี้: ' + notRecordedToday.length + ' ราย');
  return notRecordedToday.length;
}

/* ======================= แจ้งเตือน (Alerts) ======================= */
/** สร้างแจ้งเตือน — ถ้ามีประเภทเดียวกันที่ยังเปิดอยู่ จะไม่สร้างซ้ำ */
function addAlert_(p, type, level, message, date, dedupeOpen) {
  const open = rows_('Alerts').filter(a => a.patient_id === p.patient_id && a.type === type && a.status === 'open');
  if (open.some(a => a.date === date) || (dedupeOpen && open.length)) return null;
  const a = { alert_id: id_('A'), patient_id: p.patient_id, date, type, level, message, status: 'open' };
  append_('Alerts', a);
  if (level >= 3) sendTelegram_('🚩 ด่วน: ' + message + '\n👤 ' + p.patient_id + ' หมู่ ' + p.moo); // ไม่ส่งชื่อผู้ป่วยออกนอกระบบ
  return a;
}

function sendTelegram_(text) {
  const t = prop_('TG_TOKEN'), c = prop_('TG_CHAT');
  if (!t || !c || t.indexOf('ใส่') === 0) return;
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + t + '/sendMessage', { method: 'post', payload: { chat_id: c, text }, muteHttpExceptions: true });
  } catch (e) { Logger.log('Telegram error: ' + e); }
}

/* ======================= คำนวณ ======================= */
function goalPct_(p, logs) {
  let t = 0, g = 0;
  logs.forEach(l => {
    const checks = [Number(l.water) >= Number(p.water_goal || 8), Number(l.move_min) >= Number(p.move_goal || 30), l.med === 'ครบ'];
    if (p.group === 'ckd') {
      checks.push(!(Number(l.soup_lv) >= 2 || Number(l.dip_lv) >= 2 || truthy_(l.season)));
      if (stageOf_(p) === '3b' && l.protein !== '' && l.protein !== undefined) checks.push(Number(l.protein) <= (Number(p.protein_goal) || DEFAULT_PROTEIN_GOAL));
    } else checks.push(dmCarbOk_(l));
    checks.forEach(c => { t++; if (c) g++; });
  });
  return t ? Math.round(g / t * 100) : 0;
}
/** กลุ่มลดหวาน: ข้าว/เส้นไม่เกิน 2 หน่วยต่อมื้อ และไม่มีเครื่องดื่มหวาน (ถ้ายังเป็นข้อมูลแบบเดิม ใช้เกณฑ์เดิม) */
function dmCarbOk_(l) {
  let meals = [];
  try { meals = l.dm_meals_json ? JSON.parse(l.dm_meals_json) : []; } catch (e) {}
  if (!meals.length) return !(Number(l.rice) > 2 || truthy_(l.sweet));
  const perMeal = meals.every(m => (Number(m.rice_white) || 0) + (Number(m.rice_sticky) || 0) + (Number(m.noodle_n) || 0) <= 2);
  return perMeal && !truthy_(l.sweet);
}
function noRecDays_(p, L) {
  const dates = {}; L.forEach(l => dates[l.date] = 1);
  let n = 0;
  for (let i = 0; i < 14; i++) { const d = daysAgo_(i); if (d < p.start_date) break; if (dates[d]) break; n++; }
  return n;
}
function streak_(pid) {
  const dates = {}; rows_('DailyLog').filter(l => l.patient_id === pid).forEach(l => dates[l.date] = 1);
  let n = 0, i = dates[today_()] ? 0 : 1;
  while (dates[daysAgo_(i)]) { n++; i++; }
  return n;
}
function currentGoal_(pid) {
  const g = rows_('WeeklyGoals').filter(r => r.patient_id === pid && r.week_start === weekStart_(today_())).pop();
  return g ? g.goal_text : '';
}
function lastWeekGoal_(pid) {
  const ws = weekStart_(daysAgo_(7));
  const g = rows_('WeeklyGoals').filter(r => r.patient_id === pid && r.week_start === ws).pop();
  return g ? g.goal_text : '';
}

/* ======================= ช่วยเหลือ: ข้อมูล ======================= */
function sheet_(n) { const s = SpreadsheetApp.getActive().getSheetByName(n); if (!s) throw new Error('ไม่พบชีต ' + n + ' (รัน setup ก่อน)'); return s; }
function rows_(n) {
  const sh = sheet_(n), last = sh.getLastRow();
  if (last < 2) return [];
  const head = SHEETS[n];
  return sh.getRange(2, 1, last - 1, head.length).getValues().map(r => {
    const o = {}; head.forEach((h, i) => o[h] = (r[i] instanceof Date) ? Utilities.formatDate(r[i], TZ, (h === 'date' || h.indexOf('_date') > 0 || h === 'week_start') ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm:ss") : r[i]); return o;
  });
}
function append_(n, obj) { const head = SHEETS[n]; sheet_(n).appendRow(head.map(h => obj[h] === undefined ? '' : obj[h])); }
/** อัปเดตแถวที่ key ตรงกัน (แก้เฉพาะคอลัมน์ที่ส่งมา) ถ้าไม่มีให้เพิ่มแถวใหม่ — คืนค่า true ถ้าเพิ่มใหม่ */
function upsert_(n, keys, obj, onInsert) {
  const sh = sheet_(n), head = SHEETS[n], data = rows_(n);
  const idx = data.findIndex(r => keys.every(k => String(r[k]) === String(obj[k])));
  if (idx < 0) { append_(n, Object.assign({}, onInsert || {}, obj)); return true; }
  const row = idx + 2;
  Object.keys(obj).forEach(k => { const c = head.indexOf(k); if (c >= 0) sh.getRange(row, c + 1).setValue(obj[k]); });
  return false;
}
function getLog_(pid, date) { return rows_('DailyLog').find(r => r.patient_id === pid && r.date === date) || null; }
function foods_() { return rows_('FoodList').filter(f => truthy_(f.active)).map(f => ({ code: f.code, name: f.name, emoji: f.emoji, salty: truthy_(f.salty), carb: truthy_(f.carb) })); }
function patientByToken_(tok) {
  if (!tok || String(tok).length < 10) throw new Error('ลิงก์ไม่ถูกต้อง');
  tok = String(tok).trim();
  const p = rows_('Patients').find(r => String(r.token).trim() === tok && String(r.status).trim() === 'active');
  if (!p) throw new Error('ไม่พบผู้ใช้ หรือสิ้นสุดโครงการแล้ว กรุณาติดต่อ รพ.สต.');
  return p;
}
function patientById_(pid) { const p = rows_('Patients').find(r => r.patient_id === pid); if (!p) throw new Error('ไม่พบผู้ป่วย ' + pid); return p; }
function publicPatient_(p) { return { patient_id: p.patient_id, name: p.name, group: p.group, ckd_stage: stageOf_(p), protein_goal: Number(p.protein_goal) || DEFAULT_PROTEIN_GOAL, water_goal: Number(p.water_goal), move_goal: Number(p.move_goal), start_date: p.start_date }; }
/** ระยะ CKD: ใช้ค่าที่เจ้าหน้าที่ตั้ง ถ้าไม่มีคิดจาก eGFR ล่าสุด (≥45 = 3a, <45 = 3b) */
function stageOf_(p) {
  if (p.group !== 'ckd') return '';
  if (p.ckd_stage === '3a' || p.ckd_stage === '3b') return p.ckd_stage;
  const e = rows_('Labs').filter(l => l.patient_id === p.patient_id && l.type === 'eGFR').sort((a, b) => a.date < b.date ? -1 : 1).pop();
  return e && Number(e.value) < 45 ? '3b' : '3a';
}
const stageFromEgfr_ = v => Number(v) < 45 ? '3b' : '3a';
function staff_(r) { const n = CacheService.getScriptCache().get('S_' + (r.session || '')); if (!n) throw new Error('กรุณาเข้าสู่ระบบใหม่'); return n; }

/* ======================= ช่วยเหลือ: ทั่วไป ======================= */
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function hash_(s) { return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'kindee:' + s, Utilities.Charset.UTF_8)); }
function now_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss"); }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function daysAgo_(n) { const d = new Date(); d.setDate(d.getDate() - n); return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }
function weekStart_(ymd) { const d = new Date(ymd + 'T12:00:00+07:00'); const wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd); return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }
function id_(prefix) { return prefix + Utilities.formatDate(new Date(), TZ, 'yyMMddHHmmss') + Math.floor(Math.random() * 1000); }
function truthy_(v) { return v === true || v === 1 || v === '1' || v === 'TRUE' || v === 'true'; }
function requireText_(v, name) { if (!v || !String(v).trim()) throw new Error('กรุณากรอก' + name); }
function checkRange_(type, v) { const r = LAB_RANGE[type]; if (isNaN(v) || v < r[0] || v > r[1]) throw new Error('ค่า ' + type + ' ต้องอยู่ระหว่าง ' + r[0] + '–' + r[1]); }

/* ======================= ทดสอบ (รันใน editor) ======================= */
/** สร้างผู้ป่วยทดสอบ 1 ราย + บันทึก 1 วัน แล้วแสดงผลใน Log — ลบแถวทดสอบออกได้ภายหลัง */
function testAll() {
  setup();
  CacheService.getScriptCache().put('S_test', 'ทดสอบ', 600);
  const reg = ROUTES.register({ session: 'test', data: { name: 'ทดสอบ ระบบ', age: 55, moo: 1, group: 'ckd', baseline_lab: 48, consent: true } });
  Logger.log('ลงทะเบียน: ' + JSON.stringify(reg));
  const me = ROUTES.me({ token: reg.token });
  Logger.log('อาหาร ' + me.foods.length + ' รายการ, วันนี้ ' + me.today);
  const s = ROUTES.saveLog({ token: reg.token, log: { meals_json: [{ meal: 'เช้า', items: ['F01'], other: '' }], water: 6, move_min: 30, med: 'ครบ', soup_lv: 1, dip_lv: 1, season: 0, nsaid: 1, nsaid_types: 'ยาชุด', herb: 0 } });
  Logger.log('บันทึก: ' + JSON.stringify(s));
  Logger.log('ผลตรวจ: ' + JSON.stringify(ROUTES.saveLab({ session: 'test', patient_id: reg.patient_id, type: 'eGFR', value: 44 })));
  Logger.log('ภาพรวม: ' + JSON.stringify(ROUTES.overview({ session: 'test' }).patients.slice(-1)));
  Logger.log('ลิงก์ผู้ป่วยทดสอบ token = ' + reg.token);
}
