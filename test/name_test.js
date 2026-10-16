// Checks first-name capture from reply sign-offs / From headers.
const fs = require('fs');
const path = require('path');
global.Utilities = {};
eval(fs.readFileSync(path.join(__dirname, '..', 'apps_script', 'Code.js'), 'utf8') + ';global.N = nameFromReply_;');

const cases = [
  ['Hi Matthew, great edit. Can I understand your service and what exactly the costs might be? Many thanks, Johannes On Mon, 12 Oct 2026 at 10:58, Matthew To <x> wrote: Hey', '', 'Johannes'],
  ['Sounds good. Best, Sarah', '', 'Sarah'],
  ['Not interested', '"Mike Jones" <mike@x.com>', 'Mike'],
  ['ok thanks', 'White Tee Watches <a@b.com>', ''],
  ['Cheers, Tom On Tue, 13 Oct 2026 Matthew wrote: Thanks, Matthew', '', 'Tom'],
  ['Thanks for this', 'info@shop.com', ''],
];
let fail = 0;
for (const [snip, from, want] of cases) {
  const got = N(snip, from, 'White Tee Watches');
  if (got !== want) fail++;
  console.log((got === want ? 'ok  ' : 'FAIL') + ' -> ' + JSON.stringify(got) + '  (' + snip.slice(0, 40) + ' | ' + from + ')');
}
console.log(fail ? fail + ' FAILED' : 'ALL PASS');
