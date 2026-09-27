# 05 · Backend / API contracts

Spec §23.1 item 5 (§23 item 4). The frontend talks to the backend through **server actions** (mutations) and **server-side queries** in React Server Components (reads). **Route handlers** exist only where an HTTP endpoint is required (OAuth, Meta callbacks, slide preview, health).

## 5.1 Conventions

```ts
// apps/web/src/server/actions/_define.ts
type ErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT'   // CONFLICT = stale lockVersion
               | 'INVALID_STATE' | 'RIGHTS_BLOCKED' | 'RATE_LIMITED' | 'EXTERNAL_ERROR' | 'INTERNAL';
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; fieldErrors?: Record<string, string[]>; requestId: string } };

defineAction({
  name: 'approveVariant',
  input: ApproveVariantInput,              // Zod schema
  roles: ['owner', 'editor', 'chef'],      // default: any active user
  handler: (ctx, input) => content.approveVariant(ctx, input),   // service call only
});
```
- Every action: validates input (Zod) → loads the session and `app_users` row → checks role → builds `ServiceContext` with a `requestId` → calls one service → maps `AppError` subclasses to `ErrorCode`. Unknown errors → `INTERNAL` (logged to Sentry with the request id).
- Mutations that change state write `audit_events` inside the service (not in the action).
- Long work never runs inside an action. The action starts a job through `JobRunner` and returns `{ jobRunId }`; the UI polls `getStatuses`.
- Optimistic locking: every edit on a variant sends `lockVersion`. Mismatch → `CONFLICT` ("changed by X, reload").
- IDs are UUID strings. Dates are ISO 8601 strings in UTC; the UI converts to the market or user time zone.
- Reads: RSC pages call query functions from `@rc/modules/*/queries` with a read-only context. They return plain serializable DTOs.

## 5.2 Auth, brand, markets, taxonomy

| Action | Input | Output | Rules / side effects | Roles |
|---|---|---|---|---|
| `requestMagicLink` | `{ email }` | `{ sent: true }` | Always returns `sent: true`; sends only to allowlisted, active users | public |
| `signOut` | – | `{ ok }` | – | any |
| `updateBrand` | `{ brandId, name?, description?, brandVoice?, visualSystem? }` | `Brand` | `visualSystem` validated (VisualSystem); audit `brand.updated` | owner |
| `updateMarket` | `{ marketId, displayName?, toneNotes?, foodCultureNotes?, preferredVocabulary?, forbiddenPatterns?, visualHypotheses?, timezone?, measurementSystem?, isActive? }` | `Market` | Regex patterns compiled to check validity; activating a market needs owner | owner, editor (not `isActive`) |
| `upsertTaxonomyTerm` | `{ kind, code, label, description?, parentCode?, isActive }` | `TaxonomyTerm` | `code` is UPPER_SNAKE; cannot delete used codes (only deactivate) | owner |
| `setAppSetting` | `{ key, value }` | `{ key, value }` | Allowed keys only (typed per key); audit | owner |

## 5.3 Sources and ingestion

| Action | Input | Output | Rules / side effects | Roles |
|---|---|---|---|---|
| `createSourceUpload` | `{ type: SourceType, title, fileName, mimeType, sizeBytes, originalLanguage, sourceAuthor?, rights: RightsPolicy, metadata? }` | `{ sourceAssetId, uploadUrl, uploadHeaders, expiresAt }` | Allowlist of MIME/extension per type and size limits (07 §7.2); presigned PUT (15 min, content-type and length bound); status PENDING_UPLOAD | any |
| `completeSourceUpload` | `{ sourceAssetId }` | `{ status: 'QUEUED' \| 'BLOCKED' }` | HEAD the object, compare size; audit `source.uploaded`; if `rights.aiProcessing = ALLOWED` → job `ingest-source`, else BLOCKED | any |
| `createTextSource` | `{ type: 'NOTE' \| 'TRANSCRIPT' \| 'RECIPE', title, text (≤ 200k chars), originalLanguage, rights }` | `{ sourceAssetId, status }` | Stores `.txt` in R2, then same flow as `completeSourceUpload` | any |
| `updateSourceRights` | `{ sourceAssetId, rights, rightsStatus }` | `SourceAsset` | Sets `confirmedBy/At`; audit `source.rights_changed`; unblocks BLOCKED sources if now allowed | owner |
| `reprocessSource` | `{ sourceAssetId, mode: 'FULL' \| 'KNOWLEDGE_ONLY' }` | `{ jobRunId }` | Increments `processing_attempt`; old unapproved cards from earlier attempts → ARCHIVED (`SUPERSEDED`); approved cards untouched | owner, editor |
| `archiveSource` | `{ sourceAssetId, reason }` | `{ ok }` | Only if no approved card is used by a non-archived idea (else `INVALID_STATE` with list) | owner |
| `getSourceDownloadUrl` | `{ sourceAssetId, page? }` | `{ url, expiresAt }` | Presigned GET, 10 min; `#page=N` appended for PDFs | any |
| `importHistoricalPosts` (P1) | `{ fileKey \| csvText, accountHandle }` | `{ imported, updated, errors: {row, message}[] }` | Zod row schema (07 §7.2.5); upsert on `(platform, external_id)`; optional annotation job | owner, editor |
| `confirmPostAnnotation` (P1) | `{ postId, annotations, isExemplar? }` | `HistoricalPost` | Sets `HUMAN_CONFIRMED` | any |

## 5.4 Knowledge

| Action | Input | Output | Rules / side effects | Roles |
|---|---|---|---|---|
| `updateKnowledgeCard` | `{ id, version, patch: { title?, category?, subcategory?, claim?, explanation?, procedure?, ingredients?, temperatures?, timings?, commonMistakes?, safetySensitive?, safetyNotes?, tags? } }` | `KnowledgeCard` | `version` = optimistic lock; editing a CHEF_APPROVED card → NEEDS_REVIEW, `version + 1`, variants that cite it and are not published get flag `KNOWLEDGE_CHANGED`; re-embed | any |
| `transitionKnowledgeCard` | `{ id, to: 'CHEF_APPROVED' \| 'NEEDS_REVIEW' \| 'ARCHIVED', archiveReason?, note?, acceptUnverifiedQuote?: boolean }` | `KnowledgeCard` | Transition table (10 §10.4.1). Approve: requires `quoteVerified` or `acceptUnverifiedQuote` with a note; writes `knowledge_item_versions`; archive of an approved card flags citing variants `KNOWLEDGE_ARCHIVED` | approve/restore: chef, owner; archive: any |
| `bulkTransitionKnowledgeCards` | `{ ids: string[] (≤ 100), to: 'CHEF_APPROVED' \| 'ARCHIVED', archiveReason? }` | `{ done: string[], skipped: { id, reason }[] }` | Same guards per card; unverified quotes are skipped (never bulk-overridden) | chef, owner |
| `createManualKnowledgeCard` (P1) | `{ fields…, sourceAssetId?, sourceReference? }` | `KnowledgeCard` | origin MANUAL, status NEEDS_REVIEW | any |
| `mergeDuplicateCards` (P1) | `{ keepId, duplicateIds[] }` | `{ archived: number }` | Duplicates → ARCHIVED (`DUPLICATE`, `duplicate_of_id = keepId`); refuses if a duplicate is used by an idea | chef, owner |
| `requestCardGloss` (P1) | `{ id }` | `{ glossEn }` | LLM gloss (stage KNOWLEDGE_GLOSS); cached in `gloss_en`; UI label "not approved text" | any |
| **query** `searchKnowledge` | `{ q?, semantic?: boolean, status?[], category?[], sourceAssetId?, flags?[], page, pageSize ≤ 100 }` | `Page<CardSummary>` | Text search: ILIKE on title/claim; semantic: embed `q` + cosine | – |
| **query** `getCardWithEvidence` | `{ id }` | `{ card, versions[], source?, pages: {n, text}[] (cited page ± 1), usedByIdeas[] }` | – | – |

## 5.5 Products and offers

| Action | Input | Output | Rules | Roles |
|---|---|---|---|---|
| `upsertProduct` | `{ id?, code, name, type, description?, originalLanguage, sourceAssetId?, status }` | `Product` | `code` unique | owner, editor |
| `upsertOffer` | `{ id?, marketId, productId, name, type, price?, currency, landingUrl?, defaultKeyword?, priority, status }` | `Offer` | `currency` must equal market currency (warning if not); URL must be https | owner, editor |

## 5.6 Master Ideas

| Action | Input | Output | Rules / side effects | Roles |
|---|---|---|---|---|
| `generateIdeas` | `{ count: 1–10, focus?: { categories?: string[], angles?: string[], productId?, commercialIntent? }, note?: string }` | `{ jobRunId, requestId }` | Job `generate-ideas`; ideas appear as PROPOSED | any |
| `createManualIdea` | `{ topic, category, angle, coreMessage, knowledge: { id, role }[], recommendedFormat: 'CAROUSEL', commercialIntent, productId? }` | `MasterIdea` | All cards must be CHEF_APPROVED; stores approved versions | any |
| `updateIdea` | `{ id, patch: { topic?, category?, angle?, coreMessage?, commercialIntent?, productId?, knowledge? } }` | `MasterIdea` | Only PROPOSED or ACCEPTED without active variants past DRAFT | any |
| `transitionIdea` | `{ id, to: 'ACCEPTED' \| 'REJECTED' \| 'ARCHIVED' \| 'PROPOSED', reason? }` | `MasterIdea` | Reject requires reason | any |
| `generateVariants` | `{ masterIdeaId, marketIds?: string[] (default: all active) }` | `{ variantIds: string[], jobRunId }` | Idea must be ACCEPTED; creates DRAFT variants (unique per idea/market); job `generate-content` with idempotency key `gen:{ideaId}:{requestId}` | any |

## 5.7 Variants and review

| Action | Input | Output | Rules / side effects | Roles |
|---|---|---|---|---|
| **query** `getReviewBundle` | `{ masterIdeaId }` | `{ idea, knowledge: CardSnapshot[], variants: VariantView[], differentiation?: DifferentiationReport }` | `VariantView` = fields + flags + critic report + render (presigned slide URLs, 30 min) + allowed actions | – |
| `editVariantField` | `{ variantId, lockVersion, field: FieldPath, value: unknown, reasonCode?, reason? }` | `{ variant: VariantView, reviewEventId }` | Value validated per field (template slot limits, caption ≤ 2,200, hashtags ≤ 30 ⚠ V-05); review event EDIT; APPROVED/SCHEDULED → READY_FOR_REVIEW (cancels publication, confirm required by UI); re-render (debounced) | any |
| `regenerateVariantField` | `{ variantId, lockVersion, field: FieldPath, instruction?: string (≤ 500), reasonCode? }` | `{ jobRunId }` | Job `regenerate-field`; result recorded as review event REGENERATE with original and new value | any |
| `regenerateVariant` | `{ variantId, instruction?, reasonCode }` | `{ jobRunId }` | Full pipeline for this market only; sibling stays as constraint | any |
| `requestChanges` | `{ variantId, reasonCode, reason }` | `VariantView` | → CHANGES_REQUESTED | any |
| `resubmitVariant` | `{ variantId }` | `VariantView` | CHANGES_REQUESTED → READY_FOR_REVIEW | any |
| `approveVariant` | `{ variantId, lockVersion, checklist: { factsChecked: true, safetyChecked?: boolean, manychatConfigured?: boolean } }` | `{ variant, versionId, campaignId? }` | Guards (10 §10.4.3): current render READY and built from current content; no blocking flags; SAFETY_REVIEW needs `safetyChecked`; commercial intent needs offer. Creates `content_variant_versions` + campaign id (commercial); audit | any |
| `rejectVariant` | `{ variantId, reasonCode, reason? }` | `VariantView` | → REJECTED (terminal) | any |
| `unapproveVariant` | `{ variantId, reason }` | `VariantView` | APPROVED/SCHEDULED/FAILED → READY_FOR_REVIEW; cancels open publication | any |
| `triggerRender` | `{ variantId }` | `{ jobRunId }` | Job `render-carousel` (no-op if a READY render with the same input hash exists) | any |
| `assignExperiment` (P1) | `{ variantId, experimentId, arm: 'A' \| 'B' }` | `VariantView` | Market must match | owner, editor |
| **query** `getStatuses` | `{ sourceIds?, variantIds?, renderIds?, publicationIds? }` | `Record<id, { status, progress?, flags?, error? }>` | Polled every 3 s while any item is in progress | – |

## 5.8 Scheduling and publishing

| Action | Input | Output | Rules / side effects | Roles |
|---|---|---|---|---|
| `schedulePublication` | `{ variantId, mode: 'IMMEDIATE' \| 'SCHEDULED', scheduledAt?: ISO, dryRun?: boolean }` | `Publication` | Variant APPROVED with `approved_version_id`; `scheduledAt ≥ now + 5 min`; warning (not error) if no ACTIVE account for the market or another post for the market is within `publishing.min_gap_minutes`; IMMEDIATE requires ACTIVE account with VALID token and publishing enabled; idempotency key `pub:{publicationId}:0`; variant → SCHEDULED (or PUBLISHING for IMMEDIATE) | owner, editor |
| `reschedulePublication` | `{ publicationId, scheduledAt }` | `Publication` | Only SCHEDULED | owner, editor |
| `cancelPublication` | `{ publicationId, reason }` | `Publication` | Only SCHEDULED or QUEUED; variant → APPROVED | owner, editor |
| `retryPublication` | `{ publicationId }` | `Publication` | Only FAILED; all guards re-checked; `retry_no + 1`, new idempotency key; keeps existing container ids when still valid | owner, editor |
| `setPublishingEnabled` | `{ enabled, reason }` | `{ enabled }` | Kill switch (`publishing.enabled`); audit | owner |
| **query** `getCalendar` | `{ from, to, marketIds? }` | `CalendarItem[]` `{ publicationId, variantId, market, scheduledAt, status, title, thumbnailUrl, warnings[] }` | – | – |
| **query** `getPublication` | `{ publicationId }` | `{ publication, attempts: PublishAttempt[], variantVersion }` | – | – |

## 5.9 Instagram (route handlers + actions)

| Endpoint / action | Input | Output | Rules |
|---|---|---|---|
| `GET /api/instagram/oauth/start?marketId=` | query | 302 to Instagram authorize URL | Owner only; state = HMAC-signed `{marketId, nonce, exp (10 min)}` in an httpOnly, SameSite=Lax cookie + `state` param ⚠ V-03 |
| `GET /api/instagram/oauth/callback?code=&state=` | query | 302 to `/settings/instagram?result=…` | Verify state and cookie; exchange code → short-lived → long-lived token; `GET /me`; require professional account; refuse if the account is bound to another market; encrypt and store; audit `instagram.connected` |
| `disconnectInstagramAccount` | `{ socialAccountId }` | `{ ok }` | Owner only. Status DISABLED, token deleted; open publications for the market get a warning |
| `checkInstagramAccountHealth` | `{ socialAccountId }` | `AccountHealth` `{ tokenStatus, expiresAt, quotaUsage, quotaTotal, lastPublishAt, lastError? }` | Owner, editor. Calls `/me` and `content_publishing_limit` |
| `POST /api/meta/deauthorize` | form `signed_request` | `200 {}` | Verify HMAC-SHA256 with app secret; account → REVOKED; audit ⚠ V-13 |
| `POST /api/meta/data-deletion` | form `signed_request` | `{ url, confirmation_code }` | Delete stored token and account profile data; status page `/data-deletion/{code}` ⚠ V-13 |

## 5.10 Analytics, attribution, learning

| Action / query | Input | Output | Notes |
|---|---|---|---|
| **query** `getGrowth` | `{ marketId?, from, to }` | `{ tiles, followersSeries, reachSeries, nonFollowerShareSeries }` | 11 §11.4 |
| **query** `getEngagement` | `{ marketId?, from, to }` | `{ tiles, posts: PostRates[] }` | D7-standardized rates |
| **query** `getContentLearning` | `{ marketId, dimension, from, to, minSample? }` | `{ rows: { value, n, medianSaveRate, medianShareRate, medianReach, liftVsMarket, lowSample }[] }` | – |
| **query** `getCommercial` | `{ marketId?, from, to }` | `{ byCampaign[], byOffer[], totals }` | P1 |
| **query** `getOperations` | `{ from, to }` | `{ generated, approvalRate, rejectionReasons[], avgEditsPerApproved, medianTimeToApproveHours, criticPassRate, costPerApprovedPost }` | – |
| **query** `getLineage` | `{ publicationId }` | lineage DTO (04 §4.6) + metrics timeline + review events | – |
| `collectMetricsNow` | `{ publicationId }` | `{ jobRunId }` | Creates a MANUAL snapshot |
| `createAttributionEvent` (P1) | `{ marketId, type, occurredAt, campaignId?, offerId?, quantity, amount?, currency?, externalRef?, notes? }` | `AttributionEvent` | No customer PII fields exist |
| `importAttributionCsv` (P1) | `{ csvText, mapping }` | `{ imported, skipped, unknownCampaignIds[] }` | Upsert on `(source, external_ref)` |
| `buildPerformanceSummary` (P1) | `{ marketId?, windowDays: 28 \| 56 \| 90 }` | `{ jobRunId }` | – |
| `upsertExperiment` / `setExperimentStatus` (P1) | experiment fields / `{ id, status }` | `Experiment` | – |

## 5.11 Settings, AI, health

| Action / endpoint | Output | Notes |
|---|---|---|
| **query** `getAiSettings` | `{ stages: { stage, promptId, version, model, effort }[], costMonthToDate, costByStage[] }` | Read-only in MVP (config in code) |
| `setStageOverride` (P2) | – | DB override with eval gate |
| **query** `getSystemHealth` | `{ db, storage, instagram: AccountHealth[], jobs: { failed24h by domain }, insightsLag, aiErrors24h, publishingEnabled }` | 12 §12.6 |
| `GET /api/health` | `{ status: 'ok' \| 'degraded', version, checks: { db, storage } }` | No secrets; for uptime monitoring |
| `GET /api/preview/slide?variantId=&slideId=&draft=` | `text/html` | Authenticated; returns exactly the HTML the renderer uses (08 §8.5) |
