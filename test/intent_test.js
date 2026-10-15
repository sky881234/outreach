// Checks the reply-wording rules in Code.js against sample prospect replies.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'apps_script', 'Code.js'), 'utf8');
const pick = name => src.match(new RegExp('const ' + name + ' = (/.*/i);'))[1];
const HARD_STOP = eval(pick('HARD_STOP'));
const DECLINE = eval(pick('DECLINE'));
const intent = t => (HARD_STOP.test(t) ? 'stop' : DECLINE.test(t) ? 'decline' : 'reply');

const cases = [
  ['Sounds interesting, what does it cost?', 'reply'],
  ["Thanks Matthew but we're not interested.", 'decline'],
  ['No thanks, we have an editor already.', 'decline'],
  ["We're good for now, appreciate it", 'decline'],
  ['Please remove me from your list', 'stop'],
  ['Unsubscribe', 'stop'],
  ["Please don't email me again", 'stop'],
  ['Sure, I could do a call Thursday', 'reply'],
  ['Not right now, maybe next quarter', 'decline'],
];
let fail = 0;
for (const [t, want] of cases) {
  const got = intent(t);
  if (got !== want) fail++;
  console.log((got === want ? 'ok  ' : 'FAIL') + ' "' + t + '" -> ' + got);
}
console.log(fail ? fail + ' FAILED' : 'ALL PASS');
