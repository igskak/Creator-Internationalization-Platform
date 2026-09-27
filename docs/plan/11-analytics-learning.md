# 11 · Analytics and learning loop

Spec §23.1 item 11 (§23 item 11). Goal [S§12]: learn which combination of topic, angle, hook, format, visual style, CTA, offer, market and posting context gives better results.

## 11.1 Principles
- **Snapshots, not only the latest numbers** [S§12.1]. Each snapshot records its measurement time and media age.
- **Compare at the same age.** D7 (7 days after publishing) is the standard for comparisons; D3 is the fallback, flagged.
- **Rates per reach**: save rate, share rate, comment rate. They compare posts across account size better than raw counts.
- **Small samples are directional.** Groups with fewer than `analytics.min_sample` posts (default 3) are shown as "low sample" and are excluded from the performance memory. No p-values in dashboards before there is enough data.
- **Deterministic learning v1** [S§12.4]: SQL + code summaries, no autonomous memory agent.

## 11.2 Collection (jobs J11, J12)

| Snapshot | When (after publish) | Why |
|---|---|---|
| H2 | +2 h | early distribution signal, catches broken posts |
| D1 | +24 h | first-day performance |
| D3 | +72 h | fallback for comparisons |
| **D7** | +168 h | **standard for comparisons** |
| D28 | +672 h | long tail (saves, shares) |
| MANUAL | on demand | debugging, special reports |

- **API budget**: 5 media calls per post + ~3 account calls per account per day. At ≤ 3 posts per day per market this is < 100 calls per day, far below limits ⚠ V-12.
- **Media metrics** ⚠ V-10: reach, views, likes, comments, saved, shares, total_interactions, profile_visits, profile_activity, follows → `metric_snapshots` columns (09 §9.5).
- **Account metrics** (daily, market-local date) ⚠ V-11: followers_count, reach (followers / non-followers breakdown), views, accounts_engaged, total_interactions, follows/unfollows → `account_metric_snapshots` [C-03].
- **Posting context** stored at publish time: `published_at`, market time zone, `follower_count_at_publish`.

## 11.3 Views (migration 0007)

```sql
create view v_publication_dimensions as
select p.id as publication_id, p.published_at, p.follower_count_at_publish,
       m.id as market_id, m.code as market_code,
       extract(isodow from p.published_at at time zone m.timezone)::int as weekday_local,
       case when extract(hour from p.published_at at time zone m.timezone) between 6 and 10  then 'MORNING'
            when extract(hour from p.published_at at time zone m.timezone) between 11 and 14 then 'MIDDAY'
            when extract(hour from p.published_at at time zone m.timezone) between 15 and 17 then 'AFTERNOON'
            when extract(hour from p.published_at at time zone m.timezone) between 18 and 21 then 'EVENING'
            else 'NIGHT' end as daypart_local,
       mi.id as master_idea_id, mi.topic, mi.category, mi.angle, mi.commercial_intent, mi.product_id,
       cv.id as variant_id, cv.format, cv.hook_type, cv.visual_style, cv.cta_type, cv.offer_id,
       cv.template_sequence, cv.template_sequence[1] as first_template_id,
       (cv.content_length ->> 'slides')::int       as slide_count,
       (cv.content_length ->> 'captionChars')::int as caption_chars,
       cv.generation_version, cv.experiment_id, cv.experiment_arm, cv.campaign_id
from publications p
join content_variants cv on cv.id = p.content_variant_id
join master_ideas mi     on mi.id = cv.master_idea_id
join markets m           on m.id = cv.market_id
where p.status = 'PUBLISHED' and p.dry_run = false;

create view v_publication_metrics_d7 as
select distinct on (s.publication_id)
       s.publication_id, s.snapshot_slot, s.media_age_hours,
       s.reach, s.views, s.likes, s.comments, s.saves, s.shares, s.total_interactions,
       s.saves::numeric    / nullif(s.reach, 0) as save_rate,
       s.shares::numeric   / nullif(s.reach, 0) as share_rate,
       s.comments::numeric / nullif(s.reach, 0) as comment_rate,
       coalesce(s.total_interactions, s.likes + s.comments + s.saves + s.shares)::numeric
                           / nullif(s.reach, 0) as engagement_rate,
       (s.snapshot_slot = 'D7') as is_exact_d7
from metric_snapshots s
where s.media_age_hours >= 72
order by s.publication_id, abs(s.media_age_hours - 168);

create view v_campaign_attribution as
select cv.campaign_id, cv.market_id, cv.offer_id,
       count(*) filter (where a.type = 'LEAD') as leads,
       count(*) filter (where a.type = 'SALE') as sales,
       coalesce(sum(a.amount) filter (where a.type = 'SALE'), 0)
     - coalesce(sum(a.amount) filter (where a.type = 'REFUND'), 0) as revenue
from content_variants cv
left join attribution_events a on a.campaign_id = cv.campaign_id
where cv.campaign_id is not null
group by cv.campaign_id, cv.market_id, cv.offer_id;
```
Revenue is summed per currency in queries (one currency per market). Unknown `campaign_id` values in `attribution_events` appear in a reconciliation list.

## 11.4 Dashboard groups and queries [S§12.3]

| Group | Metrics (formula) | Source |
|---|---|---|
| **Growth** | followers (latest `followers_count`); follower growth (Δ over window); daily reach; non-follower reach share = `reach_non_followers / (reach_followers + reach_non_followers)` | `account_metric_snapshots` |
| **Engagement** | median save rate, share rate, comment rate, engagement rate (D7) per window; per-post table | `v_publication_metrics_d7` |
| **Content learning** | per dimension value: n, median save/share rate, median reach, lift vs market median, low-sample badge; top/bottom posts | dimensions ⨝ D7 |
| **Commercial** (P1) | leads, sales, revenue per campaign / offer / market; revenue per 1,000 reach = revenue / Σ D7 reach of the campaign's posts × 1,000 | `v_campaign_attribution` ⨝ D7 |
| **Operations** | generated variants; approval rate = approved / (approved + rejected); rejection reasons; average edits per approved variant; median time to approve (READY_FOR_REVIEW → APPROVED, from `audit_events`); critic first-pass PASS rate; regenerations per variant; AI cost per approved post | `content_variants`, `review_events`, `audit_events`, `generation_runs` |

Content-learning query (dimension column comes from a whitelist, never from user text):
```sql
select d.hook_type as value, count(*) as n,
       percentile_cont(0.5) within group (order by m.save_rate)  as median_save_rate,
       percentile_cont(0.5) within group (order by m.share_rate) as median_share_rate,
       percentile_cont(0.5) within group (order by m.reach)      as median_reach
from v_publication_dimensions d
join v_publication_metrics_d7 m using (publication_id)
where d.market_id = $1 and d.published_at >= $2 and d.published_at < $3
group by 1
order by median_save_rate desc nulls last;
-- lift = median_save_rate / (market median over the same window); lowSample = n < min_sample
```
Dimensions offered [S§12.2]: topic/category, angle, hook_type, format, visual_style, market, cta_type, offer, daypart and weekday (publishing time), slide count and caption length buckets (content length), first template and template sequence (template_id), generation_version.

## 11.5 Performance memory v1 (M7-02) [S§12.4]

```ts
interface PerformanceMemory {
  marketCode: string; window: { from: string; to: string };
  basis: { publications: number; metric: 'D7'; minSample: number };
  topPatterns:  { dimension: string; value: string; n: number; metric: 'save_rate'|'share_rate'; lift: number;
                  confidence: 'low'|'medium'|'high' }[];     // lift ≥ 1.2, max 5
  weakPatterns: { /* same shape */ }[];                        // lift ≤ 0.8, max 5
  overusedThemes: { category: string; angle?: string; count: number; windowDays: number }[];
  coverageGaps:   { category: string; approvedCards: number; postsLast30d: number }[];
  untestedHypotheses: { source: 'visual_hypothesis'|'experiment'|'hook_type'; description: string }[];
  offerPriorities: { offerId: string; productCode: string; priority: number; leads?: number; sales?: number }[];
  feedback: { topRejectionReasons: { code: string; count: number }[];
              mostEditedFields: { field: string; count: number }[];
              hookRewrites: { original: string; edited: string }[] };   // last 5
  caveats: string[];                                               // e.g. "only 12 posts; patterns are directional"
}
```
**Algorithm** (window 56 days by default; `min_sample` from settings):
1. Load posts with D7 metrics for the market; compute the market medians.
2. For each dimension (category, angle, hook_type, visual_style, cta_type, first_template_id, daypart, slide-count bucket, generation_version): group, keep n ≥ min_sample, compute lift vs market median for save and share rate. Confidence: n < 5 low, 5–9 medium, ≥ 10 high.
3. Overused: category/angle used by ≥ 3 approved-or-later variants in the last 21 days, or > 30 % of them.
4. Coverage gaps: categories with ≥ 5 approved cards and no post in the last 30 days.
5. Untested: market visual hypotheses with status UNTESTED; DRAFT experiments; hook types not used in the window.
6. Offer priorities: active offers by `priority`, with leads/sales in the window.
7. Feedback: top rejection reasons, most-edited fields, last 5 hook rewrites.
8. Keep the JSON under ~1,500 tokens; store in `performance_summaries` with the raw stats.

**How it feeds generation** (M7-04):
- Idea generator v2 gets `<performance_memory>` and rules: prefer strong patterns, avoid overused themes, fill coverage gaps, include at least one idea per batch that tests an untested hypothesis, respect offer priorities, explain the choice in `whyNow`. `master_ideas.performance_summary_id` records which summary was used.
- Writer v2 gets hook-type guidance (advice, not a rule) and a rejection digest ("avoid" list).
- Until a market has ~20 D7-measured posts, pattern sections stay empty with a caveat; only overuse, gaps, feedback and offers are used. Honest expectation: the learning loop gives real signal only after several weeks of regular posting (R-08).

## 11.6 Experiments-lite (M7-06, P1) [S§5 experiments]
- Define: name, hypothesis, market, dimension (e.g. `visual_style`), arm A value, arm B value, primary metric (default save rate at D7), minimum posts per arm (default 5).
- Assign variants to arms on the review screen (manual; no automatic allocation in MVP).
- Results: n per arm, median primary metric, difference, Mann–Whitney U p-value, shown only when both arms reach the minimum; otherwise "insufficient data".
- Completing an experiment can update the market's visual hypothesis status (CONFIRMED / REJECTED) — this is how market-specific visual rules become durable only after data [S§8.2].

## 11.7 Commercial attribution [S§13.1]
- **Campaign ID** for every commercial variant, created at approval: `rc-{market}-{yymmdd}-{6 chars}` (e.g. `rc-es-260927-k3f9qa`), stored in `content_variants.campaign_id` and the approved snapshot.
- **UTM link**: `landing_url?utm_source=instagram&utm_medium=social&utm_campaign={campaign_id}&utm_content={variant short id}` (`offers/utm.ts`).
- **ManyChat (manual in MVP)** [S§9.3]: the review screen shows the keyword, DM link with UTMs, and flow name = campaign id, with copy buttons. For COMMENT_KEYWORD / DM_KEYWORD CTAs the approval checklist requires "ManyChat flow set up".
- **Leads and sales**: manual entry and CSV import (P1) from the selling stack; no customer PII (A-10). Minimum for the first experiment: manual reconciliation campaign → lead/sale is possible [S§13.1].
