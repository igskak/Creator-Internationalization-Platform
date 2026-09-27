# 09 · Instagram integration

Spec §23.1 item 9 (§23 item 9). Official Meta / Instagram API only [S§9, §21]: no password storage, no browser automation, no device emulation.

> **Verification rule.** Every Meta detail in this section is a starting point from secondary sources and memory. Scopes, versions, limits and metric names change. Before M5 coding starts, task M5-00 checks every ⚠ item against the official docs ([S§24] links) and records the result in `docs/plan/decision-log.md`. Code keeps all Meta specifics in `modules/instagram` (adapter) so changes stay local [S§9.1].

## 9.1 Access model and setup (Track B B-11, runbook `docs/runbooks/meta-app-setup.md`)
- Product: **Instagram API with Instagram Login** (D-14). Accounts: Instagram **Professional** accounts (Business or Creator) [S§9] — one for Spain (es-ES), one for English, plus test accounts.
- Access level: **Standard Access** — enough when the app only serves accounts we own or manage and their owners have a role on the app ⚠ V-01. Advanced Access (App Review + Business Verification) is **not** planned; if V-01 fails, it becomes a schedule risk (R-05).
- Two Meta apps: `regchef-content-dev` (Development mode, test accounts) and `regchef-content-prod` (Live mode).
- App settings needed: OAuth redirect URIs (`https://<app>/api/instagram/oauth/callback` per environment), deauthorize callback URL, data deletion request URL ⚠ V-13, privacy policy URL (Track B B-13).
- Scopes ⚠ V-02: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights`. Not requested in MVP: comments, messages (ManyChat handles DMs [S§9.3]).
- Graph API version pinned in env `META_GRAPH_API_VERSION` ⚠ V-04; upgraded deliberately with a smoke test.

## 9.2 Connection and tokens

```
Owner clicks "Connect" for a market
  → GET /api/instagram/oauth/start?marketId=…        (owner only)
      state = HMAC({marketId, nonce, exp: now+10 min}) → httpOnly SameSite=Lax cookie + state param
  → Instagram authorize page (scopes above)
  → GET /api/instagram/oauth/callback?code=…&state=…
      1. verify state against cookie + HMAC + expiry          (else 400, audit)
      2. code → short-lived token                              ⚠ V-03
      3. short-lived → long-lived token (~60 days)             ⚠ V-03
      4. GET /me?fields=user_id,username,account_type          → professional account required
      5. refuse if this IG account is ACTIVE for another market
      6. encrypt token (AES-256-GCM, enc:v1) → social_accounts (ACTIVE, VALID, expires_at, scopes)
      7. audit 'instagram.connected' → redirect to /settings/instagram
```
- **Storage**: only the encrypted long-lived token. Decrypted inside `modules/instagram` right before a call. Never sent to the browser, never logged [S§19].
- **Refresh** (J13, daily): refresh when the token is ≥ 24 h old and expires within 20 days (or was not refreshed for 7 days) ⚠ V-03. Refreshed tokens are valid ~60 days from refresh.
- **Health** (J14, every 6 h): `/me` + publishing limit → `social_accounts.last_health`.
- **Failure**: error code 190 (invalid/expired) → `NEEDS_REAUTH`, token status INVALID, red banner in the app shell and on the calendar; scheduled publications for that market show "will fail: reconnect account" [S§11.1].
- **Token transport**: prefer the `Authorization: Bearer` header if graph.instagram.com accepts it ⚠ V-04; otherwise the `access_token` query parameter. Either way the HTTP wrapper logs only the path, never the full URL.

## 9.3 Publishing flow [S§9.2]
Rendered JPEGs are in the private R2 bucket. For each slide the adapter creates a **presigned GET URL (TTL 2 h)** that Meta fetches ⚠ V-14. If Meta rejects presigned URLs, switch renders to a public bucket/custom domain with unguessable keys (config flag `RENDERS_PUBLIC_BASE_URL`), still never exposing sources [S§19].

## 9.4 Publishing state machine (`modules/publishing/publish-machine.ts`)

### 9.4.1 States and steps

```
publication.status: SCHEDULED ──dispatcher──► QUEUED ──job──► IN_PROGRESS ──► PUBLISHED
                        │                        │                 │  └──────► DRY_RUN_PASSED (dry run)
                        └──cancel──► CANCELLED ◄─┘                 └────────► FAILED ──retry──► QUEUED
IN_PROGRESS steps (persisted in publications.step, resumable):
  GUARDS          safeguards (9.4.2); failure → FAILED with no API call
  CREATE_CHILDREN for each slide i without children[i]:
                    POST /{ig-user-id}/media  image_url=<presigned i>, is_carousel_item=true
                    → persist children[i] immediately (one row update per child)
  CREATE_PARENT   if no container: POST /{ig-user-id}/media  media_type=CAROUSEL, children=<ids>, caption=<snapshot caption>
                    → persist ig_container_id
  WAIT_READY      GET /{container-id}?fields=status_code  every 30–60 s, max 10 min (wait.for) ⚠ V-07
                    FINISHED → next · IN_PROGRESS → wait · EXPIRED → clear ids, back to CREATE_CHILDREN (once)
                    ERROR → FAILED (INVALID_MEDIA)
                    dry run → stop here: DRY_RUN_PASSED (containers expire unused after ~24 h ⚠ V-07)
  PUBLISH         re-check container status (PUBLISHED → go to RECONCILE)
                    write publish_attempts row (outcome AMBIGUOUS) → POST /{ig-user-id}/media_publish creation_id=<container>
                    → persist instagram_media_id, update attempt row to OK
  FINALIZE        GET /{media-id}?fields=permalink,timestamp · GET /me?fields=followers_count
                    → permalink, published_at, follower_count_at_publish · status PUBLISHED
                    → variant PUBLISHED · audit 'publication.published' · snapshot slots become due
```
Every HTTP call writes a `publish_attempts` row (redacted request/response, outcome, error code, fbtrace id) [S§11.1 audit log].

### 9.4.2 Safeguards (checked in GUARDS and again right before PUBLISH) [S§11.1]
1. Kill switch `publishing.enabled = true` and `INSTAGRAM_PUBLISH_MODE` = `live` (or `dry_run_only` for dry runs).
2. Publication not CANCELLED; variant status SCHEDULED or PUBLISHING; `publication.content_variant_version_id = variant.approved_version_id` → **only APPROVED content is published**.
3. The approved render is READY; each rendered slide's SHA-256 matches the snapshot; 2–10 slides; each 1080 × 1350.
4. Social account ACTIVE, token VALID and not expired; `account.market_id = variant.market_id` (never post ES content on the EN account); account id in `INSTAGRAM_ACCOUNT_ALLOWLIST` for this environment.
5. `instagram_media_id` is null and no other live publication exists for the variant (unique index) → **no duplicates**.
6. Publishing quota from `content_publishing_limit` is not exhausted (cached ≤ 10 min) ⚠ V-06.
7. Caption ≤ 2,200 characters, ≤ 30 hashtags ⚠ V-05.

### 9.4.3 Reconciliation after an unclear publish
Case: the `media_publish` call timed out, or the worker died after the call but before saving the media id.
1. On resume (step PUBLISH, attempt row AMBIGUOUS, no media id): `GET /{container-id}?fields=status_code`.
2. `PUBLISHED` → `GET /{ig-user-id}/media?fields=id,caption,timestamp,permalink&limit=10`; match by caption hash and timestamp ≥ attempt start → save the media id → FINALIZE.
3. `FINISHED` (not published) → safe to call `media_publish` again.
4. Anything else, or no match → publication FAILED with "manual check required" and an alert. **Never** publish again blindly.
Whether Meta rejects a second `media_publish` for the same container is checked in M5-00 ⚠ V-08; the design does not rely on it.

### 9.4.4 Error classification (`modules/instagram/errors.ts`; initial table, verify codes ⚠ V-09)

| Signal | Class | Action |
|---|---|---|
| HTTP 5xx, network error, timeout; codes 1, 2 | TRANSIENT | retry with backoff |
| HTTP 429; codes 4, 17, 32, 613; "request limit reached" | RATE_LIMIT | retry after ≥ 60 s (longer if usage headers show 100 %) |
| code 190 (invalid / expired token) | AUTH | stop; account NEEDS_REAUTH; publication FAILED |
| code 10, 200–299 (permission) | PERMISSION | stop; FAILED; UI shows the missing scope |
| code 100 with media-related subcodes (format, aspect ratio, size, fetch) | INVALID_MEDIA | stop; FAILED with a human explanation. Media fetch failure: re-presign once, then stop |
| container `ERROR` | INVALID_MEDIA | stop |
| anything else | UNKNOWN | retry up to max attempts, then FAILED |

The table lives in code with unit tests and MSW fixtures; every unknown code seen in production is added after investigation.

## 9.5 Insights retrieval [S§12.1]
- **Media insights** (J11) for carousel posts ⚠ V-10: `reach`, `views`, `likes`, `comments`, `saved`, `shares`, `total_interactions`, `profile_visits`, `profile_activity`, `follows`. `impressions`, `plays` and `video_views` are deprecated — do not use. If the API rejects a metric for a media type, remove it, retry once, and cache the availability (`app_settings.instagram.metric_availability`).
- **Account insights** (J12) ⚠ V-11: `followers_count` (profile field), `reach` with `breakdown=follow_type` (followers vs non-followers), `views`, `accounts_engaged`, `total_interactions`, `follows_and_unfollows` (some need ≥ 100 followers). Missing values are stored as null, never as 0.
- **Timing**: insights can lag; every snapshot stores `measured_at` and `media_age_hours`.
- Mapping to columns: `saved → saves`, `follows → follower_change`, profile metrics → `profile_actions_json`, full response → `raw_metrics_json`.

## 9.6 Webhooks and callbacks
- **Webhooks: not needed in MVP.** Publishing is request/response + polling; insights are polled; comments and DMs belong to ManyChat [S§9.3].
- **Required callbacks** ⚠ V-13: deauthorize (`POST /api/meta/deauthorize`) and data deletion (`POST /api/meta/data-deletion`). Both verify `signed_request` (HMAC-SHA256 with the app secret). Deauthorize → account REVOKED, token deleted. Data deletion → delete token and profile data, return `{ url, confirmation_code }`.
- Post-MVP: comment webhooks for learning (needs `instagram_business_manage_comments`).

## 9.7 Limits and quotas (verify all)
- ≤ 100 API-published posts per 24 h per account (a carousel counts as 1); some sources say 50 ⚠ V-06. We plan ≤ 3 per day per account.
- Carousel: 2–10 items via API, even though the app allows 20 ⚠ V-05.
- JPEG only; aspect ratio 4:5 to 1.91:1; width 320–1440 px; ≤ 8 MB ⚠ V-05.
- Caption ≤ 2,200 characters; ≤ 30 hashtags; ≤ 20 mentions ⚠ V-05.
- Containers expire after ~24 h ⚠ V-07.
- Business Use Case rate limits scale with account impressions ⚠ V-12; our volume is < 200 calls per day.
- Media deletion through the API: assume not available ⚠ V-15 → test posts are removed by hand.

## 9.8 Environment guards and testing
- `INSTAGRAM_PUBLISH_MODE`: `off` | `dry_run_only` | `live`. dev = `dry_run_only` (live only for test accounts); prod = `live` after Gate G2.
- `INSTAGRAM_ACCOUNT_ALLOWLIST`: IG account ids allowed per environment. Production ids never appear in dev.
- Kill switch `publishing.enabled` (owner, audited), visible in the header when off.
- **Dry run** runs GUARDS → WAIT_READY against the real API: Meta validates format, size and fetchability without posting. Used for every first post of a new template and before G2 on production accounts.
- Tests: MSW fixtures for every step and error class (CI); smoke script `pnpm ig:smoke` against test accounts (M5-10); details in 13 §13.6.

## 9.9 Endpoint reference (starting points only ⚠ V-03, V-04)

| Purpose | Request |
|---|---|
| Authorize | `GET https://www.instagram.com/oauth/authorize?client_id&redirect_uri&response_type=code&scope=…&state=…` |
| Code → short-lived token | `POST https://api.instagram.com/oauth/access_token` (client_id, client_secret, grant_type=authorization_code, redirect_uri, code) |
| Short → long-lived token | `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=…&access_token=…` |
| Refresh | `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=…` |
| Profile | `GET https://graph.instagram.com/{v}/me?fields=user_id,username,account_type,followers_count` |
| Child container | `POST /{v}/{ig-user-id}/media` image_url, is_carousel_item=true |
| Carousel container | `POST /{v}/{ig-user-id}/media` media_type=CAROUSEL, children, caption |
| Container status | `GET /{v}/{container-id}?fields=status_code` |
| Publish | `POST /{v}/{ig-user-id}/media_publish` creation_id |
| Media / recent media | `GET /{v}/{media-id}?fields=id,permalink,timestamp` · `GET /{v}/{ig-user-id}/media?fields=id,caption,timestamp,permalink&limit=10` |
| Publishing limit | `GET /{v}/{ig-user-id}/content_publishing_limit?fields=quota_usage,config` |
| Media insights | `GET /{v}/{media-id}/insights?metric=…` |
| Account insights | `GET /{v}/{ig-user-id}/insights?metric=…&period=day&metric_type=total_value&breakdown=follow_type` |

Reference links from the spec [S§24]: Instagram Platform docs, Content Publishing, Insights (Instagram Login), Postman collection mirror.
