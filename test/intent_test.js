// Checks the reply-wording rules in Code.js against sample replies.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'apps_script', 'Code.js'), 'utf8');
const pick = name => src.match(new RegExp('const ' + name + ' = (/.*/i);'))[1];
const HARD_STOP = eval(pick('HARD_STOP'));
const DECLINE = eval(pick('DECLINE'));
const USER_BOOKED = eval(pick('USER_BOOKED'));
const USER_CLOSE = eval(pick('USER_CLOSE'));
const intent = t => (HARD_STOP.test(t) ? 'stop' : DECLINE.test(t) ? 'decline' : 'reply');
const afterYou = (t, declined) => (USER_BOOKED.test(t) ? 'booked' : declined || USER_CLOSE.test(t) ? 'closed' : 'booking');

const prospect = [
  ['Sounds interesting, what does it cost?', 'reply'],
  ["Thanks Matthew but we're not interested.", 'decline'],
  'No thanks, we have an editor already.|decline',
  "We're good for now, appreciate it|decline",
  'Please remove me from your list|stop',
  'Unsubscribe|stop',
  'Sure, I could do a call Thursday|reply',
  'Not right now, maybe next quarter|decline',
];
const mine = [
  ['Great! Does Thursday 3pm EST work for a quick call?', false, 'booking'],
  ['Totally understand, feel free to reach out whenever the time is right.', true, 'closed'],
  ['No worries at all!', true, 'closed'],
  ['Perfect, see you Thursday at 3pm. Sent you a calendar invite.', false, 'booked'],
  ['Here is my calendar link, pick any slot that works', false, 'booking'],
  ['All the best with the channel!', false, 'closed'],
];
let fail = 0;
for (const row of prospect) {
  const [t, want] = Array.isArray(row) ? row : row.split('|');
  const got = intent(t);
  if (got !== want) fail++;
  console.log((got === want ? 'ok  ' : 'FAIL') + ' prospect "' + t + '" -> ' + got);
}
for (const [t, declined, want] of mine) {
  const got = afterYou(t, declined);
  if (got !== want) fail++;
  console.log((got === want ? 'ok  ' : 'FAIL') + ' you      "' + t + '"' + (declined ? ' (they declined)' : '') + ' -> ' + got);
}
console.log(fail ? fail + ' FAILED' : 'ALL PASS');
