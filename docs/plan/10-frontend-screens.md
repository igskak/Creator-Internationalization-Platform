# 10 · Frontend screens and state flows

Spec §23.1 item 10 (§23 item 10). Admin UI in English (A-09). Server Components for reads, server actions for writes, polling for job progress.

## 10.1 Navigation [S§10.1]

```
Dashboard
Content      ├─ Ideas            /content/ideas
             ├─ Drafts           /content/drafts          (+ review screen /content/review/[ideaId])
             ├─ Calendar         /content/calendar
             └─ Published        /content/published       (+ lineage /content/published/[publicationId])
Knowledge    ├─ Sources          /knowledge/sources
             ├─ Knowledge Base   /knowledge/cards
             ├─ Products/Offers  /knowledge/offers
             └─ Historical posts /knowledge/posts         (P1)
Markets      ├─ Spain            /markets/es-ES
             ├─ English          /markets/en
             └─ France (later)   disabled item
Analytics                         /analytics?tab=growth|engagement|learning|commercial|operations
Experiments                       /experiments             (P1)
Settings     ├─ Instagram        /settings/instagram
             ├─ Brand            /settings/brand
             ├─ AI / Providers   /settings/ai
             └─ Health           /settings/health
```
The app shell shows global banners: publishing kill switch off, an Instagram account needs re-auth, a token expires in < 7 days.

## 10.2 Screen catalog

| Route | Purpose | Main data | Main actions | Task | Prio |
|---|---|---|---|---|---|
| `/login` | Magic-link login | – | request link | M0-15 | P0 |
| `/dashboard` | Work queue + health | counters: cards to review, ideas proposed, drafts ready for review, approved not scheduled, scheduled next 7 days, failed publications; health tiles; next 7 days; recent activity | links into queues | M0-17 → H-01 | P0 |
| `/knowledge/sources` | Source library | sources with type, language, rights badge, status/progress, card count | upload (dialog with rights matrix), reprocess, archive | M1-04 | P0 |
| `/knowledge/sources/[id]` | Source detail | metadata, rights, pages preview, batches, errors, cards | edit rights (owner), download, reprocess | M1-04 | P0 |
| `/knowledge/cards` | Knowledge Base | cards table (title, category, status, flags, confidence, source, language), status counts | filters, text/semantic search, bulk approve/archive | M1-17 | P0 |
| `/knowledge/cards/[id]` | Card review | card editor · evidence viewer (cited page text with highlighted quote, ± 1 page, open PDF page) · flags · versions · used by ideas | save, approve (chef/owner), needs review, archive, merge (P1), English gloss (P1) | M1-18 | P0 |
| `/knowledge/offers` | Products + market offers | products; offers per market | create/edit, status | M2-02 | P0 |
| `/knowledge/posts` | Historical posts | posts with metrics and annotations | import CSV/JSON, confirm annotations, mark exemplar | M1-22/23 | P1 |
| `/content/ideas` | Ideas | tabs PROPOSED / ACCEPTED / REJECTED / ARCHIVED | generate ideas (count, focus, product, note), new manual idea | M2-08 | P0 |
| `/content/ideas/[id]` | Idea detail | core message, angle, category, intent/product, linked cards (approved text + source), rationale | accept, reject, archive, "Generate ES + EN drafts" | M2-08 | P0 |
| `/content/drafts` | Draft queue | variants: idea, market flag, status, quality score, flags, updated, reviewer | filters, open review | M4-07 | P0 |
| `/content/review/[ideaId]` | **Primary review screen** (10.3) | idea + all market variants side by side | edit, regenerate, approve, reject, request changes, schedule, publish | M2-15 → M4-05 | P0 |
| `/content/calendar` | Calendar [S§11] | week grid by day/time, market colors and flags; "approved, not scheduled" sidebar | schedule, reschedule, cancel, open publication | M4-09 | P0 |
| `/content/published` | Published posts | posts with D7 rates, permalink | open lineage, collect metrics now, export CSV | M6-09 | P0 |
| `/content/published/[id]` | Lineage view | source → cards → idea → market brief → approved version → publication → metrics timeline → review events | – | M6-09 | P0 |
| `/markets/[code]` | Market profile | tone notes, food culture notes, vocabulary, forbidden patterns, visual hypotheses, units, time zone, account status | edit | M0-18 | P0 |
| `/analytics` | Dashboards [S§12.3] | Growth, Engagement, Content learning, Commercial (P1), Operations, Learning summary (P1) | filters: market, date range, dimension | M6-05…07, M6-08, M7-03 | P0/P1 |
| `/experiments` | Experiments-lite | experiments, arms, results | create, start, complete | M7-06 | P1 |
| `/settings/instagram` | Accounts | per market: account, token status, expiry, quota, last publish, last error | connect, reconnect, disconnect, check health | M5-03 | P0 |
| `/settings/brand` | Brand | voice guide (Markdown), visual system tokens, logo | edit | M0-18 | P0 |
| `/settings/ai` | AI / providers | stage → prompt version, model, effort; cost month-to-date by stage; provider errors | – (read-only in MVP) | H-05 | P1 |
| `/settings/health` | System health | 12 §12.9 indicators; kill switch | toggle kill switch (owner) | H-01 | P0 |

## 10.3 Primary review screen [S§10.2]

```
┌ Idea: "Why fish dries out before it hits the pan" · ACCEPTED · COMMON_MISTAKE · Lead magnet: Fish Guide ──────────────┐
│ MASTER IDEA (sticky)         │ 🇪🇸 SPAIN · READY_FOR_REVIEW · QS 4.3   │ 🇬🇧 ENGLISH · READY_FOR_REVIEW · QS 3.9          │
│ Core message + evidence      │ Flags: [SAFETY_REVIEW]                  │ Flags: [DUPLICATION_RISK ⚠]                     │
│ Knowledge refs (approved):   │ HOOK "…"                 [✎] [↻]        │ HOOK "…"                    [✎] [↻]             │
│  • Dry brining fish (v2)     │ ◀ carousel preview 1/8 ▶  (JPEG render) │ ◀ carousel preview 1/7 ▶                        │
│    claim · source p.42  ↗    │   [✎ slide] [↻ slide] [↻ image]         │   [✎ slide] [↻ slide] [↻ image]                 │
│ Offer / intent               │ CAPTION 1,234 / 2,200    [✎] [↻]        │ CAPTION …                                       │
│ Differentiation ES↔EN:       │ CTA: COMMENT_KEYWORD "PESCADO" · offer  │ CTA …                                           │
│  hook 0.71 · slides 0.64 OK  │ Critic: PASS · issues (2 minor) ▸       │ Critic: FLAG_FOR_HUMAN · 1 major ▸              │
│ Cost / generation p1.0.0     │ [Request changes] [Reject] [Approve ▸]  │ [Request changes] [Reject] [Approve ▸]          │
└──────────────────────────────┴─────────────────────────────────────────┴─────────────────────────────────────────────────┘
```
- **Field-level control** [S§10.2]: hook, each slide (slots and image), caption, CTA and hashtags can be edited or regenerated alone. Regenerate opens a small popover: optional instruction (≤ 500 chars) + reason code.
- **After regeneration** the field shows old vs new text with "Keep" / "Undo". Undo is a normal edit back to the old value (recorded).
- **Slide drawer**: slot inputs with character counters and limits; cited card chips (click → card text); image slot (current image, regenerate with instruction; library pick and upload are P1); live HTML preview (08 §8.5).
- **Critic panel**: verdict, scores (1–5), issues and unsupported claims; clicking an issue focuses the field.
- **Knowledge references**: each slide shows its cited cards; the idea column lists all cards with the approved text and a link to the source page [S§18 traceability].
- **Approve** is disabled while blockers exist; the tooltip lists them (stale render, blocking flags, missing offer, safety checklist). The approve dialog shows the checklist: "Facts checked against cards" (always), "Safety statements checked" (if `SAFETY_REVIEW`), "ManyChat keyword flow set up" (if CTA is COMMENT_KEYWORD or DM_KEYWORD).
- **After approval**: "Schedule…" (date/time in market time zone, with conflicts shown) and, from M5, "Publish now" and "Dry run".
- **Concurrency**: every edit sends `lockVersion`. On conflict: toast "Changed by Sergey 1 min ago" + Reload; unsaved text is kept locally.
- **Keyboard** (P1): `J/K` next/previous slide, `E` edit, `R` regenerate, `A` approve.

## 10.4 State machines (single source: `modules/*/state.ts`; UI reads "allowed actions" from the server)

### 10.4.1 Knowledge card [S§6.4]

| From | Action | To | Who | Guard | Side effects |
|---|---|---|---|---|---|
| EXTRACTED | checks finished | NEEDS_REVIEW | system | – | flags |
| NEEDS_REVIEW | approve | CHEF_APPROVED | chef, owner | quote verified, or override + note; required fields filled | version snapshot, `approved_version`, re-embed, audit |
| NEEDS_REVIEW | archive | ARCHIVED | any | archive reason | audit |
| CHEF_APPROVED | edit content | NEEDS_REVIEW | any | confirm dialog | version + 1; unpublished citing variants get `KNOWLEDGE_CHANGED` (warning) |
| CHEF_APPROVED | archive | ARCHIVED | chef, owner | reason | unpublished citing variants get `KNOWLEDGE_ARCHIVED` (blocks approval) |
| ARCHIVED | restore | NEEDS_REVIEW | chef, owner | – | audit |

### 10.4.2 Master Idea

| From | Action | To | Guard |
|---|---|---|---|
| PROPOSED | accept | ACCEPTED | all linked cards still CHEF_APPROVED |
| PROPOSED | reject | REJECTED | reason required |
| ACCEPTED | archive | ARCHIVED | no variant in APPROVED / SCHEDULED / PUBLISHING |
| REJECTED, ARCHIVED | restore | PROPOSED | – |
| ACCEPTED | generate variants | (creates DRAFT variants) | – |

### 10.4.3 Content variant [S§7.4 + C-02]

| # | From | Event | To | Guard | Side effects |
|---|---|---|---|---|---|
| 1 | – | `generateVariants` | DRAFT | idea ACCEPTED; no active variant for (idea, market) | audit |
| 2 | DRAFT, READY_FOR_REVIEW, CHANGES_REQUESTED | pipeline start | GENERATING | no other pipeline running | `pipeline_state` |
| 3 | GENERATING | pipeline success | READY_FOR_REVIEW | – | critic report, flags; images → render |
| 4 | GENERATING | pipeline failure | DRAFT | – | `GENERATION_FAILED`, `last_error` |
| 5 | READY_FOR_REVIEW | edit / regenerate field | READY_FOR_REVIEW | lockVersion | review event, re-render |
| 6 | READY_FOR_REVIEW | request changes | CHANGES_REQUESTED | reason | review event |
| 7 | CHANGES_REQUESTED | edit / regenerate field | CHANGES_REQUESTED | lockVersion | review event, re-render |
| 8 | CHANGES_REQUESTED | resubmit | READY_FOR_REVIEW | – | review event |
| 9 | READY_FOR_REVIEW | approve | APPROVED | render READY and built from current content; no blocking flags; checklist; offer set if commercial | `content_variant_versions` snapshot; campaign id; audit |
| 10 | READY_FOR_REVIEW, CHANGES_REQUESTED | reject | REJECTED (terminal) | reason code | audit |
| 11 | APPROVED | schedule | SCHEDULED | time ≥ now + 5 min | publication SCHEDULED |
| 12 | APPROVED | publish now | PUBLISHING | account ACTIVE + token VALID; publishing enabled | publication QUEUED → J10 |
| 13 | SCHEDULED | cancel schedule | APPROVED | publication SCHEDULED or QUEUED | publication CANCELLED |
| 14 | SCHEDULED | dispatcher claims | PUBLISHING | safeguards | – |
| 15 | PUBLISHING | success | PUBLISHED (terminal) | – | snapshot slots due; audit |
| 16 | PUBLISHING | permanent failure | FAILED | – | alert, banner |
| 17 | FAILED | retry | PUBLISHING (or SCHEDULED with a new time) | all guards again | new attempt |
| 18 | APPROVED, SCHEDULED, FAILED | edit / regenerate / unapprove | READY_FOR_REVIEW | confirm dialog | open publication CANCELLED; approval invalid |

Dry runs never change the variant status. PUBLISHED content cannot be edited (post-MVP: "clone as new variant").

### 10.4.4 Publication
See 09 §9.4.1 (SCHEDULED → QUEUED → IN_PROGRESS(step) → PUBLISHED | FAILED | CANCELLED | DRY_RUN_PASSED).

## 10.5 UX rules
- **Status colors**: DRAFT gray · GENERATING blue (spinner) · READY_FOR_REVIEW amber · CHANGES_REQUESTED orange · APPROVED green · SCHEDULED teal · PUBLISHING blue · PUBLISHED dark green · FAILED red · REJECTED gray (struck through).
- **Flags** are badges; blocking flags are red with a lock icon and a tooltip that says how to fix.
- **Progress**: while an item on the page is in progress (GENERATING, PROCESSING, RENDERING, QUEUED, IN_PROGRESS), poll `getStatuses` every 3 s; stop after 15 min with "still running — check Health".
- **Confirmations** name the effect: "This cancels the scheduled post on Tue 13:00 (ES)".
- **Errors**: toast with a human message + copyable request id; failed jobs show the domain error on the entity page (not only in logs) [S§11].
- **Empty states** with the next step ("No approved knowledge yet → Review cards").
- **Time**: shown in the market time zone; user local time on hover.
- **Language attributes**: content blocks get `lang="es" | "en" | "ru"` for correct fonts and screen readers.

## 10.6 Permissions (not granular RBAC [S§3.2]; one role per user)

| Capability | owner | editor | chef |
|---|---|---|---|
| Upload sources, edit knowledge, generate ideas/variants, edit, approve or reject variants | ✓ | ✓ | ✓ |
| Approve knowledge cards (CHEF_APPROVED), restore archived cards, merge duplicates | ✓ | – | ✓ |
| Confirm rights, archive sources | ✓ | – | – |
| Schedule, publish, cancel, retry | ✓ | ✓ | – |
| Connect Instagram, kill switch, app settings, taxonomy, brand | ✓ | – | – |
| Market profile text (not activation) | ✓ | ✓ | – |
