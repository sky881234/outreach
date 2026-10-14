// Outreach engine: sends the first email, follows up until reply, tracks results.
// Runs inside the "Outreach" Google Sheet. SECRET lives in Secret.js (generated, not shared).

const SHEETS = {
  Leads: ['lead_id', 'added_at', 'status', 'email', 'first_name', 'company', 'channel_url', 'topic', 'hook',
    'touches', 'tz', 'video_url', 'video_id', 'thumb_file_id', 'initial_template', 'subject', 'thread_id',
    'rfc_msg_id', 'step', 'first_sent_at', 'last_sent_at', 'next_send_at', 'next_send_local', 'last_template',
    'last_touch', 'views_baseline', 'views', 'seen', 'replied_at', 'reply_snippet', 'errors', 'last_error', 'notes', 'opens', 'clicks', 'opened_at', 'clicked_at'],
  Templates: ['template_id', 'kind', 'branch', 'subject', 'body', 'active', 'notes'],
  Touches: ['touch_id', 'text', 'active'],
  Events: ['ts', 'lead_id', 'email', 'event', 'step', 'template_id', 'touch_id', 'initial_template', 'detail'],
  Stats: [],
  Settings: ['key', 'value', 'notes'],
};

const DEFAULT_SETTINGS = [
  ['SEND_HOUR_LOCAL', 9, "Start of the send window (prospect's local time)"],
  ['SEND_WINDOW_HOURS', 3, 'Each email gets a random time inside this window, e.g. 9:00-12:00'],
  ['MAX_SENDS_PER_RUN', 2, 'Engine runs every 10 min; at most this many emails per run, 30-90s apart'],
  ['FOLLOWUP_GAP_DAYS', 2, 'Days between follow-ups'],
  ['MAX_FOLLOWUPS', 10, 'Follow-ups after the first email'],
  ['DAILY_SEND_CAP', 60, 'Max emails per 24h (free Gmail hard limit is ~100)'],
  ['SKIP_WEEKENDS', 'FALSE', 'TRUE = never send on Sat/Sun (prospect time)'],
  ['DEFAULT_TZ', 'America/New_York', 'Used when a lead has no timezone'],
  ['PAUSED', 'FALSE', 'TRUE = stop all sending'],
  ['TRACKING_URL', '', 'Cloudflare worker for open/click tracking; blank = no tracking'],
  ['TELEGRAM_BOT_TOKEN', '', 'Leave blank: reply alerts are configured privately in Script Properties'],
  ['TELEGRAM_CHAT_ID', '', 'Leave blank unless overriding the alert chat'],
];

const DEFAULT_TEMPLATES = [
  ['I1', 'initial', 'any', 'Question About {topic}',
    'Hey {first_name},\n\n{hook}\n\nBut creating videos constantly is exhausting.\n\nShort form content fixes that exactly.\n\nWatch one made specifically for you:\n{thumbnail}\n\nReply if interested.\n\nCordially yours,\nMatthew',
    true, 'Original'],
  ['FU1', 'followup', 'unseen', '',
    'Hey {first_name},\n\nNoticed you have not seen the video made for you!\n\n{touch}\n\nWatch how it works:\n{thumbnail}\n\nReply if interested.\n\nCordially yours,\nMatthew.',
    true, 'Original'],
  ['FS1', 'followup', 'seen', '',
    'Noticed you have seen the video!\n\n{touch}\n\nReply and I can send you the download link to test the results.\n\nCordially yours,\nMatthew',
    true, 'Original'],
];

const DEFAULT_TOUCHES = [
  ['T1', 'This solution does not require you to do any extra work to get results.', true],
];

const ACTIVE_STATES = ['scheduled', 'active', 'finished'];
const THUMB = '\u0000THUMB\u0000';

// ---------- setup ----------

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
  ss.setSpreadsheetTimeZone('Asia/Hong_Kong');
  Object.keys(SHEETS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const headers = SHEETS[name];
    if (headers.length && sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  const seed = (name, rows) => {
    const sh = ss.getSheetByName(name);
    if (sh.getLastRow() <= 1) sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  };
  seed('Settings', DEFAULT_SETTINGS);
  seed('Templates', DEFAULT_TEMPLATES);
  seed('Touches', DEFAULT_TOUCHES);
  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  installTrigger_();
  thumbFolder_();
  // Touch every service once so the consent screen covers them all.
  Gmail.Users.getProfile('me');
  YouTube.Videos.list('statistics', { id: 'dQw4w9WgXcQ' });
  Logger.log('Setup done. Sheet: ' + ss.getUrl());
}

function installTrigger_() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(10).create();
}

// Re-run after code updates: refreshes the trigger, adds new columns and new Settings rows.
function upgrade_() {
  installTrigger_();
  Object.keys(SHEETS).forEach(name => {
    const sh = ss_().getSheetByName(name);
    const want = SHEETS[name];
    if (!sh || !want.length) return;
    const have = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
    const missing = want.filter(h => have.indexOf(h) < 0);
    if (missing.length) {
      sh.getRange(1, sh.getLastColumn() + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    }
  });
  const have = {};
  table_('Settings').rows.forEach(r => { have[r.key] = true; });
  DEFAULT_SETTINGS.filter(r => !have[r[0]]).forEach(r => append_('Settings', { key: r[0], value: r[1], notes: r[2] }));
  return { ok: true, triggers: ScriptApp.getProjectTriggers().length };
}

// ---------- web app ----------

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.secret === SECRET && p.action === 'status') return json_(statusReport_());
  return ContentService.createTextOutput('ok');
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad json' });
  }
  if (req.secret !== SECRET) return json_({ ok: false, error: 'unauthorized' });
  // Tracking hits only append to Events (atomic), so they skip the lock and never wait on a send run.
  if (req.action === 'track') {
    append_('Events', {
      ts: new Date(), lead_id: req.lead_id, event: req.kind === 'click' ? 'click' : 'open', step: req.step,
      detail: [req.country, req.ua].filter(Boolean).join(' | '),
    });
    return json_({ ok: true });
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    switch (req.action) {
      case 'preview': return json_(preview_(req.lead));
      case 'enqueue': return json_(enqueue_(req));
      case 'stop': return json_(stop_(req));
      case 'status': return json_(statusReport_());
      case 'run': tickInner_(true); return json_({ ok: true, status: statusReport_() });
      case 'upgrade': return json_(upgrade_());
      case 'set_telegram': return json_(setTelegram_(req));
      case 'set_setting': return json_(setSetting_(req.key, req.value));
      case 'events': return json_({ ok: true, events: table_('Events').rows.slice(-(req.limit || 20)) });
      default: return json_({ ok: false, error: 'unknown action ' + req.action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.stack || err) });
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- sheet helpers ----------

function ss_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function table_(name) {
  const sh = ss_().getSheetByName(name);
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const rows = values.slice(1).map((r, i) => {
    const o = { _row: i + 2 };
    headers.forEach((h, j) => { o[h] = r[j]; });
    return o;
  }).filter(o => headers.some(h => o[h] !== ''));
  return { sh, headers, rows };
}

function update_(name, rowNum, patch) {
  const sh = ss_().getSheetByName(name);
  const width = sh.getLastColumn();
  const headers = sh.getRange(1, 1, 1, width).getValues()[0];
  const range = sh.getRange(rowNum, 1, 1, width);
  const row = range.getValues()[0];
  headers.forEach((h, j) => { if (h in patch && patch[h] !== undefined) row[j] = patch[h]; });
  range.setValues([row]);
}

function append_(name, obj) {
  const sh = ss_().getSheetByName(name);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.appendRow(headers.map(h => (obj[h] === undefined ? '' : obj[h])));
  return sh.getLastRow();
}

function settings_() {
  const s = {};
  DEFAULT_SETTINGS.forEach(r => { s[r[0]] = r[1]; });
  table_('Settings').rows.forEach(r => { if (r.key) s[r.key] = r.value; });
  s.SEND_HOUR_LOCAL = Number(s.SEND_HOUR_LOCAL);
  s.SEND_WINDOW_HOURS = Math.max(1, Number(s.SEND_WINDOW_HOURS));
  s.MAX_SENDS_PER_RUN = Math.max(1, Number(s.MAX_SENDS_PER_RUN));
  s.FOLLOWUP_GAP_DAYS = Number(s.FOLLOWUP_GAP_DAYS);
  s.MAX_FOLLOWUPS = Number(s.MAX_FOLLOWUPS);
  s.DAILY_SEND_CAP = Number(s.DAILY_SEND_CAP);
  s.SKIP_WEEKENDS = String(s.SKIP_WEEKENDS).toUpperCase() === 'TRUE';
  s.PAUSED = String(s.PAUSED).toUpperCase() === 'TRUE';
  return s;
}

function logEvent_(lead, event, extra) {
  append_('Events', Object.assign({
    ts: new Date(), lead_id: lead.lead_id, email: lead.email, event,
    step: lead.step, initial_template: lead.initial_template,
  }, extra || {}));
}

function isTrue_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

// ---------- time ----------

function tzOffsetMs_(date, tz) {
  const s = Utilities.formatDate(date, tz, 'yyyy-MM-dd-HH-mm-ss').split('-').map(Number);
  return Date.UTC(s[0], s[1] - 1, s[2], s[3], s[4], s[5]) - Math.floor(date.getTime() / 1000) * 1000;
}

function localYMDH_(date, tz) {
  const s = Utilities.formatDate(date, tz, 'yyyy-MM-dd-HH').split('-').map(Number);
  return { y: s[0], m: s[1], d: s[2], h: s[3] };
}

function atLocal_(y, m, d, h, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const t = guess - tzOffsetMs_(new Date(guess), tz);
  return new Date(guess - tzOffsetMs_(new Date(t), tz));
}

// Send slot on (local date of `base` + addDays), pushed past weekends if configured.
function slot_(base, addDays, tz, s) {
  const p = localYMDH_(base, tz);
  const day = new Date(Date.UTC(p.y, p.m - 1, p.d + addDays));
  if (s.SKIP_WEEKENDS) {
    while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() + 1);
  }
  const minute = Math.floor(Math.random() * s.SEND_WINDOW_HOURS * 60);
  return atLocal_(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), s.SEND_HOUR_LOCAL, minute, tz);
}

function isWeekend_(date, tz) {
  const p = localYMDH_(date, tz);
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return dow === 0 || dow === 6;
}

function initialSlot_(now, tz, s) {
  const h = localYMDH_(now, tz).h;
  if (h < s.SEND_HOUR_LOCAL) return slot_(now, 0, tz, s);
  if (h < s.SEND_HOUR_LOCAL + s.SEND_WINDOW_HOURS - 1 && !(s.SKIP_WEEKENDS && isWeekend_(now, tz))) {
    return new Date(now.getTime() + Math.floor(Math.random() * 40) * 60000);
  }
  return slot_(now, 1, tz, s);
}

function fmtLocal_(date, tz) {
  return Utilities.formatDate(date, tz, 'EEE d MMM HH:mm') + ' (' + tz + ')';
}

// ---------- templates ----------

function usage_(field) {
  const counts = {};
  table_('Events').rows.forEach(e => {
    if (e.event === 'sent' && e[field]) counts[e[field]] = (counts[e[field]] || 0) + 1;
  });
  return counts;
}

// Least-used active template wins (random tiebreak), which keeps A/B arms balanced.
function pickTemplate_(kind, branch, forcedId) {
  const all = table_('Templates').rows;
  if (forcedId) {
    const t = all.find(r => r.template_id === forcedId);
    if (!t) throw new Error('template not found: ' + forcedId);
    return t;
  }
  const pool = all.filter(r => isTrue_(r.active) && r.kind === kind && (r.branch === 'any' || r.branch === branch));
  if (!pool.length) throw new Error('no active ' + kind + ' template for branch ' + branch);
  const used = usage_('template_id');
  pool.sort((a, b) => (used[a.template_id] || 0) - (used[b.template_id] || 0) || Math.random() - 0.5);
  return pool[0];
}

// Per-lead custom touches first (in order), then least-used Touches row this lead hasn't had.
function pickTouch_(lead, step) {
  let custom = [];
  try { custom = lead.touches ? JSON.parse(lead.touches) : []; } catch (e) { custom = []; }
  if (custom[step - 1]) return { touch_id: 'C' + step, text: custom[step - 1] };
  const had = {};
  table_('Events').rows.forEach(e => { if (e.lead_id === lead.lead_id && e.touch_id) had[e.touch_id] = true; });
  const pool = table_('Touches').rows.filter(r => isTrue_(r.active));
  if (!pool.length) return { touch_id: '', text: '' };
  const used = usage_('touch_id');
  const fresh = pool.filter(r => !had[r.touch_id]);
  const list = fresh.length ? fresh : pool;
  list.sort((a, b) => (used[a.touch_id] || 0) - (used[b.touch_id] || 0) || Math.random() - 0.5);
  return { touch_id: list[0].touch_id, text: list[0].text };
}

function fill_(str, lead, touch) {
  const vars = {
    first_name: lead.first_name, company: lead.company, topic: lead.topic, hook: lead.hook,
    touch: touch || '', video_url: lead.video_url,
  };
  return String(str || '')
    .replace(/\{thumbnail\}/g, THUMB)
    .replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k] || '') : m));
}

function esc_(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// track = {click, pixel} URLs from trackLinks_, or null to link straight to YouTube with no pixel.
function render_(tpl, lead, touch, track) {
  const body = fill_(tpl.body, lead, touch).replace(/\n{3,}/g, '\n\n').trim();
  const text = body.split(THUMB).join(lead.video_url);
  const href = track ? track.click : lead.video_url;
  const img = '<a href="' + href + '"><img src="cid:thumb" width="180" alt="Watch the video" ' +
    'style="display:block;width:180px;max-width:100%;border:0"></a>';
  const pixel = track ? '<img src="' + track.pixel + '" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">' : '';
  const html = '<div dir="ltr">' + body.split('\n').map(line =>
    line.indexOf(THUMB) >= 0 ? line.split(THUMB).map(esc_).join(img) : esc_(line)).join('<br>') + pixel + '</div>';
  return { subject: fill_(tpl.subject, lead, touch), text, html, hasThumb: body.indexOf(THUMB) >= 0 };
}

// Signed per-send token; the Cloudflare worker (tracker/worker.js) checks the same HMAC.
function trackLinks_(lead, step, s) {
  const base = String(s.TRACKING_URL || '').replace(/\/+$/, '');
  if (!base || !lead.lead_id || !lead.video_id) return null;
  const data = lead.lead_id + '.' + step + '.' + lead.video_id;
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(data, SECRET)).slice(0, 12);
  const token = data + '.' + sig;
  return { click: base + '/c/' + token, pixel: base + '/o/' + token + '.gif' };
}

// ---------- gmail ----------

function b64wrap_(bytesOrString) {
  return Utilities.base64Encode(bytesOrString).replace(/(.{76})/g, '$1\r\n');
}

function mime_(to, subject, text, html, thumbBlob, inReplyTo) {
  const alt = 'alt_' + Utilities.getUuid();
  const rel = 'rel_' + Utilities.getUuid();
  const enc = s => b64wrap_(Utilities.newBlob(s).getBytes());
  const out = [
    'To: ' + to,
    'Subject: =?UTF-8?B?' + Utilities.base64Encode(Utilities.newBlob(subject).getBytes()) + '?=',
    'MIME-Version: 1.0',
  ];
  if (inReplyTo) out.push('In-Reply-To: ' + inReplyTo, 'References: ' + inReplyTo);
  out.push('Content-Type: multipart/alternative; boundary="' + alt + '"', '',
    '--' + alt, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', enc(text),
    '--' + alt);
  if (thumbBlob) {
    out.push('Content-Type: multipart/related; boundary="' + rel + '"', '',
      '--' + rel, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', enc(html),
      '--' + rel, 'Content-Type: image/jpeg; name="video.jpg"', 'Content-Transfer-Encoding: base64',
      'Content-ID: <thumb>', 'Content-Disposition: inline; filename="video.jpg"', '',
      b64wrap_(thumbBlob.getBytes()), '--' + rel + '--');
  } else {
    out.push('Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', enc(html));
  }
  out.push('--' + alt + '--', '');
  return out.join('\r\n');
}

function send_(lead, rendered, subject, threadId, inReplyTo) {
  const thumb = rendered.hasThumb && lead.thumb_file_id ? DriveApp.getFileById(lead.thumb_file_id).getBlob() : null;
  const raw = Utilities.base64EncodeWebSafe(Utilities.newBlob(
    mime_(lead.email, subject, rendered.text, rendered.html, thumb, inReplyTo)).getBytes());
  const res = Gmail.Users.Messages.send(threadId ? { raw, threadId } : { raw }, 'me');
  const meta = Gmail.Users.Messages.get('me', res.id, { format: 'metadata', metadataHeaders: ['Message-ID'] });
  const h = (meta.payload.headers || []).find(x => x.name.toLowerCase() === 'message-id');
  return { id: res.id, threadId: res.threadId, rfcId: h ? h.value : '' };
}

function sentLast24h_() {
  const since = Date.now() - 24 * 3600 * 1000;
  return table_('Events').rows.filter(e => e.event === 'sent' && new Date(e.ts).getTime() > since).length;
}

function sendInitial_(lead, s) {
  const tpl = pickTemplate_('initial', 'any', lead.initial_template);
  const r = render_(tpl, lead, '', trackLinks_(lead, 0, s));
  const res = send_(lead, r, r.subject, null, null);
  const now = new Date();
  const tz = lead.tz || s.DEFAULT_TZ;
  const test = lead.status === 'test_pending';
  const next = slot_(now, s.FOLLOWUP_GAP_DAYS, tz, s);
  Object.assign(lead, {
    status: test ? 'test' : 'active', step: 0, initial_template: tpl.template_id, subject: r.subject,
    thread_id: res.threadId, rfc_msg_id: res.rfcId, first_sent_at: now, last_sent_at: now,
    next_send_at: test ? '' : next, next_send_local: test ? '' : fmtLocal_(next, tz),
    last_template: tpl.template_id, last_touch: '', errors: 0, last_error: '',
  });
  update_('Leads', lead._row, lead);
  logEvent_(lead, test ? 'test_sent' : 'sent', { template_id: tpl.template_id, detail: r.subject });
}

function sendFollowup_(lead, s) {
  const step = Number(lead.step) + 1;
  const branch = isTrue_(lead.seen) ? 'seen' : 'unseen';
  const tpl = pickTemplate_('followup', branch, null);
  const touch = pickTouch_(lead, step);
  const r = render_(tpl, lead, touch.text, trackLinks_(lead, step, s));
  const subject = /^re:/i.test(lead.subject) ? lead.subject : 'Re: ' + lead.subject;
  send_(lead, r, subject, lead.thread_id, lead.rfc_msg_id);
  const now = new Date();
  const tz = lead.tz || s.DEFAULT_TZ;
  const done = step >= s.MAX_FOLLOWUPS;
  const next = done ? '' : slot_(now, s.FOLLOWUP_GAP_DAYS, tz, s);
  Object.assign(lead, {
    status: done ? 'finished' : 'active', step, last_sent_at: now, next_send_at: next,
    next_send_local: next ? fmtLocal_(next, tz) : '', last_template: tpl.template_id,
    last_touch: touch.touch_id, errors: 0, last_error: '',
  });
  update_('Leads', lead._row, lead);
  logEvent_(lead, 'sent', { template_id: tpl.template_id, touch_id: touch.touch_id, detail: branch });
}

// ---------- reply / bounce / seen detection ----------

function header_(msg, name) {
  const h = ((msg.payload && msg.payload.headers) || []).find(x => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function isAuto_(msg) {
  const auto = header_(msg, 'Auto-Submitted');
  if (auto && auto.toLowerCase() !== 'no') return true;
  if (header_(msg, 'X-Autoreply') || header_(msg, 'X-Autorespond')) return true;
  if (/^(auto_reply|auto-reply)$/i.test(header_(msg, 'Precedence'))) return true;
  return /(automatic reply|auto[- ]?reply|out of (the )?office|autoresponder|away from (the )?office|vacation)/i
    .test(header_(msg, 'Subject'));
}

const META = ['From', 'Subject', 'Auto-Submitted', 'X-Autoreply', 'X-Autorespond', 'Precedence'];

// Returns {kind: 'replied'|'bounced', snippet} or null.
function checkReply_(lead) {
  const since = Math.floor(new Date(lead.first_sent_at).getTime() / 1000);
  const inspect = msg => {
    if ((msg.labelIds || []).indexOf('SENT') >= 0) return null;
    const from = header_(msg, 'From').toLowerCase();
    if (/mailer-daemon|postmaster/.test(from)) return { kind: 'bounced', snippet: msg.snippet };
    if (isAuto_(msg)) return null;
    return { kind: 'replied', snippet: msg.snippet };
  };
  if (lead.thread_id) {
    const t = Gmail.Users.Threads.get('me', lead.thread_id, { format: 'metadata', metadataHeaders: META });
    for (const msg of t.messages || []) {
      const hit = inspect(msg);
      if (hit) return hit;
    }
  }
  // Replies that started a new thread, and bounces Gmail didn't thread.
  const queries = ['from:' + lead.email + ' after:' + since,
    'from:(mailer-daemon OR postmaster) after:' + since + ' "' + lead.email + '"'];
  for (const q of queries) {
    const list = Gmail.Users.Messages.list('me', { q, maxResults: 5 });
    for (const m of list.messages || []) {
      const hit = inspect(Gmail.Users.Messages.get('me', m.id, { format: 'metadata', metadataHeaders: META }));
      if (hit) return hit;
    }
  }
  return null;
}

function videoId_(url) {
  const m = String(url || '').match(/(?:shorts\/|v=|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : '';
}

function viewCounts_(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const res = YouTube.Videos.list('statistics', { id: ids.slice(i, i + 50).join(',') });
    (res.items || []).forEach(v => { out[v.id] = Number(v.statistics.viewCount || 0); });
  }
  return out;
}

// ---------- main loop ----------

function tick() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try { tickInner_(false); } finally { lock.releaseLock(); }
}

// Runs every 10 min. Reply/view checks for everyone happen hourly; a lead about to get a
// follow-up is always re-checked for a reply right before sending.
function tickInner_(forceCheck) {
  const started = Date.now();
  const s = settings_();
  const props = PropertiesService.getScriptProperties();
  const fullCheck = forceCheck || Date.now() - Number(props.getProperty('LAST_CHECK') || 0) > 55 * 60 * 1000;
  const leads = table_('Leads').rows.filter(l => ACTIVE_STATES.indexOf(l.status) >= 0 || l.status === 'test_pending');
  const now = new Date();

  let views = {};
  if (fullCheck) {
    const ids = leads.filter(l => l.status !== 'scheduled' && l.video_id && !isTrue_(l.seen)).map(l => l.video_id);
    try { views = ids.length ? viewCounts_(ids) : {}; } catch (e) { Logger.log('views: ' + e); }
  }

  let budget = s.DAILY_SEND_CAP - sentLast24h_();
  let runBudget = s.MAX_SENDS_PER_RUN;
  const eng = engagement_(table_('Events').rows);
  for (const lead of leads) {
    if (Date.now() - started > 4.5 * 60 * 1000) break;
    try {
      const due = lead.next_send_at && new Date(lead.next_send_at) <= now;
      const e = eng.byLead[lead.lead_id];
      if (e && (e.opens !== Number(lead.opens || 0) || e.clicks !== Number(lead.clicks || 0))) {
        const patch = { opens: e.opens, clicks: e.clicks, opened_at: e.opened_at || '', clicked_at: e.clicked_at || '' };
        if (e.clicks && !isTrue_(lead.seen)) {
          patch.seen = true;
          logEvent_(lead, 'seen', { detail: 'clicked the video link' });
        }
        Object.assign(lead, patch);
        update_('Leads', lead._row, patch);
      }
      if (lead.status === 'active' || lead.status === 'finished') {
        if (lead.status === 'finished' && now - new Date(lead.last_sent_at) > 21 * 864e5) {
          update_('Leads', lead._row, { status: 'done' });
          continue;
        }
        if (!fullCheck && !(lead.status === 'active' && due)) continue;
        const hit = checkReply_(lead);
        if (hit) {
          update_('Leads', lead._row, {
            status: hit.kind, replied_at: now, reply_snippet: hit.snippet, next_send_at: '', next_send_local: '',
          });
          logEvent_(lead, hit.kind, { template_id: lead.last_template, touch_id: lead.last_touch, detail: hit.snippet });
          if (hit.kind === 'replied') {
            notify_(s, '📩 Reply from ' + (lead.first_name || '') + ' (' + lead.company + ', ' + lead.email + '):\n\n"' +
              hit.snippet + '"\n\n' + (Number(lead.step) ? 'After follow-up #' + lead.step : 'After the first email') +
              (isTrue_(lead.seen) ? ', watched the video' : '') + '. Follow-ups stopped.\n' +
              'https://mail.google.com/mail/u/0/#all/' + lead.thread_id);
          }
          continue;
        }
        if (lead.video_id in views) {
          const v = views[lead.video_id];
          const seen = isTrue_(lead.seen) || v > Number(lead.views_baseline || 0);
          const newlySeen = seen && !isTrue_(lead.seen);
          update_('Leads', lead._row, { views: v, seen });
          if (newlySeen) {
            lead.seen = true;
            logEvent_(lead, 'seen', { detail: v + ' views' });
          }
        }
      }
      if (s.PAUSED || budget <= 0 || runBudget <= 0) continue;
      const sendInitial = lead.status === 'test_pending' || (lead.status === 'scheduled' && due);
      const sendFollowup = lead.status === 'active' && due;
      if (!sendInitial && !sendFollowup) continue;
      if (runBudget < s.MAX_SENDS_PER_RUN) Utilities.sleep(30000 + Math.floor(Math.random() * 60000));
      if (sendInitial) sendInitial_(lead, s);
      else sendFollowup_(lead, s);
      budget--;
      runBudget--;
    } catch (e) {
      const errors = Number(lead.errors || 0) + 1;
      update_('Leads', lead._row, { errors, last_error: String(e).slice(0, 500), status: errors >= 3 ? 'error' : lead.status });
      logEvent_(lead, 'error', { detail: String(e).slice(0, 500) });
      if (errors >= 3) notify_(s, 'Outreach error for ' + lead.email + ' (stopped): ' + e);
    }
  }
  // Stats + dashboard: hourly, or sooner whenever new events (sends, opens, clicks, replies) arrived.
  const eventRows = String(ss_().getSheetByName('Events').getLastRow());
  if (fullCheck || props.getProperty('STATS_EVENT_ROWS') !== eventRows) {
    if (fullCheck) props.setProperty('LAST_CHECK', String(Date.now()));
    props.setProperty('STATS_EVENT_ROWS', eventRows);
    updateStats_();
  }
}

// Token/chat normally live in Script Properties (set via the set_telegram action) so they stay out of the sheet.
function notify_(s, text) {
  const props = PropertiesService.getScriptProperties();
  const token = s.TELEGRAM_BOT_TOKEN || props.getProperty('TELEGRAM_BOT_TOKEN');
  const chat = s.TELEGRAM_CHAT_ID || props.getProperty('TELEGRAM_CHAT_ID');
  if (!token || !chat) return { ok: false, error: 'telegram not configured' };
  try {
    const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post', payload: { chat_id: String(chat), text, disable_web_page_preview: 'true' }, muteHttpExceptions: true,
    });
    return { ok: res.getResponseCode() === 200, code: res.getResponseCode() };
  } catch (e) {
    Logger.log('telegram: ' + e);
    return { ok: false, error: String(e) };
  }
}

function setSetting_(key, value) {
  const row = table_('Settings').rows.find(r => r.key === key);
  if (row) update_('Settings', row._row, { value });
  else append_('Settings', { key, value });
  return { ok: true, key, value };
}

function setTelegram_(req) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('TELEGRAM_BOT_TOKEN', String(req.token));
  props.setProperty('TELEGRAM_CHAT_ID', String(req.chat_id));
  return notify_({}, req.test_text || 'Outreach alerts connected. You will get a message here when a prospect replies.');
}

// ---------- API actions ----------

function leadFrom_(src, s) {
  const tz = src.tz || s.DEFAULT_TZ;
  const url = src.video_url || '';
  return {
    email: String(src.email || '').trim(), first_name: src.first_name || '', company: src.company || '',
    channel_url: src.channel_url || '', topic: src.topic || '', hook: src.hook || '',
    touches: src.touches && src.touches.length ? JSON.stringify(src.touches) : '', tz,
    video_url: url, video_id: videoId_(url), notes: src.notes || '',
  };
}

function preview_(src) {
  const s = settings_();
  const lead = leadFrom_(src, s);
  const tpl = pickTemplate_('initial', 'any', src.initial_template);
  const r = render_(tpl, lead, '');
  const fake = Object.assign({ lead_id: '_preview' }, lead);
  const fu = branch => {
    const t = pickTemplate_('followup', branch, null);
    return { template_id: t.template_id, text: render_(t, lead, pickTouch_(fake, 1).text).text };
  };
  const when = initialSlot_(new Date(), lead.tz, s);
  return {
    ok: true, template_id: tpl.template_id, subject: r.subject, text: r.text,
    send_at_prospect: fmtLocal_(when, lead.tz), send_at_hkt: fmtLocal_(when, 'Asia/Hong_Kong'),
    followup_unseen: fu('unseen'), followup_seen: fu('seen'),
    duplicate: table_('Leads').rows.some(l => String(l.email).toLowerCase() === lead.email.toLowerCase()),
  };
}

function thumbFolder_() {
  const it = DriveApp.getFoldersByName('Outreach Thumbnails');
  return it.hasNext() ? it.next() : DriveApp.createFolder('Outreach Thumbnails');
}

function enqueue_(req) {
  const s = settings_();
  const lead = leadFrom_(req.lead, s);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lead.email)) return { ok: false, error: 'invalid email' };
  if (!lead.video_id) return { ok: false, error: 'video_url must be a YouTube link' };
  const existing = table_('Leads').rows.find(l => String(l.email).toLowerCase() === lead.email.toLowerCase() && l.status !== 'test');
  if (existing && !req.force && !req.test) {
    return { ok: false, error: 'already in Leads (status ' + existing.status + '); pass force to resend' };
  }
  if (req.thumb_b64) {
    const blob = Utilities.newBlob(Utilities.base64Decode(req.thumb_b64), 'image/jpeg', (lead.company || 'thumb') + '.jpg');
    lead.thumb_file_id = thumbFolder_().createFile(blob).getId();
  }
  let baseline = 0;
  try { baseline = viewCounts_([lead.video_id])[lead.video_id] || 0; } catch (e) { Logger.log(e); }
  const now = new Date();
  const when = req.send_now || req.test ? now : initialSlot_(now, lead.tz, s);
  Object.assign(lead, {
    lead_id: 'L' + Utilities.formatDate(now, 'Asia/Hong_Kong', 'yyMMddHHmmss'), added_at: now,
    status: req.test ? 'test_pending' : 'scheduled', step: 0, initial_template: req.initial_template || '',
    next_send_at: when, next_send_local: fmtLocal_(when, lead.tz), views_baseline: baseline, views: baseline,
    seen: false, errors: 0,
  });
  lead._row = append_('Leads', lead);
  if (req.send_now || req.test) sendInitial_(lead, s);
  return {
    ok: true, lead_id: lead.lead_id, status: lead.status, thread_id: lead.thread_id || '',
    send_at_prospect: fmtLocal_(when, lead.tz), send_at_hkt: fmtLocal_(when, 'Asia/Hong_Kong'),
  };
}

function stop_(req) {
  const key = String(req.email || req.lead_id || '').toLowerCase();
  const hits = table_('Leads').rows.filter(l =>
    ACTIVE_STATES.indexOf(l.status) >= 0 && (String(l.email).toLowerCase() === key || String(l.lead_id).toLowerCase() === key));
  hits.forEach(l => {
    update_('Leads', l._row, { status: 'stopped', next_send_at: '', next_send_local: '' });
    logEvent_(l, 'stopped', { detail: req.reason || '' });
  });
  return { ok: true, stopped: hits.length };
}

function statusReport_() {
  const leads = table_('Leads').rows.filter(l => l.status !== 'test');
  const by = {};
  leads.forEach(l => { by[l.status] = (by[l.status] || 0) + 1; });
  const hk = d => (d ? fmtLocal_(new Date(d), 'Asia/Hong_Kong') : '');
  return {
    ok: true, counts: by, total: leads.length,
    recent: leads.slice(-25).reverse().map(l => ({
      company: l.company, email: l.email, status: l.status, step: l.step, seen: isTrue_(l.seen),
      next_send_hkt: hk(l.next_send_at), replied: l.reply_snippet || '', error: l.last_error || '',
    })),
    stats: statsData_(),
  };
}

// ---------- stats ----------

function pct_(a, b) {
  return b ? Math.round((1000 * a) / b) / 10 + '%' : '-';
}

// Opens/clicks within 2 min of a send are ignored: those are security scanners, not people.
// Returns per-send flags (key "lead|step") and per-lead totals.
function engagement_(events) {
  const sent = {};
  events.forEach(e => { if (e.event === 'sent') sent[e.lead_id + '|' + e.step] = e; });
  const perSend = {};
  const byLead = {};
  events.forEach(e => {
    if (e.event !== 'open' && e.event !== 'click') return;
    const key = e.lead_id + '|' + e.step;
    const s = sent[key];
    if (!s || new Date(e.ts) - new Date(s.ts) < 120000) return;
    const ps = perSend[key] = perSend[key] || { open: false, click: false, open_ts: null, click_ts: null };
    const l = byLead[e.lead_id] = byLead[e.lead_id] || { opens: 0, clicks: 0, opened_at: null, clicked_at: null };
    if (e.event === 'open') {
      ps.open = true;
      if (!ps.open_ts) ps.open_ts = e.ts;
      l.opens++;
      if (!l.opened_at) l.opened_at = e.ts;
    } else {
      ps.click = true;
      ps.open = true; // a click implies the email was opened, even with images blocked
      if (!ps.click_ts) ps.click_ts = e.ts;
      if (!ps.open_ts) ps.open_ts = e.ts;
      l.clicks++;
      if (!l.clicked_at) l.clicked_at = e.ts;
    }
  });
  return { sent, perSend, byLead };
}

function statsData_() {
  const leads = table_('Leads').rows.filter(l => l.status !== 'test' && l.first_sent_at);
  const events = table_('Events').rows;
  const eng = engagement_(events);
  const tpls = {};
  table_('Templates').rows.forEach(t => { tpls[t.template_id] = t; });

  const initial = {};
  leads.forEach(l => {
    const k = l.initial_template;
    const r = initial[k] = initial[k] || { leads: 0, opened: 0, clicked: 0, seen: 0, replied: 0, bounced: 0 };
    const first = eng.perSend[l.lead_id + '|0'] || {};
    r.leads++;
    if (first.open) r.opened++;
    if (first.click) r.clicked++;
    if (isTrue_(l.seen)) r.seen++;
    if (l.status === 'replied') r.replied++;
    if (l.status === 'bounced') r.bounced++;
  });

  // Follow-ups and touch lines, per send. A reply is credited to the last email before it.
  const agg = field => {
    const out = {};
    Object.keys(eng.sent).forEach(key => {
      const s = eng.sent[key];
      if (!(Number(s.step) > 0) || !s[field]) return;
      const r = out[s[field]] = out[s[field]] || { sends: 0, opened: 0, clicked: 0, replies: 0 };
      const ps = eng.perSend[key] || {};
      r.sends++;
      if (ps.open) r.opened++;
      if (ps.click) r.clicked++;
    });
    events.forEach(e => {
      if (e.event === 'replied' && Number(e.step) > 0 && e[field] && out[e[field]]) out[e[field]].replies++;
    });
    return out;
  };

  const steps = {};
  events.filter(e => e.event === 'replied').forEach(e => { steps[e.step] = (steps[e.step] || 0) + 1; });

  const total = leads.length;
  const count = st => leads.filter(l => l.status === st).length;
  const rates = r => ({
    open_rate: pct_(r.opened, r.sends || r.leads), click_rate: pct_(r.clicked, r.sends || r.leads),
  });
  return {
    totals: {
      leads_emailed: total,
      opened: pct_(leads.filter(l => Number(l.opens) > 0 || Number(l.clicks) > 0).length, total),
      clicked: pct_(leads.filter(l => Number(l.clicks) > 0).length, total),
      seen: pct_(leads.filter(l => isTrue_(l.seen)).length, total),
      replied: pct_(count('replied'), total), bounced: pct_(count('bounced'), total),
    },
    initial: Object.keys(initial).map(k => Object.assign({
      template_id: k, subject: tpls[k] ? tpls[k].subject : '',
      seen_rate: pct_(initial[k].seen, initial[k].leads), reply_rate: pct_(initial[k].replied, initial[k].leads),
    }, rates(initial[k]), initial[k])),
    followups: Object.entries(agg('template_id')).map(([k, v]) => Object.assign({
      template_id: k, branch: tpls[k] ? tpls[k].branch : '', reply_per_send: pct_(v.replies, v.sends),
    }, rates(v), v)),
    touches: Object.entries(agg('touch_id')).map(([k, v]) => Object.assign({
      touch_id: k, reply_per_send: pct_(v.replies, v.sends),
    }, rates(v), v)),
    replies_by_step: steps,
  };
}

function updateStats_() {
  const d = statsData_();
  const sh = ss_().getSheetByName('Stats');
  sh.clear();
  const t = d.totals;
  const blocks = [
    ['Updated', new Date()],
    ['Opens are inflated by Apple Mail privacy; judge versions on clicks, watched and replies.'], [],
    ['TOTALS'], ['Leads emailed', 'Opened', 'Clicked', 'Watched video', 'Replied', 'Bounced'],
    [t.leads_emailed, t.opened, t.clicked, t.seen, t.replied, t.bounced], [],
    ['FIRST EMAIL (A/B: subject + body)'],
    ['Template', 'Subject', 'Leads', 'Open %', 'Click %', 'Watched %', 'Reply %', 'Replied', 'Bounced'],
  ];
  d.initial.forEach(r => blocks.push([r.template_id, r.subject, r.leads, r.open_rate, r.click_rate, r.seen_rate,
    r.reply_rate, r.replied, r.bounced]));
  blocks.push([], ['FOLLOW-UP TEMPLATES (per send; reply credited to the last email before it)'],
    ['Template', 'Branch', 'Sends', 'Open %', 'Click %', 'Replies', 'Reply / send']);
  d.followups.forEach(r => blocks.push([r.template_id, r.branch, r.sends, r.open_rate, r.click_rate, r.replies, r.reply_per_send]));
  blocks.push([], ['TOUCH POINTS (C# = written for that lead)'], ['Touch', 'Sends', 'Open %', 'Click %', 'Replies', 'Reply / send']);
  d.touches.forEach(r => blocks.push([r.touch_id, r.sends, r.open_rate, r.click_rate, r.replies, r.reply_per_send]));
  blocks.push([], ['REPLIES BY STEP (0 = first email)'], ['Step', 'Replies']);
  Object.keys(d.replies_by_step).sort((a, b) => a - b).forEach(k => blocks.push([k, d.replies_by_step[k]]));
  const width = Math.max.apply(null, blocks.map(r => r.length || 1));
  const grid = blocks.map(r => r.concat(Array(width - r.length).fill('')));
  sh.getRange(1, 1, grid.length, width).setValues(grid);
  try { updateDashboard_(d); } catch (e) { Logger.log('dashboard: ' + e); }
}

// ---------- dashboard (native Sheets charts over the ChartData tab) ----------

const INK = { primary: '#0b0b0b', secondary: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', surface: '#fcfcfb' };
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100']; // fixed categorical order, never cycled

function frac_(a, b) {
  return b ? a / b : 0;
}

function dashData_(d) {
  const leads = table_('Leads').rows.filter(l => l.status !== 'test' && l.first_sent_at);
  const events = table_('Events').rows;
  const eng = engagement_(events);
  const tz = 'Asia/Hong_Kong';
  const day = ts => Utilities.formatDate(new Date(ts), tz, 'yyyy-MM-dd');

  const n = leads.length;
  const opened = leads.filter(l => Number(l.opens) > 0 || Number(l.clicks) > 0).length;
  const clicked = leads.filter(l => Number(l.clicks) > 0).length;
  const watched = leads.filter(l => isTrue_(l.seen)).length;
  const replied = leads.filter(l => l.status === 'replied').length;
  const bounced = leads.filter(l => l.status === 'bounced').length;

  // Daily activity (HKT days): emails sent, first opens, first clicks, replies.
  const daily = {};
  const bump = (ts, k) => {
    if (!ts) return;
    const k2 = day(ts);
    daily[k2] = daily[k2] || { sent: 0, opened: 0, clicked: 0, replied: 0 };
    daily[k2][k]++;
  };
  Object.keys(eng.sent).forEach(key => bump(eng.sent[key].ts, 'sent'));
  Object.keys(eng.perSend).forEach(key => {
    if (!eng.sent[key]) return;
    bump(eng.perSend[key].open_ts, 'opened');
    bump(eng.perSend[key].click_ts, 'clicked');
  });
  events.filter(e => e.event === 'replied').forEach(e => bump(e.ts, 'replied'));
  const first = Object.keys(daily).sort()[0] || day(new Date());
  const days = [];
  for (let t = new Date(first + 'T12:00:00+08:00'); day(t) <= day(new Date()); t = new Date(t.getTime() + 864e5)) {
    const k = day(t);
    const v = daily[k] || { sent: 0, opened: 0, clicked: 0, replied: 0 };
    days.push([Utilities.formatDate(t, tz, 'd MMM'), v.sent, v.opened, v.clicked, v.replied]);
  }

  const initial = d.initial.map(r => [r.template_id + ' (n=' + r.leads + ')',
    frac_(r.opened, r.leads), frac_(r.clicked, r.leads), frac_(r.replied, r.leads)]);
  const followups = d.followups.map(r => [r.template_id + ' ' + r.branch + ' (n=' + r.sends + ')',
    frac_(r.clicked, r.sends), frac_(r.replies, r.sends)]);
  const steps = [];
  const maxStep = Math.max(10, ...Object.keys(d.replies_by_step).map(Number));
  for (let i = 0; i <= maxStep; i++) steps.push([i === 0 ? 'First' : 'FU ' + i, d.replies_by_step[i] || 0]);

  return {
    tiles: [['Emailed', n, ''], ['Opened', frac_(opened, n), '%'], ['Clicked', frac_(clicked, n), '%'],
      ['Watched', frac_(watched, n), '%'], ['Replied', frac_(replied, n), '%'], ['Bounced', frac_(bounced, n), '%']],
    counts: { n, replied },
    funnel: [['Emailed', n], ['Opened', opened], ['Clicked', clicked], ['Watched', watched], ['Replied', replied]],
    days, initial, followups, steps,
  };
}

function writeBlock_(sh, col, header, rows, pctCols) {
  const values = [header].concat(rows.length ? rows : [header.map((h, i) => (i ? 0 : '-'))]);
  sh.getRange(1, col, values.length, header.length).setValues(values);
  sh.getRange(1, col, 1, header.length).setFontWeight('bold');
  (pctCols || []).forEach(c => sh.getRange(2, col + c, values.length - 1, 1).setNumberFormat('0%'));
  return sh.getRange(1, col, values.length, header.length);
}

function updateDashboard_(d) {
  const ss = ss_();
  const data = dashData_(d);
  let cd = ss.getSheetByName('ChartData') || ss.insertSheet('ChartData');
  cd.clear();
  const R = {
    funnel: writeBlock_(cd, 1, ['Stage', 'Leads'], data.funnel),
    days: writeBlock_(cd, 4, ['Day (HKT)', 'Sent', 'Opened', 'Clicked', 'Replied'], data.days),
    initial: writeBlock_(cd, 10, ['First email', 'Open %', 'Click %', 'Reply %'], data.initial, [1, 2, 3]),
    followups: writeBlock_(cd, 15, ['Follow-up', 'Click / send', 'Reply / send'], data.followups, [1, 2]),
    steps: writeBlock_(cd, 19, ['Email', 'Replies'], data.steps),
  };

  let dash = ss.getSheetByName('Dashboard');
  if (!dash) {
    dash = ss.insertSheet('Dashboard', 0);
    dash.setHiddenGridlines(true);
  }
  // Stat tiles: label row over a big value row.
  dash.getRange('A1').setValue('Outreach dashboard').setFontSize(16).setFontWeight('bold').setFontColor(INK.primary);
  dash.getRange('A2').setValue('Updated ' + Utilities.formatDate(new Date(), 'Asia/Hong_Kong', 'd MMM HH:mm') +
    ' HKT · refreshes every 10 min · opens are inflated by Apple Mail, judge on clicks, watched and replies')
    .setFontColor(INK.muted).setFontSize(9);
  data.tiles.forEach((t, i) => {
    dash.getRange(4, 1 + i * 2).setValue(t[0]).setFontColor(INK.secondary).setFontSize(10);
    dash.getRange(5, 1 + i * 2).setValue(t[1]).setFontSize(22).setFontWeight('bold').setFontColor(INK.primary)
      .setNumberFormat(t[2] ? '0%' : '0').setHorizontalAlignment('left');
  });

  // Rebuild charts only when the data shape changes; otherwise they redraw from ChartData on their own.
  const shape = 'v2|' + Object.keys(R).map(k => k + R[k].getA1Notation()).join('|');
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('DASH_SHAPE') === shape && dash.getCharts().length) return;
  dash.getCharts().forEach(c => dash.removeChart(c));

  const base = (title, w, h) => ({
    title, width: w, height: h, backgroundColor: INK.surface, fontName: 'Arial',
    'titleTextStyle.color': INK.primary, 'titleTextStyle.fontSize': 13,
    'legend.textStyle.color': INK.secondary,
    'hAxis.textStyle.color': INK.muted, 'vAxis.textStyle.color': INK.muted,
    'hAxis.gridlines.color': INK.grid, 'vAxis.gridlines.color': INK.grid,
    'hAxis.baselineColor': INK.axis, 'vAxis.baselineColor': INK.axis,
  });
  const add = (type, range, row, col, opts) => {
    let b = dash.newChart().setChartType(type).addRange(range).setNumHeaders(1).setPosition(row, col, 0, 0);
    Object.keys(opts).forEach(k => { b = b.setOption(k, opts[k]); });
    dash.insertChart(b.build());
  };
  const C = Charts.ChartType;
  add(C.BAR, R.funnel, 7, 1, Object.assign(base('Funnel: leads reaching each stage', 560, 300), {
    colors: [SERIES[0]], 'legend.position': 'none', 'hAxis.minValue': 0, 'hAxis.format': '0', 'series.0.dataLabel': 'value',
  }));
  add(C.LINE, R.days, 7, 7, Object.assign(base('Daily activity (HKT)', 620, 300), {
    colors: SERIES, 'legend.position': 'top', lineWidth: 2, pointSize: 8, 'vAxis.minValue': 0, 'vAxis.format': '0',
  }));
  add(C.COLUMN, R.initial, 23, 1, Object.assign(base('First email A/B: rates per version (n = leads)', 560, 300), {
    colors: SERIES.slice(0, 3), 'legend.position': 'top', 'vAxis.format': '0%', 'vAxis.minValue': 0,
  }));
  add(C.COLUMN, R.followups, 23, 7, Object.assign(base('Follow-up versions: per send (n = sends)', 620, 300), {
    colors: SERIES.slice(0, 2), 'legend.position': 'top', 'vAxis.format': '0%', 'vAxis.minValue': 0,
  }));
  add(C.COLUMN, R.steps, 39, 1, Object.assign(base('Replies by email in the sequence', 560, 280), {
    colors: [SERIES[0]], 'legend.position': 'none', 'vAxis.minValue': 0, 'vAxis.format': '0',
  }));
  props.setProperty('DASH_SHAPE', shape);
}
