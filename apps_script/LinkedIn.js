// LinkedIn channel. You press Send in LinkedIn yourself (automating it risks the account);
// this tab tracks each prospect, times the follow-ups and pings Telegram with the exact text to paste.
// Accepts and replies are read from LinkedIn's notification emails, forwarded into this Gmail.

const LI_HEADERS = ['li_id', 'added_at', 'status', 'first_name', 'last_name', 'company', 'profile_url', 'topic',
  'video_url', 'video_id', 'views_baseline', 'views', 'seen', 'note', 'msg1', 'step', 'pending_text',
  'requested_at', 'accepted_at', 'last_sent_at', 'next_ping_at', 'last_ping_at', 'withdraw_pinged',
  'replied_at', 'reply_snippet', 'last_template', 'notes'];

const LI_SETTINGS = [
  ['LI_FOLLOWUP_GAP_DAYS', 2, 'LinkedIn: days after your last message before the next follow-up ping'],
  ['LI_MAX_FOLLOWUPS', 4, 'LinkedIn: follow-ups after the first message'],
  ['LI_CALL_FROM_STEP', 3, 'LinkedIn: from this follow-up on, use the call-ask template (branch "call")'],
  ['LI_REMIND_HOURS', 20, 'LinkedIn: re-ping an action you haven\'t done yet (connect / send) after this many hours'],
  ['LI_WITHDRAW_DAYS', 21, 'LinkedIn: ping to withdraw a request that hasn\'t been accepted after this many days'],
];

const LI_TEMPLATES = [
  ['LU1', 'li_followup', 'unseen', '',
    'Hey {first_name}, did you get a chance to watch the Short I made from your video?\n\n{video_url}',
    true, 'LinkedIn follow-up, video not watched yet'],
  ['LS1', 'li_followup', 'seen', '',
    'Hey {first_name}, noticed you watched the Short!\n\nIt doesn\'t need any extra work from you. Want me to send over the file so you can post it?',
    true, 'LinkedIn follow-up, video watched'],
  ['LC1', 'li_followup', 'call', '',
    'Hey {first_name}, understand you must be busy.\n\nThe quick 20 min call is just to understand your situation and see if we\'re a good fit.\n\nYou can book a time here: {booking_link}',
    true, 'LinkedIn follow-up from LI_CALL_FROM_STEP on'],
];

const LI_ACTIVE = ['to_connect', 'requested', 'accepted', 'messaged', 'followup_due'];

function liUpgrade_() {
  const ss = ss_();
  let sh = ss.getSheetByName('LinkedIn');
  if (!sh) sh = ss.insertSheet('LinkedIn');
  const have = sh.getLastRow() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  const missing = LI_HEADERS.filter(h => have.indexOf(h) < 0);
  if (missing.length) {
    sh.getRange(1, have.filter(String).length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  const keys = {};
  table_('Settings').rows.forEach(r => { keys[r.key] = true; });
  LI_SETTINGS.filter(r => !keys[r[0]]).forEach(r => append_('Settings', { key: r[0], value: r[1], notes: r[2] }));
  const ids = {};
  table_('Templates').rows.forEach(r => { ids[r.template_id] = true; });
  LI_TEMPLATES.filter(r => !ids[r[0]]).forEach(r => append_('Templates', {
    template_id: r[0], kind: r[1], branch: r[2], subject: r[3], body: r[4], active: r[5], notes: r[6],
  }));
}

function liSettings_(s) {
  LI_SETTINGS.forEach(r => { if (s[r[0]] === undefined || s[r[0]] === '') s[r[0]] = r[1]; });
  LI_SETTINGS.forEach(r => { s[r[0]] = Number(s[r[0]]); });
  return s;
}

function liFill_(text, li, s) {
  const vars = { first_name: li.first_name, company: li.company, topic: li.topic, video_url: li.video_url,
    booking_link: s.BOOKING_LINK || '' };
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k] || '') : m));
}

function escHtml_(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function liName_(li) {
  return (li.first_name + ' ' + (li.last_name || '')).trim() + (li.company ? ' (' + li.company + ')' : '');
}

const LI_BUTTONS = {
  connect: [['✅ Requested', 'li_requested'], ['🗑 Drop', 'li_drop']],
  send: [['✅ Sent', 'li_sent'], ['💬 They replied', 'li_replied'], ['🗑 Drop', 'li_drop']],
  withdraw: [['✅ They accepted', 'li_accepted'], ['🗑 Drop', 'li_drop']],
  replied: [['📅 Call booked', 'li_booked'], ['🗑 Drop', 'li_drop']],
};

// Telegram ping: headline, the exact text to paste (tap the box to copy), and their profile link.
function liPing_(s, li, headline, copyText, buttons) {
  const html = escHtml_(headline) + (copyText ? '\n\n<pre>' + escHtml_(copyText) + '</pre>' : '') +
    '\n\n' + escHtml_(li.profile_url);
  const markup = { inline_keyboard: [buttons.map(b => ({ text: b[0], callback_data: 'oc|' + b[1] + '|' + li.li_id }))] };
  notify_(s, html, markup, 'HTML');
  update_('LinkedIn', li._row, { last_ping_at: new Date() });
}

function liEvent_(li, event, extra) {
  append_('Events', Object.assign({ ts: new Date(), lead_id: li.li_id, email: li.profile_url, event: event,
    step: li.step }, extra || {}));
}

// ---------- actions ----------

function liEnqueue_(req) {
  const s = liSettings_(settings_());
  const src = req.li || {};
  if (!/linkedin\.com\/in\//i.test(src.profile_url || '')) return { ok: false, error: 'profile_url must be a linkedin.com/in/ link' };
  if (!src.note || !src.msg1) return { ok: false, error: 'note and msg1 are required' };
  if (String(src.note).length > 300) return { ok: false, error: 'note is ' + String(src.note).length + ' chars; LinkedIn allows 300' };
  const url = String(src.profile_url).split('?')[0].replace(/\/+$/, '');
  const dup = table_('LinkedIn').rows.find(r => String(r.profile_url).replace(/\/+$/, '').toLowerCase() === url.toLowerCase());
  if (dup && !req.force) return { ok: false, error: 'already in LinkedIn tab (status ' + dup.status + ')' };
  const vid = videoId_(src.video_url);
  let baseline = 0;
  try { baseline = vid ? viewCounts_([vid])[vid] || 0 : 0; } catch (e) { Logger.log(e); }
  const now = new Date();
  const li = {
    li_id: 'LI' + Utilities.formatDate(now, 'Asia/Hong_Kong', 'yyMMddHHmmss'), added_at: now, status: 'to_connect',
    first_name: src.first_name || '', last_name: src.last_name || '', company: src.company || '', profile_url: url,
    topic: src.topic || '', video_url: src.video_url || '', video_id: vid, views_baseline: baseline, views: baseline,
    seen: false, note: src.note, msg1: src.msg1, step: 0, notes: src.notes || '',
  };
  li._row = append_('LinkedIn', li);
  liEvent_(li, 'li_added', {});
  liPing_(s, li, '🤝 Connect with ' + liName_(li) + '. Open their profile, tap Connect, add this note:', li.note, LI_BUTTONS.connect);
  return { ok: true, li_id: li.li_id, status: li.status };
}

function liFollowupText_(li, s, step) {
  const branch = step >= s.LI_CALL_FROM_STEP ? 'call' : (isTrue_(li.seen) ? 'seen' : 'unseen');
  const tpl = pickTemplate_('li_followup', branch, null);
  return { text: liFill_(tpl.body, li, s), template_id: tpl.template_id };
}

function liAccepted_(li, s, how) {
  update_('LinkedIn', li._row, { status: 'accepted', accepted_at: new Date(), pending_text: li.msg1 });
  li.status = 'accepted';
  liEvent_(li, 'li_accepted', { detail: how });
  liPing_(s, li, '🎉 ' + liName_(li) + ' accepted' + (how === 'manual' ? '' : ' your connection request') +
    '! Send them this message:', li.msg1, LI_BUTTONS.send);
}

function liReplied_(li, s, snippet, detected) {
  update_('LinkedIn', li._row, { status: 'replied', replied_at: new Date(), reply_snippet: snippet || '', pending_text: '' });
  liEvent_(li, 'replied', { template_id: li.last_template, detail: snippet || 'marked via button' });
  if (detected) {
    liPing_(s, li, '💬 ' + liName_(li) + ' replied on LinkedIn' + (snippet ? ':\n"' + snippet + '"' : '.') +
      '\nFollow-ups stopped. Over to you.', '', LI_BUTTONS.replied);
  }
}

// Button taps (via the Telegram bridge).
function liAction_(req) {
  const s = liSettings_(settings_());
  const li = table_('LinkedIn').rows.find(r => r.li_id === req.lead_id);
  if (!li) return { ok: false, error: 'LinkedIn lead not found' };
  const who = li.first_name || li.company;
  const now = new Date();
  switch (req.op) {
    case 'li_requested':
      if (li.status !== 'to_connect') return { ok: true, message: who + ' is already ' + li.status + '.' };
      update_('LinkedIn', li._row, { status: 'requested', requested_at: now });
      liEvent_(li, 'li_requested', {});
      return { ok: true, message: 'Noted. I\'ll ping you with the first message when ' + who + ' accepts.' };
    case 'li_accepted':
      if (['to_connect', 'requested'].indexOf(li.status) < 0) return { ok: true, message: who + ' is already ' + li.status + '.' };
      liAccepted_(li, s, 'manual');
      return { ok: true, message: 'Marked accepted. First message sent to you above.' };
    case 'li_sent': {
      if (['accepted', 'followup_due'].indexOf(li.status) < 0) return { ok: true, message: who + ' is ' + li.status + ', nothing to send.' };
      const step = li.status === 'accepted' ? 0 : Number(li.step || 0) + 1;
      const done = step >= s.LI_MAX_FOLLOWUPS;
      const next = new Date(now.getTime() + s.LI_FOLLOWUP_GAP_DAYS * 864e5);
      update_('LinkedIn', li._row, {
        status: done ? 'finished' : 'messaged', step, last_sent_at: now, pending_text: '',
        next_ping_at: done ? '' : next,
      });
      li.step = step;
      liEvent_(li, 'sent', { step, template_id: step === 0 ? 'LI_MSG1' : li.last_template, detail: 'linkedin' });
      return { ok: true, message: done ? 'Sent. That was the last follow-up; I\'ll still tell you if they reply.'
        : 'Sent. Next follow-up ping in ' + s.LI_FOLLOWUP_GAP_DAYS + ' days unless they reply.' };
    }
    case 'li_replied':
      liReplied_(li, s, '', false);
      return { ok: true, message: 'Marked replied. No more follow-up pings for ' + who + '.' };
    case 'li_booked':
    case 'li_drop': {
      const status = req.op === 'li_booked' ? 'booked' : 'dropped';
      update_('LinkedIn', li._row, { status, pending_text: '', next_ping_at: '' });
      liEvent_(li, status, { detail: 'via Telegram button' });
      return { ok: true, message: status === 'booked' ? 'Marked call booked.' : 'Dropped. No more pings for ' + who + '.' };
    }
  }
  return { ok: false, error: 'unknown op ' + req.op };
}

// ---------- notifications ----------

// LinkedIn emails arrive forwarded from the LinkedIn account's inbox; From stays @linkedin.com.
function liScanNotifications_(s, active) {
  const props = PropertiesService.getScriptProperties();
  const since = Number(props.getProperty('LI_SCAN_TS') || (Date.now() - 3 * 864e5));
  const list = Gmail.Users.Messages.list('me', { q: 'from:linkedin.com after:' + Math.floor(since / 1000), maxResults: 50 });
  const msgs = (list.messages || []).map(m => Gmail.Users.Messages.get('me', m.id, { format: 'metadata', metadataHeaders: ['Subject', 'From'] }))
    .filter(m => Number(m.internalDate) > since)
    .sort((a, b) => Number(a.internalDate) - Number(b.internalDate));
  let latest = since;
  msgs.forEach(m => {
    latest = Math.max(latest, Number(m.internalDate));
    const text = header_(m, 'Subject') + ' ' + unescape_(m.snippet || '');
    const kind = /accepted your invitation|new connection|start a conversation with/i.test(text) ? 'accepted'
      : /sent you a (new )?message|new message|messaged you|replied to|sent you messages/i.test(text) ? 'message' : '';
    if (!kind) return;
    const low = text.toLowerCase();
    let li = active.find(l => String(l.last_name).trim() &&
      low.indexOf((l.first_name + ' ' + l.last_name).trim().toLowerCase()) >= 0);
    if (!li) {
      // "Wali just messaged you": first name only, accepted when exactly one active lead has it.
      const byFirst = active.filter(l => l.first_name && new RegExp('\\b' + String(l.first_name).toLowerCase() + '\\b').test(low));
      if (byFirst.length === 1) li = byFirst[0];
    }
    if (!li) return;
    if (kind === 'accepted' && ['to_connect', 'requested'].indexOf(li.status) >= 0) liAccepted_(li, s, 'notification');
    if (kind === 'message' && ['accepted', 'messaged', 'followup_due', 'requested'].indexOf(li.status) >= 0) {
      liReplied_(li, s, unescape_(m.snippet || '').slice(0, 200), true);
    }
  });
  props.setProperty('LI_SCAN_TS', String(latest));
}

// ---------- main loop (runs even while email sending is PAUSED: it only pings you) ----------

function liTick_(fullCheck) {
  const s = liSettings_(settings_());
  const sh = ss_().getSheetByName('LinkedIn');
  if (!sh || sh.getLastRow() < 2) return;
  let leads = table_('LinkedIn').rows.filter(r => LI_ACTIVE.indexOf(r.status) >= 0);
  if (!leads.length) return;
  const now = new Date();
  if (fullCheck) {
    try { liScanNotifications_(s, leads); } catch (e) { Logger.log('li scan: ' + e); }
    leads = table_('LinkedIn').rows.filter(r => LI_ACTIVE.indexOf(r.status) >= 0);
    const ids = leads.filter(l => l.video_id && !isTrue_(l.seen)).map(l => l.video_id);
    let views = {};
    try { views = ids.length ? viewCounts_(ids) : {}; } catch (e) { Logger.log('li views: ' + e); }
    leads.forEach(l => {
      if (!(l.video_id in views)) return;
      const seen = views[l.video_id] > Number(l.views_baseline || 0);
      update_('LinkedIn', l._row, { views: views[l.video_id], seen });
      if (seen) { l.seen = true; liEvent_(l, 'seen', { detail: views[l.video_id] + ' views' }); }
    });
  }
  const remind = s.LI_REMIND_HOURS * 3600e3;
  leads.forEach(li => {
    const sincePing = now - new Date(li.last_ping_at || 0);
    if (li.status === 'to_connect' && sincePing > remind) {
      liPing_(s, li, '⏰ Still to do: connect with ' + liName_(li) + '. Note to add:', li.note, LI_BUTTONS.connect);
    } else if (li.status === 'accepted' && sincePing > remind) {
      liPing_(s, li, '⏰ Still to do: send ' + liName_(li) + ' your first message:', li.msg1, LI_BUTTONS.send);
    } else if (li.status === 'followup_due' && sincePing > remind) {
      liPing_(s, li, '⏰ Still to do: follow-up #' + (Number(li.step) + 1) + ' for ' + liName_(li) + ':', li.pending_text, LI_BUTTONS.send);
    } else if (li.status === 'messaged' && li.next_ping_at && now >= new Date(li.next_ping_at)) {
      const step = Number(li.step || 0) + 1;
      const f = liFollowupText_(li, s, step);
      update_('LinkedIn', li._row, { status: 'followup_due', pending_text: f.text, last_template: f.template_id });
      li.last_template = f.template_id;
      liPing_(s, li, '⏳ ' + liName_(li) + ' hasn\'t replied in ' + s.LI_FOLLOWUP_GAP_DAYS + ' days' +
        (isTrue_(li.seen) ? ' (watched the video)' : '') + '. Follow-up #' + step + ' of ' + s.LI_MAX_FOLLOWUPS + ':',
      f.text, LI_BUTTONS.send);
    } else if (li.status === 'requested' && !isTrue_(li.withdraw_pinged) &&
      now - new Date(li.requested_at) > s.LI_WITHDRAW_DAYS * 864e5) {
      update_('LinkedIn', li._row, { withdraw_pinged: true });
      liPing_(s, li, '🕸 ' + liName_(li) + ' hasn\'t accepted in ' + s.LI_WITHDRAW_DAYS +
        ' days. Withdraw the request in LinkedIn (pending requests count against your limit).', '', LI_BUTTONS.withdraw);
    }
  });
}

function liStatus_() {
  const by = {};
  table_('LinkedIn').rows.forEach(r => { by[r.status] = (by[r.status] || 0) + 1; });
  return by;
}
