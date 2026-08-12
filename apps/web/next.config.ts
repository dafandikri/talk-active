import type { NextConfig } from 'next';

// ============================================================================
//  Security headers for the production app.
//
//  The vanilla build shipped `script-src 'self'` with no unsafe-inline. This
//  keeps every other directive from that policy and weakens exactly one, on
//  purpose, and says so here rather than letting it disappear in a diff.
//
//  Why script-src carries 'unsafe-inline':
//
//  Next emits inline bootstrap and RSC-payload scripts. The two ways to keep a
//  strict policy are a per-request nonce or build-time hashes.
//
//    - A nonce is stamped at render time, so it cannot exist on a statically
//      prerendered page. Every route here is `○ Static`. This was implemented
//      and measured on 12 Aug: 20 violations, every chunk and every inline
//      script refused, pages rendering but completely inert. Making it work
//      means opting the whole app out of static prerendering.
//    - Hashes survive prerendering but change whenever Next's bootstrap
//      changes, so a framework upgrade fails closed with no warning.
//
//  What this costs is narrower than it looks: script-src is defence in depth
//  here, not the primary control. The app has no HTML-injection surface —
//  React escapes by default and `dangerouslySetInnerHTML` is banned by INV-5
//  and enforced in the test suite. object-src, base-uri, frame-ancestors, and
//  form-action are all still locked down, and those carry most of the weight.
//
//  Revisit when the nonce/prerender conflict is worth paying for. Tracked as
//  C-1 in docs/specs/2026-08-12-production-backlog.md.
// ============================================================================
const CONTENT_SECURITY_POLICY = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' blob: data:`,
  `media-src 'self' blob:`,
  `font-src 'self'`,
  `connect-src 'self' https://*.blob.vercel-storage.com`,
  `object-src 'none'`,
  `base-uri 'none'`,
  `form-action 'self'`,
  `frame-ancestors 'none'`,
  `upgrade-insecure-requests`,
].join('; ');

const nextConfig: NextConfig = {
  cacheComponents: true,
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(), payment=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
