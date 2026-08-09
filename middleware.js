const REALM = 'Talk-Active Internal';

async function sameValue(left, right) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

export const config = {
  matcher: '/:path*',
};

export default async function middleware(request) {
  const password = process.env.SITE_PASSWORD;
  if (!password) {
    return new Response('Private access is not configured.', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const supplied = request.headers.get('authorization') ?? '';
  const expected = `Basic ${btoa(`talkactive:${password}`)}`;
  if (!(await sameValue(supplied, expected))) {
    return new Response('Authentication required.', {
      status: 401,
      headers: {
        'Cache-Control': 'no-store',
        'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    });
  }

  return undefined;
}
