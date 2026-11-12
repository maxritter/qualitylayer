# Phase 2 obsolete collaboration-resource manifest

<!-- v14-current-handover-pointer -->
> **Current checkpoint — 11 November, 20:33 UTC:** read [the v14 handover and prioritized TODOs](10-v14-current-handover.md) and [the replacement goal prompt](08-overnight-goal.md) before acting on this document. The prior coordinator/workers are paused. Current source, source-bound evidence and later direct decisions supersede historical implementation statuses, seven-step descriptions, counts and earlier action limits below. The active product has Plan / Implement / Verify. Broader refactoring follows functional correctness; release gates still apply before publication. Actual source publication, key/history changes and infrastructure deletion remain separate. This document retains its original contract or audit history; it is not a current completion receipt.

Prepared 11 November 2026, 14:30 UTC, from read-only provider calls (Vercel API/MCP, Neon MCP, Upstash read-only token, Wrangler, `gh`). Nothing was written, deployed or reconfigured. This is the list to retire later, not an approval to do so.

**Gate.** Max decided on 11 November that public share links are retired and that the share API and the database stay up, because older App versions might crash without them. The 14-day replacement clock no longer gates the share links, but it still gates everything below: the API, Neon and the old-client workflow service stay until Max approves this exact manifest after both replacements are available for at least 14 days, users have migrated, and the longest grant/cache horizon (currently 720 h) has cleared (01-migration-plan.md, R1/R2). No scheduled or automatic deletion. Every row is a separate Max YES.

**Never touch.** Pilot Shell 11.x (`pilot-shell-legacy-api`, `prj_TXccrJI83HyNvQUZxqStUFgus9NB`, its Upstash store `qualitylayer-redis-prod` / `store_EBGV2NZsnfK07kWM`, its domains), billing/Polar objects, licence keys, signing keys, `GIT_CRYPT_KEY`, private history, published media (`qualitylayer-media` bucket and Worker), support feedback and newsletter data. Never `FLUSHDB` a Redis store or delete a whole bucket.

## Current cost baseline

| Provider | Resource | Month to date (1–11 Nov) | Source |
| --- | --- | --- | --- |
| Neon (Vercel Marketplace, Launch) | `qualitylayer-prod` | $7.35: 69.4 CU-hours compute, 0.045 GB-month storage | Vercel integration billing |
| Upstash (Pay As You Go) | `qualitylayer-redis-beta` (QL production) | $2.55 | Vercel integration billing |
| Upstash (Free) | `qualitylayer-staging-20261021` | $0 | Vercel storage |
| Vercel usage, whole team | all projects | $0.25 billed (1–10 Nov), QL project a few cents | `/v1/billing/charges`; plan fee not included |
| Cloudflare R2/Workers | 4 buckets, 3 Workers | not read (no billing call made) | — |

Neon's production compute (`ep-muddy-sea-b25ybhq9`) has been active without a suspend since 28 October: the five-minute collaboration cron and old-client polls keep it awake at its 0.25 CU floor. Disabling the cron (R1 action 1) is the first change that can let it suspend; the saving is not known until a week of usage is read again. No other saving is claimed.

## Vercel (team `team_jAsHrk71vRyWK6bCTYGJyp0q`, project `qualitylayer`, `prj_SbOGJL2YBjvq9P5MSjxcrj87IGbi`)

Production is `dpl_EY27X6PGRLDvfSW8fq92aiyRfMPt` (main `49c357f4a`, backend base `824d98db8`, overlay digest `5d3667867…`). Git deployments are disabled; deploys go through `docs/site/scripts/deploy-website.sh`.

| Resource | Used today by | Retire | Precondition |
| --- | --- | --- | --- |
| Cron `/api/team/slack/due` `*/5 * * * *` (project crons enabled, bound to the production deployment) | Slack/email delivery, queue purge, team-file cleanup | **R1.** Land the integrator patch (vercel.json without `crons`) with commit `8a27005f6`, then deploy main through the deploy-website skill; or, immediately, Dashboard → qualitylayer → Settings → Cron Jobs → Disable Cron Jobs | Max YES for the deploy or the dashboard toggle. The payload change makes the route a no-op either way |
| Functions `api/team/**`, `api/share*`, `api/slack/*`, `api/workflow`, `api/team/email/*` | old clients (12.x, 13.0) | R2: deploy the direct current-source API without them (item 23 code removal) | old clients migrated; 720 h horizon cleared; retained-service waves (item 18) live |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` (production) | Slack OAuth start/callback | R2: `vercel env rm SLACK_CLIENT_ID production --yes` (same for `SLACK_CLIENT_SECRET`), run in `docs/site` with `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` set | Slack routes removed from the deployed API; `catalog.mjs` required names updated first |
| `SLACK_TOKEN_KEY`, `SLACK_WORDS_KEY` (production, preview) | sealing Slack tokens and queued words | R2: `vercel env rm <NAME> production --yes` and `… preview --yes` | same as above |
| `TEAM_EMAIL_SECRET`, `RESEND_WEBHOOK_SECRET` (production, preview) | team email turn-off links, `/api/team/email/events` | R2: `vercel env rm <NAME> production --yes`, `… preview --yes` | team email routes removed; Resend webhook deleted |
| `CRON_SECRET` (production, preview) | only `team/slack/due` | R2: `vercel env rm CRON_SECRET production --yes`, `… preview --yes` | due route removed; required names updated |
| `DATABASE_URL` (sensitive; production, preview) and the 15 `OWNER_*` variables from the Neon store | every SQL route, deploy migrations, backup job, release workflow upload | R2: disconnect the Neon store (below); `vercel env rm DATABASE_URL production --yes`, `… preview --yes` | trial cutover done (item 17), retained services SQL-free (item 18), backup and release jobs no longer read the database |
| Neon integration store `qualitylayer-prod` (`store_v2ajIcGB9KVKhro0`), connected to **both** QL and Pilot production | QL: `OWNER_*`; Pilot: `DATABASE_URL`, `PG*`, `POSTGRES_*`, `NEON_PROJECT_ID` | R2: Dashboard → Storage → qualitylayer-prod → Projects → disconnect each project; then Settings → Delete store | Pilot's live deployment (`dpl_5sTjoBknySadV7f9USQLdxeJTab2`, 4 October) predates the Neon project and 11.x code has no Neon import; verify that again, and that disconnecting from Pilot changes only its unused variables |
| Neon integration configuration `icfg_sFnCelMTiNm5f12ztrhaikVA` | the store above | R2: remove only if no other store remains | store deleted |
| Upstash staging store `qualitylayer-staging-20261021` (`store_1awIAmdt0v9fDg8X`, preview only) | preview deployments, trial rehearsal | R2: Storage → disconnect from preview → Delete store | no preview or rehearsal still uses it (ask the trial owner) |
| Preview deployment `dpl_8ZtLUhmkrZtvYTtpowuuis1cGUJD` (dev `1f9655ec6`, 30 October) | none known; its cron is inert on preview | R2: `vercel remove dpl_8ZtLUhmkrZtvYTtpowuuis1cGUJD --safe --yes --scope team_jAsHrk71vRyWK6bCTYGJyp0q` | none of the above remains bound |

Keep: `RSA_PRIVATE_KEY`, `POLAR_*` (including `POLAR_TEAM_BENEFIT_ID` for existing subscribers), `UPSTASH_*` of the production store, `RESEND_API_KEY`, `NEWSLETTER_SECRET`, `FEEDBACK_*`, `GITHUB_TOKEN`, `TRIAL_HASH_KEY`, `QUALITYLAYER_STAGING` until the staging store goes.

## Neon (organization `org-soft-queen-05893863`, managed by Vercel)

| Resource | State | Used today by | Retire | Precondition |
| --- | --- | --- | --- | --- |
| Project `qualitylayer-prod` `fancy-wildflower-92648240` (aws-eu-central-1, PG 18), database `neondb`, role `neondb_owner` | 46 MB logical; 27 tables; trials 274, workflow_texts 45 (12.0.0 … 13.0.1), team_wrapped_keys 1006, team_devices 90, team_files 14, shares 2, team_tasks 1, team_slack 1, team_slack_queue 0 (estimates) | the whole old-client API | R2: through the Vercel store deletion above (the branch is restricted as the Vercel production branch) | final reviewed archive copy kept; trial ledger cut over and read back; every row above approved |
| Branch `main` `br-nameless-sky-b2328swy`, endpoint `ep-muddy-sea-b25ybhq9` (0.25–8 CU, active) | production | as above | with the project | as above |
| Branch `qualitylayer-staging-20261021` `br-lively-water-b220lqdj` (archived), endpoint `ep-autumn-bread-b2k07une` (idle since 21 October) | staging copy | nothing since 21 October | R2 or earlier: `npx neonctl@latest branches delete br-lively-water-b220lqdj --project-id fancy-wildflower-92648240` | confirm no preview `DATABASE_URL` points at it (its value is sensitive and was not read) |
| Project `qualitylayer-preview` `wispy-dream-62321197`, branch `br-lively-sunset-b211tobr` (archived), endpoint `ep-summer-king-b27ddc85` (idle since 19 October) | not connected to any Vercel store | nothing since 19 October | R2 or earlier: Neon console → project → Settings → Delete project | same preview check as above |

Neon keeps deleted projects recoverable for a short window; that is not a backup plan.

## Upstash Redis

QL production store `qualitylayer-redis-beta` (`store_vSLCJykOtdzAmsEX`, resource `d5c9ad1a-c1c1-4a2a-b5be-58ef0a9d77cb`) is **retained**: trial ledger, billing, licence caches, newsletter and support. PING ok, 345 keys. Counts by family, read with the read-only token:

| Family | Keys | Owner | R2 action |
| --- | --- | --- | --- |
| `team:<id>:slackuser:*` | 56 | Slack identity cache | delete |
| `team:<id>:eid:*` | 15 | team email identity | delete |
| `team:<id>:sent:*` | 6 | notification sent-once keys | delete |
| `rev:*` | 7 | team change numbers | delete |
| `teamfiles*` | 1 | team file ledger | delete |
| `ratelimit:team:*`, `ratelimit:share:*`, `ratelimit:pass:*` | 11, 1, 16 | retired routes | delete (they also expire) |
| `team:<id>:members` | 3 | **billing seat cache** (billing.ts) | keep |
| `billing:*`, `entitle:*`, `wf:*`, `ratelimit:{billing,entitlement,trial,workflow,public-feedback-image}:*` | 180, 16, 4, 14 | billing, licence, workflow cache, limits | keep (`wf:*` and `ratelimit:workflow:*` go with `/api/workflow` at R2) |
| `limit:*`, `until:*` | 13, 2 | unclassified | keep until classified |
| `trial-ledger:*` | 0 | not cut over yet | keep |

Command for each family to delete, after a reviewed dry run, with a read-write token held in an owner-only temp file: `redis-cli --tls -u "$UPSTASH_REDIS_URL" --scan --pattern 'team:*:slackuser:*' > keys.txt`, review `keys.txt`, then `xargs -n 100 redis-cli --tls -u "$UPSTASH_REDIS_URL" DEL < keys.txt`. Precondition: the routes that read the family are gone from the deployed API.

## Cloudflare R2 and Workers

| Resource | Used today by | Retention | Retire | Precondition |
| --- | --- | --- | --- | --- |
| Bucket `qualitylayer-files` (EU, 59 objects, 4.04 MB): `feedback/`, `public-feedback/staged|published|receipts/`, `team-files/` | feedback store Worker (support), team file parts | `feedback/` expires after 92 days; `team-files/` never expires | R2: delete the `team-files/<team>/<file>/<part>` keys listed by the reviewed archive manifest, one by one: `npx wrangler r2 object delete qualitylayer-files/<key> -J eu --remote`. Count the prefix first with an R2 read token (`aws s3 ls s3://qualitylayer-files/team-files/ --recursive --endpoint-url https://<account>.eu.r2.cloudflarestorage.com`); SQL shows 14 file rows and 1 part row | reviewed final archive; old clients migrated. Keep the bucket and every other prefix |
| Bucket `qualitylayer-backups` (EU, 220 objects, 148 MB): `backups/production/<date>.json.gz.age` (daily SQL copy), `snap/full-*`, `snap/inc-*` (Worker copies), `state/backup.json` | backup.yml, the Worker's cron | lifecycle: everything after 30 days; lock `snap/` 30 days | nothing to delete by hand: SQL copies stop once backup.yml is removed and age out in 30 days; `team-files/` snap copies age out 30 days after the Worker change below. Never promise immediate erasure | — |
| Bucket `qualitylayer-feedback` (WEUR, 7 objects, 744 kB, `feedback/` 91-day rule) | not bound by the current QL Worker (created 4 October) | as configured | out of scope; identify its owner (likely the Pilot/12.0 store) before any action | — |
| Bucket `qualitylayer-media` (WEUR, 52 objects, 185 MB) and Worker `qualitylayer-media` | films and posters | keep | keep | — |
| Worker `qualitylayer-feedback-store` (cron `*/10 * * * *`, live version from 24 October, "12.2 public reporting") | support images and team file parts, backup slices | — | **R1:** deploy commit `8a27005f6`'s backup.js so no new team-files/ copies are made: `cd docs/site/workers/feedback-store && npx wrangler deploy`. **R2:** deploy a version without the team-files PUT/GET/DELETE routes | R1: the reviewed final archive of team files exists and Max approves the deploy; the live Worker is two weeks older than source, so diff the deployed bundle first |

## Scheduled jobs

| Schedule | Where | R1 | R2 |
| --- | --- | --- | --- |
| `*/5 * * * *` `/api/team/slack/due` | Vercel cron | off (row above) | route removed |
| `0 3 * * *` Backup | `.github/workflows/backup.yml` (checks out `main`) | keeps running; the share pruning is gone once `8a27005f6` reaches main | delete the workflow; `gh secret delete R2_BACKUP_ACCESS_KEY_ID`, `gh secret delete R2_BACKUP_SECRET_ACCESS_KEY` (`R2_ACCOUNT_ID` too if nothing else uses it). Precondition: no SQL left to copy |
| `17 * * * *` Site health | `.github/workflows/site-health.yml` (runs from `main`) | new checks need the secrets in the YES list before they reach main | keep the website, feed and trial-ledger checks; drop the workflow-grant check with `/api/workflow` |
| `*/10 * * * *` | feedback-store Worker | retained | retained |
| releases | `.github/workflows/release.yml` pulls the production `OWNER_DATABASE_URL` to upload workflow texts | retained for the pinned old-client set (item 15) | remove the upload step |

## Slack app and email domain

| Resource | Used today by | Retire | Precondition |
| --- | --- | --- | --- |
| The Slack app whose client ID is the `SLACK_CLIENT_ID` above (one installation: `team_slack` has 1 row, Max's workspace) | team notifications, identity DMs | R2: api.slack.com/apps → the app → Settings → Basic Information → Delete App; then the Vercel variables above | Slack routes removed; the one installation's owner told |
| Resend sending domain `notify.qualitylayer.dev` (`team@notify…`) and the webhook to `/api/team/email/events` | team email only (newsletter and billing use `mail.qualitylayer.dev` / `hello@`) | R2: Resend dashboard → Webhooks → delete the `/api/team/email/events` endpoint; Domains → remove `notify.qualitylayer.dev`, then its DNS records | team email routes removed |

## Preview and development consumers

- Preview environment of `qualitylayer`: `DATABASE_URL`, `OWNER_DATABASE_URL`, `CRON_SECRET`, `SLACK_TOKEN_KEY`, `SLACK_WORDS_KEY`, `TEAM_EMAIL_SECRET`, `RESEND_WEBHOOK_SECRET`, `QUALITYLAYER_STAGING`, staging Upstash. Only deployment: `dpl_8ZtLUhmkr…` from 30 October.
- `pilot-shell-legacy-api` receives Git builds from this repository's `main` that its ignore step cancels (latest `dpl_AjCMRJqiaLTLc9Q4n2UvHUmGsbTx`); its production stays the 4 October deployment. Not part of this retirement.
- Local development: `docs/site/.env.development` holds only Polar checkout URLs; the site's local scripts read Neon only when `DATABASE_URL` is exported by hand.

## Live actions waiting for Max's YES

Done on 11 November with Max's approval: the project's cron jobs were disabled through the Vercel API at 14:40:03 UTC (`crons.disabledAt` set, `vercel crons list` shows disabled; the share API still answers 404 and `/api/workflow` 402 for an invalid trial). The Worker was redeployed at 14:44 UTC as version `165dfc70-afb9-48d1-93d7-06afcb95cd6e`, after the live bundle diff showed only the team-files exclusion; its 14:50 backup run completed. `QL_HEALTH_REDIS_URL` and `QL_HEALTH_REDIS_READ_ONLY_TOKEN` (the store's existing read-only token, which refused a write probe with 403) are set as repository secrets. At Max's decision the licence secrets use one dedicated Polar activation of his own key (label `site-health-…`, a synthetic fingerprint, never this Mac's): `QL_HEALTH_LICENCE_KEY`, `QL_HEALTH_ACTIVATION_ID` and `QL_HEALTH_FINGERPRINT` are set, and that request got an exact 13.0.1 grant from `/api/workflow`. The key allows 5 activations. At R2, release it with Polar's deactivate call for that activation id and delete the three secrets.

R1, can happen now (each independently):

1. Stop the collaboration cron: after the integrator patch and `8a27005f6` reach `main`, deploy with the deploy-website skill (`bash docs/site/scripts/deploy-website.sh`); or, at once, Dashboard → qualitylayer → Settings → Cron Jobs → Disable Cron Jobs.
2. Deploy the Worker backup change after the reviewed team-files archive: `cd docs/site/workers/feedback-store && npx wrangler deploy`.
3. Create the health-check secrets before `site-health.yml` reaches `main`: a dedicated licence activation, then `gh secret set QL_HEALTH_LICENCE_KEY`, `gh secret set QL_HEALTH_ACTIVATION_ID`, `gh secret set QL_HEALTH_FINGERPRINT` (fingerprint whose first 16 characters are the activation label), and `gh secret set QL_HEALTH_REDIS_URL`, `gh secret set QL_HEALTH_REDIS_READ_ONLY_TOKEN` from the production store's read-only token. After the trial cutover: `gh variable set QL_TRIAL_LEDGER_ACTIVE --body true`.

R2, after the retention gate above, in this order: remove the code (item 23), deploy; delete Redis families; delete team-files objects; Slack app and Resend domain/webhook; Vercel env vars; disconnect and delete the Neon store, then the staging branch and the preview project; staging Upstash store; preview deployment; backup workflow and its secrets. Read the usage baseline again one month later.
