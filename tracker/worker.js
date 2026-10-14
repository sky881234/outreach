// Open pixel + click redirect for outreach emails. Logs to the Apps Script engine in the background.
//   /o/<lead>.<step>.<video>.<sig>.gif  -> 1x1 gif, logs "open"
//   /c/<lead>.<step>.<video>.<sig>      -> 302 to the YouTube Short, logs "click"
// Redirects only ever go to YouTube, so this can't be abused as an open redirect.

const GIF = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), c => c.charCodeAt(0));
const PATH = /^\/(o|c)\/(L\w+)\.(\d+)\.([\w-]{11})\.([\w-]{12})(?:\.gif)?$/;

async function sign(secret, data) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').slice(0, 12);
}

export default {
  async fetch(req, env, ctx) {
    const m = new URL(req.url).pathname.match(PATH);
    if (!m) return new Response('Not found', { status: 404 });
    const [, kind, leadId, step, videoId, sig] = m;
    const valid = sig === (await sign(env.SECRET, `${leadId}.${step}.${videoId}`));
    if (valid) {
      ctx.waitUntil(fetch(env.APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          secret: env.SECRET, action: 'track', kind: kind === 'o' ? 'open' : 'click', lead_id: leadId, step: Number(step),
          ua: (req.headers.get('user-agent') || '').slice(0, 200), country: req.cf && req.cf.country,
        }),
      }).catch(() => {}));
    }
    if (kind === 'c') return Response.redirect(`https://www.youtube.com/shorts/${videoId}`, 302);
    return new Response(GIF, {
      headers: {
        'content-type': 'image/gif',
        'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
        expires: '0',
      },
    });
  },
};
