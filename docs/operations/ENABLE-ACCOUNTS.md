# Enabling accounts in production

**Status on 18 August 2026:** accounts are **off** on the deployed site.
`GET /api/capabilities` returns `"accounts": false` and `"persistence": "local"`.

Nothing is missing from the code. `lib/auth.ts` configures better-auth with
email and password, the schema has the tables, the account screen has working
sign-in and sign-up, and `e2e/production-ui/` covers multi-project sync. What
is missing is a database and a secret on the Vercel deployment.

Guest mode has therefore been the only mode in production. That is worth
saying plainly because the app degrades so gracefully that a missing
environment variable looks like a design choice.

---

## What the code decides from

`app/api/capabilities/route.ts`:

```ts
const databaseAvailable = Boolean(process.env.DATABASE_URL?.trim());
const accountsAvailable = Boolean(databaseAvailable && process.env.BETTER_AUTH_SECRET?.trim());
```

So `accounts` becomes true only when **both** are present. There is no third
flag and no partial state: a database without a secret still reports
`accounts: false`, which is correct — better-auth would throw at startup
otherwise.

## Steps

Steps 1–3 need credentials only the captain can create. Step 4 onward can be
done by anyone with the connection string.

### 1. Provision Postgres

Vercel dashboard → the Talk-Active project → Storage → Neon. The Marketplace
integration sets `DATABASE_URL` on the project automatically.

The driver is `@neondatabase/serverless` with a **pooled** connection
(`lib/db/client.ts`), chosen because the HTTP driver has no interactive
transactions and rubric replacement must never leave a half-written rubric
behind. Use the pooled connection string, not the direct one.

### 2. Set the auth secret

```
BETTER_AUTH_SECRET   a random 32+ byte value, e.g. `openssl rand -base64 32`
```

Production and Preview both need it. It signs session cookies: changing it
later signs every existing session out, which is a recoverable annoyance
rather than data loss.

### 3. Set the auth URL

```
BETTER_AUTH_URL      https://talk-active-id.vercel.app
```

Optional in the code (`baseURL` falls back to undefined) but set it anyway:
without it, better-auth infers the origin per request, and a preview
deployment can end up minting cookies for the wrong host.

### 4. Apply the migrations — before the code that needs them

There are nine migrations in `apps/web/drizzle/`. Apply them **before** the
first request that selects from a new column, not after. `0008_flat_frank_castle.sql`
adds `projects.language`, and the signed-in path selects that column, so a
deployment that runs ahead of its migration fails every project query.

```bash
cd apps/web
DATABASE_URL='<pooled connection string>' pnpm db:migrate
```

`db:migrate` and `db:status` were added on 18 August. Before that, `db:generate`
wrote migration SQL and nothing applied it, so this document would have ended
at "and then somehow run these".

### 5. Verify, in this order

```bash
# accounts and persistence should both flip
curl -s https://talk-active-id.vercel.app/api/capabilities

# expect 200, not the 503 accounts_unavailable that guest-only returns
curl -s -o /dev/null -w '%{http_code}\n' https://talk-active-id.vercel.app/api/auth/get-session
```

Then in a browser, in this order, because the second is the one people forget:

1. Create an account on `/account`, sign out, sign back in.
2. **In a private window, do a complete guest rehearsal without signing in.**

Step 2 is the actual acceptance test. Enabling accounts must not put a wall in
front of a first rehearsal — the entry screen promises exactly that, and the
booth demo depends on it.

## What changes for existing users

Nothing, by design. Guest stays the default and an account stays opt-in.

Two things become reachable that were previously dead ends:

- **Sign-in on `/account`** stops reporting "account sync is not configured here".
- **"Bring in N browser projects"** appears for a signed-in user who has local
  projects, importing them through `/api/data/import/local`. The original
  browser data is left in place — `account-panel.tsx` never calls `removeItem`,
  and `test/data-portability.test.mjs` asserts that.

## What this does not enable

`sourceDocuments` and `recordings` also need `BLOB_READ_WRITE_TOKEN` (Vercel
Blob). They stay false until that is set, and both degrade visibly rather than
failing: source attachment is hidden, and a replay stays in the page instead of
uploading.

## Rollback

Remove `BETTER_AUTH_SECRET`. `accounts` returns to false, the account screen
returns to its guest-mode message, and local workspaces are untouched, since
guest data lives in `localStorage` and was never migrated away.
