# Instagram smoke test and the idempotency drill (M5-10, plan 13 §13.6)

There is no Instagram sandbox. Instead: the mock Graph API in CI, and this smoke test against real **test accounts**. Run it before Gate G2, after every Graph API version change, and when the publishing code changes.

## Before you start

1. The Meta dev app and a test account are set up and the account is connected (`docs/runbooks/meta-app-setup.md`).
2. `.env` of the environment: `INSTAGRAM_PUBLISH_MODE=dry_run_only` (or `live` for a live run), the `IG_*` variables, and the **test account's Instagram id in `INSTAGRAM_ACCOUNT_ALLOWLIST`**.
3. Storage is reachable (the slides are written to the bucket under `smoke/…` and removed again).

## 1. Dry-run smoke (posts nothing)

```bash
pnpm ig:smoke --account <user name or social account id>
```

It runs, on three synthetic 1080 × 1350 slides, the calls the publisher makes: environment check → `/me` (token, account type) → `content_publishing_limit` → one child container per slide from **presigned links** (the V-14 test) → the carousel container → polls until FINISHED. It prints a report and exits non-zero if a step failed. The unused container expires by itself in about 24 hours.

## 2. Live smoke (posts a public test post)

Needs `INSTAGRAM_PUBLISH_MODE=live`. Use a **test** account only.

```bash
pnpm ig:smoke --account <user name> --live --probe-republish
```

It asks you to type the user name, then also publishes, reads the permalink, calls `media_publish` once more on the same container (V-08: what Meta answers) and tries the media insights call (V-10). The test post is public until you **delete it by hand in the Instagram app** (the API cannot, V-15); the report names the media id.

Add `--out smoke-report.txt` to keep the report, and `--yes` to skip the confirmation (do not, for a live run, unless you are sure).

## 3. Idempotency drill (Gate G2, item 1)

Goal: exactly one post, whatever happens between `media_publish` and the end of the job.

1. In the development environment with a live-mode test account and `publishing.enabled` on, approve a draft in the test market and press **Publish now**.
2. While the post is being published, stop the job worker (Ctrl-C of `pnpm jobs:dev`, or cancel the run in the Trigger.dev dashboard) at the `PUBLISH` step — the window is short, so for the drill you can also insert a pause: set a breakpoint, or run `pnpm rc` with a mock, or simply trigger the job twice (step 3).
3. Trigger `publish-content` twice for the same publication (Trigger.dev dashboard → Test, payload `{ "publicationId": "<id>" }`). The second run must end with `NOOP` or `IN_FLIGHT`.
4. Check: the Instagram profile shows **one** post; `publish_attempts` of the publication has one `media_publish` row with outcome OK (a second row only with `reconciled` in its response); the publication is `PUBLISHED` with a permalink.
5. Delete the test post by hand.

The same drill is automated against the mock Graph API in `modules/src/publishing/publish-machine.test.ts` ("the idempotency drill", "a worker died after the call", "two runs race"). The manual drill proves it against Meta.

## 4. What to record

Paste each report into the log below (date, who, environment, account, dry or live, result) and update the open verification items in `docs/plan/decision-log.md`:

| Item | What the run tells you |
|---|---|
| V-14 | Meta accepts (or not) presigned R2 links with query strings. If not: set `RENDERS_PUBLIC_BASE_URL` and move only the `renders/` prefix to a public, unguessable location (plan 09 §9.3). |
| V-08 | What a second `media_publish` of the same container does (`--probe-republish`). The code does not rely on it. |
| V-06 | The real fields of `content_publishing_limit`. |
| V-07 | How long a carousel container takes to be FINISHED. |
| V-10 | Whether media insights answer right after posting. |
| V-09 | Any error code the run met that `instagram/errors.ts` does not know: add it with a test. |

### Log

| Date | By | Environment | Account | Kind | Result | Notes |
|---|---|---|---|---|---|---|
| _not run yet_ | | | | | | |

## Troubleshooting

| Report says | Cause and fix |
|---|---|
| `The account is not in INSTAGRAM_ACCOUNT_ALLOWLIST` | Add the account's Instagram id to the variable of this environment and restart. |
| `AUTH (code 190)` at "token and profile" | The token expired or was revoked: reconnect the account in Settings → Instagram. |
| "could not be downloaded" at "child containers" | Meta cannot fetch the presigned link (V-14) or the bucket is unreachable. See the table above. |
| `PERMISSION` | A scope was not accepted at connect: reconnect and accept all permissions. |
| "The container is ERROR" | Instagram refused the image or caption (format, ratio, size). The slides here are valid, so check the account (it must be professional) and the app mode. |
| `RATE_LIMIT` | New or quiet accounts have small limits (calls = 4,800 × impressions). Wait and run again. |
