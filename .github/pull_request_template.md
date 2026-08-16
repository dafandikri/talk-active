## What and why

<!-- The diff says what changed. Say why it needed to. -->

## Closes

Closes #

## Checklist

- [ ] `pnpm check` is green locally (the pre-push hook enforces this)
- [ ] Test written first, and seen to fail before it passed
- [ ] No test was weakened or skipped to go green
- [ ] If this touches the demo path, `pnpm test:production:browser` is green

<!-- The line above used to name a demo script that went out with the vanilla
     build on 12 August 2026 and was never replaced, so this template asked
     every contributor to certify a command that could not be run — and
     harness-integration.test.mjs asserted the template still said so. The
     browser suite is the check that took the job over, and a test now
     verifies every command named here against package.json.

     Note it serves the existing build rather than making one, so run
     `pnpm build` first if you changed anything the client renders. -->

