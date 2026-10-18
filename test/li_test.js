// Offline checks for LinkedIn notification parsing and follow-up text filling.
const fs = require('fs');
const path = require('path');
global.Utilities = {};
const dir = path.join(__dirname, '..', 'apps_script');
eval(fs.readFileSync(path.join(dir, 'Code.js'), 'utf8') + fs.readFileSync(path.join(dir, 'LinkedIn.js'), 'utf8') +
  ';global.F = liFill_; global.TPL = LI_TEMPLATES;');

const kindOf = text => (/accepted your invitation|new connection|start a conversation with/i.test(text) ? 'accepted'
  : /sent you a (new )?message|new message|messaged you|replied to|sent you messages/i.test(text) ? 'message' : '');
const samples = [
  ['Wali Khan accepted your invitation', 'accepted'],
  ['Matthew, start a conversation with your new connection, Wali Khan', 'accepted'],
  ['Wali Khan sent you a new message', 'message'],
  ['You have a new message from Wali Khan', 'message'],
  ['Wali just messaged you', 'message'],
  ['Wali Khan, Founder at X, is now following you', ''],
  ['5 people viewed your profile', ''],
];
let fail = 0;
for (const [t, want] of samples) {
  const got = kindOf(t);
  if (got !== want) fail++;
  console.log((got === want ? 'ok  ' : 'FAIL') + ' ' + JSON.stringify(t) + ' -> ' + (got || '(ignored)'));
}
const li = { first_name: 'Wali', company: 'Wali Khan', topic: '1-on-1 Finance Sessions', video_url: 'https://youtube.com/shorts/C3z0pHjGoNE' };
for (const t of TPL) console.log('\n[' + t[0] + ' / ' + t[2] + ']\n' + F(t[4], li, { BOOKING_LINK: 'https://calendly.com/matthew-ch-to/chat' }));
console.log('\n' + (fail ? fail + ' FAILED' : 'ALL PASS'));
