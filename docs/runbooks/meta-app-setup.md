# Meta app setup (Track B, B-11)

What to create in Meta for developers so the app can connect Instagram accounts and publish. Values checked against the official docs on 2026-10-11 (decision log, M5-00). Do it once for the development app and once for the production app.

## 1. The apps

Two apps, so test posts never touch production accounts:

| App | Mode | Used by |
|---|---|---|
| `…-content-dev` | Development | local, preview and test accounts |
| `…-content-prod` | Live | production accounts (after Gate G2) |

Use the product **Instagram API with Instagram Login** (no Facebook Page is needed). **Standard Access** is enough: the app serves accounts you own or manage, and their owners are added to the app (roles → Instagram testers / app roles). Advanced Access and App Review are not planned.

## 2. Settings in the dashboard

| Setting | Value |
|---|---|
| Valid OAuth redirect URI | `https://<app host>/api/instagram/oauth/callback` (one per environment; for local work `http://localhost:3000/api/instagram/oauth/callback`) |
| Deauthorize callback URL | `https://<app host>/api/meta/deauthorize` |
| Data deletion request URL | `https://<app host>/api/meta/data-deletion` |
| Privacy policy URL | the public page (B-13) |
| Scopes asked for | `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights` |

The Instagram App ID and App Secret of the product page are `IG_APP_ID` and `IG_APP_SECRET`.

## 3. Accounts

Instagram **professional** accounts (Business or Creator): one per market (es-ES, en) and one or two for tests (for example `kitchen_test_es`, `kitchen_test_en`). A professional account is public, so keep test accounts low profile. Add each account's owner as a tester of the development app and accept the invitation in Instagram (Settings → Apps and websites → Tester invites).

## 4. Environment variables

| Variable | Development | Production |
|---|---|---|
| `INSTAGRAM_PUBLISH_MODE` | `dry_run_only` (live only on test accounts, deliberately) | `live` after Gate G2, `dry_run_only` before |
| `IG_APP_ID`, `IG_APP_SECRET` | the dev app | the prod app |
| `IG_REDIRECT_URI` | the dev redirect URI | the prod redirect URI |
| `META_GRAPH_API_VERSION` | `v25.0` | `v25.0` |
| `INSTAGRAM_ACCOUNT_ALLOWLIST` | the test accounts' Instagram ids, **never** a production id | the production accounts' ids |
| `TOKEN_ENCRYPTION_KEYS`, `TOKEN_ENCRYPTION_ACTIVE_KEY`, `OAUTH_STATE_SECRET` | different per environment | different per environment |

The Instagram id of an account is `user_id` from `GET /me`; after connecting, `Settings → Instagram` shows the user name, and `social_accounts.instagram_account_id` holds the id. An empty allowlist allows **no** account.

## 5. Connect

Sign in as an owner → Settings → Instagram → **Connect** on the market's card → log in to the right Instagram account and accept the permissions. The account must be professional and may be connected to one market only. To change accounts: Disconnect first.

Then continue with `docs/runbooks/instagram-smoke.md`.
