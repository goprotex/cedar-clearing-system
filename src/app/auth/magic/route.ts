import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  // Supabase magic-link emails redirect the user back with tokens in the URL hash fragment (#...).
  // The server never receives that fragment, so this route serves a tiny HTML page that forwards
  // the user (and the fragment) to a client page that can call supabase.auth.setSession().
  const url = new URL(req.url);
  const next = url.searchParams.get('next') ?? '/bids';

  const safeNext = next.startsWith('/') ? next : '/bids';
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Signing in…</title>
  </head>
  <body style="background:#131313;color:#e5e2e1;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">
    <div style="max-width:720px;margin:40px auto;padding:16px;border:1px solid #353534;background:#0e0e0e;">
      <div style="color:#FF6B00;font-weight:800;letter-spacing:0.2em;text-transform:uppercase;">Signing in…</div>
      <div style="margin-top:8px;font-size:12px;color:#a98a7d;">Redirecting back to the app.</div>
    </div>
    <script>
      (function() {
        try {
          var next = ${JSON.stringify(safeNext)};
          var dest = '/login#auth_callback=1&next=' + encodeURIComponent(next);
          // Preserve the Supabase fragment from the magic-link URL (access_token, refresh_token, etc)
          // by appending it after our own marker.
          if (window.location.hash && window.location.hash.length > 1) {
            dest += '&' + window.location.hash.slice(1);
          }
          window.location.replace(dest);
        } catch (e) {
          window.location.replace('/login');
        }
      })();
    </script>
  </body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

