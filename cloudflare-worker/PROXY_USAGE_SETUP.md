# Proxy usage attribution

The high-traffic `proxy` Worker is a separate Quick Editor script. It is not
the `deepseek-proxy` Worker in this folder. The site and account-aware Worker
now mint and pass a short-lived signed account token; the `proxy` script must
verify it and write one Analytics Engine data point for each incoming request.

## Required Cloudflare setup

1. Generate one random secret (at least 32 random bytes) and set it as
   `PROXY_USAGE_HMAC_SECRET` on both `deepseek-proxy` and `proxy`. Do not put
   the value in this repository.
2. Add an Analytics Engine binding to the high-traffic `proxy` script:
   binding `PROXY_USAGE`, dataset `proxy_usage`.
3. Add the instrumentation described below to the `proxy` script and deploy
   it. The token arrives as `__jqrg` on the initial `?url=` request. The
   Worker validates the signature, records the account id and target host,
   then sets a short-lived `HttpOnly; Secure; SameSite=None; Partitioned`
   cookie so later asset requests from that proxied page retain attribution.
4. When the script forwards browser cookies to a destination host, remove the
   `__jqrg_attr` cookie first. It is only for the proxy Worker and must never
   reach game origins.
5. Set `PROXY_USAGE_CF_ACCOUNT_ID` and a scoped Cloudflare API token with
   Analytics Engine read access as `PROXY_USAGE_CF_API_TOKEN` on the chat
   server. The admin panel calls the Analytics Engine SQL API through that
   server-side credential.

## Instrumentation for the `proxy` script

Add these helpers above `export default`. The token format is the URL-safe
base64 JSON payload followed by a dot and an HMAC-SHA256 signature, matching
`createProxyUsageToken()` in `worker.js`.

```js
function decodeProxyUsageBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function verifyProxyUsageToken(token, env) {
  if (!token || !env.PROXY_USAGE_HMAC_SECRET) return null;
  try {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) return null;
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(env.PROXY_USAGE_HMAC_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const valid = await crypto.subtle.verify(
      'HMAC', key, decodeProxyUsageBase64Url(signature), new TextEncoder().encode(payload)
    );
    if (!valid) return null;
    const claims = JSON.parse(new TextDecoder().decode(decodeProxyUsageBase64Url(payload)));
    if (claims.aud !== 'jqrg-proxy-usage' || !claims.uid || claims.exp <= Date.now() / 1000) return null;
    return { userId: String(claims.uid), expiresAt: claims.exp };
  } catch (_) {
    return null;
  }
}

function getProxyUsageCookie(request) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/(?:^|;\s*)__jqrg_attr=([^;]+)/);
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch (_) { return ''; }
}
```

At the start of `fetch(request, env, ctx)`, after `url`, `target`, and
`wsTarget` are initialized, add:

```js
const queryUsageToken = url.searchParams.get('__jqrg') || '';
const usageToken = queryUsageToken || getProxyUsageCookie(request);
const usageIdentity = await verifyProxyUsageToken(usageToken, env);
let usageHost = 'unknown';
try {
  const destination = target || wsTarget || '';
  if (destination) usageHost = new URL(destination.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:')).hostname;
  else {
    const targetCookie = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)__Prxy_target=([^;]+)/);
    if (targetCookie) usageHost = new URL(decodeURIComponent(targetCookie[1])).hostname;
  }
} catch (_) {}
try {
  env.PROXY_USAGE?.writeDataPoint({
    indexes: [usageIdentity?.userId || 'unattributed'],
    blobs: [usageHost, request.method],
    doubles: [1],
  });
} catch (_) {}
```

After `sanitizedHeaders` is created in the response path, set the attribution
cookie on the first signed request:

```js
if (queryUsageToken && usageIdentity) {
  sanitizedHeaders.append(
    'Set-Cookie',
    `__jqrg_attr=${encodeURIComponent(queryUsageToken)}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${Math.max(0, usageIdentity.expiresAt - Math.floor(Date.now() / 1000))}`
  );
}
```

The existing HTML path sets `__Prxy_target` using `Set-Cookie`; change that
one call from `sanitizedHeaders.set(...)` to `sanitizedHeaders.append(...)` so
it does not overwrite the attribution cookie. In the request-cookie forwarding
loop, filter `__jqrg_attr` out before sending the remaining cookies upstream.

Analytics Engine samples high-volume data. The chat report uses
`sum(_sample_interval)` so the displayed account totals compensate for that
sampling; they remain estimates, not an exact billing ledger.
