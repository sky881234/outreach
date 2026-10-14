// Offline checks for the pure parts of Code.js (rendering, MIME, scheduling) with Apps Script stubs.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const pad = n => String(n).padStart(2, '0');
global.Utilities = {
  formatDate(date, tz, pattern) {
    const parts = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      second: '2-digit', hourCycle: 'h23', weekday: 'short',
    }).formatToParts(date).forEach(p => { parts[p.type] = p.value; });
    return pattern
      .replace('yyyy', parts.year).replace('MMM', 'M' + parts.month).replace('MM', parts.month)
      .replace('dd', parts.day).replace('HH', parts.hour).replace('mm', parts.minute).replace('ss', parts.second)
      .replace('EEE', parts.weekday).replace(/\bd\b/, String(Number(parts.day))).replace(/'/g, '');
  },
  getUuid: () => crypto.randomUUID(),
  newBlob: s => ({ getBytes: () => Buffer.from(s, 'utf8') }),
  base64Encode: b => Buffer.from(b).toString('base64'),
};
const src = fs.readFileSync(path.join(__dirname, '..', 'apps_script', 'Code.js'), 'utf8');
eval(src + '\nglobal.T = { render_, mime_, slot_, initialSlot_, atLocal_, videoId_, isAuto_ };');

const s = { SEND_HOUR_LOCAL: 9, SEND_WINDOW_HOURS: 3, SKIP_WEEKENDS: false };
const lead = {
  first_name: 'Nikki', topic: 'Group Coaching', hook: 'You want more group coaching clients struggling with gut health.',
  video_url: 'https://youtube.com/shorts/abcdefghijk', company: 'GMQ',
};
const tpl = { subject: 'Question About {topic}', body: 'Hey {first_name},\n\n{hook}\n\nWatch:\n{thumbnail}\n\nReply if interested.\n\n{unknown}' };
const r = T.render_(tpl, lead, '');
console.log('SUBJECT:', r.subject);
console.log('TEXT:\n' + r.text);
console.log('HTML:', r.html);
const m = T.mime_('a@b.com', r.subject, r.text, r.html, { getBytes: () => Buffer.from('jpegbytes') }, '<x@y>');
console.log('MIME head:\n' + m.split('\r\n').slice(0, 8).join('\n'));
console.log('MIME lines >998:', m.split('\r\n').filter(l => l.length > 998).length);

const ny = 'America/New_York';
const show = d => d === null ? null : d.toISOString() + '  NY=' + Utilities.formatDate(d, ny, 'yyyy-MM-dd HH:mm') + '  HK=' + Utilities.formatDate(d, 'Asia/Hong_Kong', 'yyyy-MM-dd HH:mm');
console.log('atLocal 2026-10-12 09:00 NY ->', show(T.atLocal_(2026, 10, 12, 9, 0, ny)));
console.log('atLocal 2026-11-02 09:00 NY (after DST) ->', show(T.atLocal_(2026, 11, 2, 9, 0, ny)));
const hkAfternoon = new Date('2026-10-10T07:00:00Z'); // 15:00 HKT = 03:00 NY
console.log('initial slot from 15:00 HKT ->', show(T.initialSlot_(hkAfternoon, ny, s)));
const nyMorning = new Date('2026-10-10T13:30:00Z'); // 09:30 NY
console.log('initial slot at 09:30 NY ->', show(T.initialSlot_(nyMorning, ny, s)), '(now)');
console.log('follow-up +2d ->', show(T.slot_(nyMorning, 2, ny, s)));
console.log('skip weekends +1d from Fri ->', show(T.slot_(new Date('2026-10-09T14:00:00Z'), 1, ny, { SEND_HOUR_LOCAL: 9, SEND_WINDOW_HOURS: 3, SKIP_WEEKENDS: true })));
console.log('videoId:', T.videoId_('https://youtube.com/shorts/Zx9_-abcDEF?feature=share'), T.videoId_('https://youtu.be/TVaCIRSRn2o'));
const msg = (h) => ({ payload: { headers: Object.entries(h).map(([name, value]) => ({ name, value })) } });
console.log('auto OOO:', T.isAuto_(msg({ Subject: 'Automatic reply: Question About Group Coaching' })),
  'auto header:', T.isAuto_(msg({ 'Auto-Submitted': 'auto-replied' })),
  'human:', T.isAuto_(msg({ Subject: 'Re: Question About Group Coaching' })));

