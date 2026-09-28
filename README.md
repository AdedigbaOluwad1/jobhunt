# jobhunt

A personal CLI that pulls open job postings from a watchlist of companies'
ATS boards, filters out obvious mismatches for free, and uses an LLM to
score how well each one fits you. Built for one person to run on their own
machine — not a product, no server, no multi-user support.

The tool never applies to anything on its own. It's a research and tracking
aid: `sync` finds and scores jobs, you decide what to do next.

## Requirements

- Node.js 20+ (developed against 22)
- npm
- An Anthropic API key — needed for `sync`'s extraction step and for `jobhunt tailor`; every other command works without one, and `sync` itself just skips extraction with a clear message if the key isn't set
- Chromium, for `jobhunt tailor`'s PDF output: `npx playwright install chromium` (the command tells you to run this if it's missing)

## Install

```sh
git clone https://github.com/AdedigbaOluwad1/jobhunt
cd jobhunt
npm install
npm run build
npm link
jobhunt init
```

`jobhunt init` is idempotent — safe to run again later. It creates
`~/.jobhunt/` (override the location with the `JOBHUNT_HOME` env var) with:

```
~/.jobhunt/
├─ config.yaml     # watchlist, filters, profile, settings
├─ master-cv.yaml  # your CV — fill this in with real experience before tailoring
├─ .env            # put ANTHROPIC_API_KEY here
├─ jobhunt.db      # SQLite database
└─ out/            # tailored CV PDFs + JSON land here
```

> The binary is named `jobhunt`, not `jobs` — `jobs` is a shell builtin
> (job control) in bash/zsh and would silently shadow it.

## Configure

Edit `~/.jobhunt/config.yaml`. The important bits for now:

```yaml
sources:
  greenhouse: [stripe, figma]   # Greenhouse board tokens
  lever: [veeva]                # Lever company slugs
  lever_eu: [somecompany]       # Lever accounts hosted on api.eu.lever.co
  ashby: [linear]               # Ashby job board names
  remote:
    remotive: { enabled: true, categories: [software-dev], minIntervalHours: 12 }
    remoteok: { enabled: true, minIntervalHours: 12 }
    wwr:      { enabled: true, feeds: [remote-programming-jobs], minIntervalHours: 12 }

filters:
  titleInclude: [engineer, developer, backend, full stack]
  titleExclude: [intern, principal, director, manager, recruiter]
  remoteOnly: true
  locationsAllow: [remote, worldwide, emea, africa]  # only checked for non-remote jobs
  descriptionExclude: ["security clearance", "us work authorization"]
  maxAgeDays: 30
```

`profile` (your summary, years of experience, target titles, must-have
skills, dealbreakers) and `llm` (which models to use, description length
cap, concurrency) drive the match-scoring step — see
`templates/config.example.yaml` for the full shape with comments.

Then fill in `~/.jobhunt/master-cv.yaml` with your real experience —
`templates/master-cv.example.yaml` has the full shape with comments. Every
experience/project/education entry and every bullet needs a stable,
unique `id`; tailoring references bullets by id, and ids should never
change once you've used them. `cv.maxBulletsPerRole` and `cv.maxPages` in
config.yaml control how aggressively tailoring trims content to fit.

### Configuration reference

Every key in `config.yaml` is validated at startup (`.strict()` — an unknown
key is an error, not a silent typo). The full field list:

| Key | Type | Default | Purpose |
|---|---|---|---|
| `profile.summary` | string | — | Short self-description sent to the LLM for match scoring only (never the full CV). |
| `profile.yearsExperience` | number | — | Used in the seniority/years-fit part of the match score. |
| `profile.targetTitles` | string[] | — | Informational context for the LLM; not a hard filter. |
| `profile.mustHaveSkills` | string[] | — | Informational context for the LLM; not a hard filter. |
| `profile.dealbreakers` | string[] | — | Phrases the LLM treats as an automatic score penalty. |
| `sources.greenhouse` | string[] | `[]` | Greenhouse board tokens (`boards-api.greenhouse.io/v1/boards/<token>`). |
| `sources.lever` | string[] | `[]` | Lever company slugs (`api.lever.co`). |
| `sources.lever_eu` | string[] | `[]` | Lever slugs hosted on `api.eu.lever.co` instead. |
| `sources.ashby` | string[] | `[]` | Ashby job board names (`api.ashbyhq.com`). |
| `sources.companyNames` | map<string,string> | — | Optional slug → display-name override, e.g. `{ figma: "Figma, Inc." }`. |
| `sources.remote.remotive.enabled` | boolean | — | Turn the Remotive adapter on/off. |
| `sources.remote.remotive.categories` | string[] | `[software-dev]` | Remotive category filter (one sync target per category). |
| `sources.remote.remotive.minIntervalHours` | number | `12` | Minimum hours between real fetches of this source; a sooner `sync` skips it. |
| `sources.remote.remoteok.enabled` | boolean | — | Turn the RemoteOK adapter on/off. |
| `sources.remote.remoteok.minIntervalHours` | number | `12` | Same throttle, for RemoteOK. |
| `sources.remote.wwr.enabled` | boolean | — | Turn the We Work Remotely adapter on/off. |
| `sources.remote.wwr.feeds` | string[] | `[remote-programming-jobs]` | WWR RSS category feed names (one sync target per feed). |
| `sources.remote.wwr.minIntervalHours` | number | `12` | Same throttle, for WWR. |
| `filters.titleInclude` | string[] | — | Word-boundary match; title must match at least one (skipped if empty). |
| `filters.titleExclude` | string[] | — | Word-boundary match; any match rejects the job. Checked before `titleInclude`. |
| `filters.remoteOnly` | boolean | — | Reject any job not detected as remote. |
| `filters.locationsAllow` | string[] | — | Substring allowlist for a **non-remote** job's location text (see "How it works" below). |
| `filters.descriptionExclude` | string[] | — | Lowercased substring match anywhere in the description; any match rejects the job. |
| `filters.maxAgeDays` | number | — | Reject a job older than this if `postedAt` is known (unknown `postedAt` always passes). |
| `llm.extractionModel` | string | — | Model used for the cheap, high-volume scoring step. |
| `llm.tailorModel` | string | — | Model used for the more expensive CV-tailoring step. |
| `llm.maxDescriptionChars` | number | — | Description text is truncated to this length before being sent to the LLM. |
| `llm.extractionConcurrency` | number | — | Max concurrent extraction calls per `sync`. |
| `sync.httpConcurrency` | number | — | Max concurrent HTTP fetches across all sources per `sync`. |
| `sync.httpTimeoutMs` | number | — | Per-request timeout for source fetches. |
| `sync.httpRetries` | number | — | Retries on network error/429/5xx, with backoff; other 4xx never retry. |
| `sync.maxExtractPerRun` | number | — | Default cap on (re-)extractions per `sync` (override with `--max-extract`). |
| `sync.minScoreToHighlight` | number | — | Newly-inserted jobs scoring at or above this show in sync's "New matches ≥ N" list. |
| `cv.maxPages` | number | — | `jobhunt tailor` drops the least-relevant bullet and re-renders until the PDF fits this many pages. |
| `cv.maxBulletsPerRole` | number | — | Upper bound the tailoring prompt is told to respect per role/project. |
| `cv.paper` | `A4` \| `Letter` | — | PDF page size. |

## Commands

### `jobhunt init`

Creates `$JOBHUNT_HOME`, copies the example config/master-cv (never
overwrites existing files), stubs `.env`, and runs database migrations.

### `jobhunt sync [--source <name>] [--dry-run] [--no-extract] [--max-extract <n>]`

Fetches every configured source (bounded by `sync.httpConcurrency`),
normalizes and dedupes the results, filters them, extracts/scores the
survivors with an LLM, and prints a summary:

```
Sync complete in 1.4s
Sources: 3 ok, 1 failed (lever:foo — board not found (404); check the slug in config.yaml), 1 skipped (remotive:software-dev — fetched 3h ago)
Fetched 1120 jobs → 37 new, 12 changed, 21 closed, 3 duplicates
Filtered: 29 passed, 8 rejected (top reasons: title-no-match ×5, not-remote ×3)
Extracted 27 (2 failed)

New matches ≥ 70:
id    score  company  title                                   location
#412  92     Acme     Senior Backend Engineer (TypeScript)     remote
#415  81     Globex   Full Stack Engineer                      EMEA
```

- `--source greenhouse` or `--source greenhouse:stripe` limits the run to one source or one board.
- `--dry-run` fetches and diffs in memory without writing anything (skips extraction too).
- `--no-extract` skips the LLM scoring step for this run.
- `--max-extract <n>` caps how many jobs get (re-)extracted this run (default `sync.maxExtractPerRun` in config.yaml).
- Newly-inserted jobs scoring at or above `sync.minScoreToHighlight` get called out in a "New matches" list at the end — a quick signal for what's worth a look before you even run `list`.
- The remote-board sources (Remotive, RemoteOK, WWR) are throttled by their own `minIntervalHours` — a sync within that window skips them and says so, rather than re-fetching.
- If `ANTHROPIC_API_KEY` isn't set, extraction is skipped with one clear line (`Extraction skipped: ANTHROPIC_API_KEY not set (N job(s) waiting)`) — the rest of the sync still runs and succeeds.
- Exit codes: `0` full success, `2` some sources failed (partial success), `1` fatal error (bad config, db error).

Safe to run as often as you like — a second run with nothing changed
reports `0 new, 0 changed`, and extraction makes zero LLM calls for jobs
that haven't changed since they were last scored.

### `jobhunt list [--all] [--company <text>] [--remote] [--min-score <n>] [--limit <n>] [--format table|json|md]`

Lists stored jobs, sorted by match score (highest first, unscored last),
then by newest. By default: non-closed, non-duplicate, filter-passed jobs.
`--all` also includes rejected/duplicate/closed jobs and adds a `why`
column explaining the filter reason. `--min-score` only shows jobs scored
at or above that threshold. `--format md` prints a markdown table with the
title linked to the posting — pipe it straight to a file: `jobhunt list
--format md > digest.md`.

### `jobhunt show <id> [--desc] [--json]`

Prints one job's details — company, title, location, URL, status, source
— plus its LLM analysis if one exists: match score, role summary,
requirements, nice-to-haves, stack, seniority, remote policy, match
reasons, gaps, and red flags. `--desc` includes the full (stripped,
plain-text) description.

### `jobhunt tailor <id> [--regen] [--open]`

Generates a tailored CV PDF for one job: runs extraction on demand if the
job doesn't have one yet, has an LLM select/reorder/lightly reword bullets
from your master CV to fit the role (never inventing facts — enforced in
code, not just prompted), and renders it to `~/.jobhunt/out/`.

```
Tailored CV: /Users/you/.jobhunt/out/acme-backend-engineer-42.pdf (1 page)
  warning: bullet "exp-acme-2" mentions "Kubernetes", which appears in neither the original bullet nor the master vocabulary
```

- Without `--regen`, re-running it for the same job just prints the existing PDF's path — no LLM calls.
- `--regen` tailors again from scratch.
- `--open` opens the PDF after generating it.
- Any warning printed means the model tried to add something not in your master CV, and that specific bullet/skill/summary was reverted to your original wording instead — the output PDF is always guaranteed faithful to your master CV, even when the model isn't.
- Basics (name/contact), education, dates, job titles, and company names always come from `master-cv.yaml` verbatim — the model never writes those.

### `jobhunt apply <id> [--mark]`

Opens the job's apply URL in your default browser and prints the tailored
CV's path so you can drag it into the application form.

- If there's no tailored CV yet: in an interactive shell, offers to run `jobhunt tailor <id>` on the spot; in a script/pipe (non-interactive), fails with a message telling you to run it yourself first — it never hangs waiting on a prompt that can't come.
- `--mark` sets status to `applied` and records `appliedAt` without asking. Without it, you're asked `Mark as applied? [y/N]` when stdin is a TTY; non-interactively, nothing is marked unless you pass `--mark`.

### `jobhunt status <id> <state> [--note <text>]`

Sets a job's status — one of `new`, `shortlisted`, `applied`, `interview`,
`offer`, `rejected`, `dismissed`, `withdrawn`. Transitions aren't
restricted (you can correct a mistake by moving to any state); only the
value itself is validated. Setting `applied` also records `appliedAt` on
the job's tailored-CV record if it isn't set yet — the same thing
`apply --mark` does, so it doesn't matter which command you used to apply.
`--note` attaches free text to the change; a later status change without
`--note` leaves the existing note alone.

### `jobhunt dismiss <id...>`

Shortcut for `jobhunt status <id> dismissed` across one or more ids at once.

### `jobhunt stats`

Counts by status, jobs seen per week, applications per week, the average
match score across jobs you've applied to, and which source has produced
the most well-matched (filter-passed and scored) jobs.

### `jobhunt sources list | add <source:board> | remove <source:board> | check`

- `list` — configured targets with their last sync result (ok/error, job count, last fetched).
- `add greenhouse:stripe` — verifies the board actually exists with a live request, then adds it to `config.yaml` (preserving your comments and formatting).
- `remove greenhouse:stripe` — drops it from `config.yaml`; jobs already stored are kept, just no longer refreshed.
- `check` — fetches every configured target once and reports ok/fail; writes nothing to the database.

## How it works

1. **Sources**: `greenhouse`, `lever`, and `ashby` pull raw postings straight from each ATS's public, unauthenticated job-board API. `remotive`, `remoteok`, and `wwr` (We Work Remotely, via RSS) are remote-job aggregators, each throttled by its own `minIntervalHours` to respect that site's terms — their listings always link back to the aggregator's own page, never the underlying employer, per each site's linkback requirements.
2. **Normalize** strips and decodes HTML descriptions, detects remote status, and computes a content hash plus a cross-source dedupe key.
3. **Upsert** by `(source, board, externalId)`: new jobs are inserted, unchanged jobs just bump `lastSeenAt`, changed jobs update in place and get re-filtered.
4. **Dedupe**: if the same posting shows up under two sources — say, an aggregator and the company's own Greenhouse board — the earlier one wins the dedupe key, except an ATS listing always wins over a remote-board aggregator's copy of the same posting, whichever was fetched first.
5. **Filter**, cheaply, before anything costs money: `maxAgeDays` → `titleExclude` → `titleInclude` → `remoteOnly`/`locationsAllow` → `descriptionExclude`. First failing rule wins and its reason is what `list --all` shows. Every non-closed job is re-checked against the *current* config on each sync, so editing `config.yaml` reclassifies old jobs without a refetch.
6. **Closed detection**: after a target's fetch *succeeds*, any previously-seen job missing from that response is marked closed. A failed fetch never closes anything — a broken board must never be read as "these jobs are gone."
7. **Extract & score**: every filter-passed, non-duplicate, non-closed job gets sent to an LLM (job text + your `profile` block — never the full CV) which returns structured requirements and a 0–100 match score via a forced tool call, validated against a strict schema. Results are cached by `(contentHash, promptVersion)`, so unchanged jobs cost nothing on repeat syncs; bumping the prompt version re-extracts everything. Invalid output gets one retry with the validation error appended, then the job is skipped for that run rather than crashing it.
8. **Tailor**: on request (`jobhunt tailor <id>`), an LLM selects, reorders, and lightly rewords bullets from your master CV — the full master CV (minus contact details) plus the job's extracted requirements go into the prompt this time. A code-level validator then checks every bullet/skill/summary for fabricated numbers, technologies, or ids; anything that still fails after one retry reverts to your original master-CV wording rather than being trusted. The result renders to a single-column PDF via headless Chromium, trimming the least-relevant bullets if it runs over `cv.maxPages`.
9. **Apply & track**: `jobhunt apply` opens the posting and hands you the CV path; `jobhunt status`/`dismiss` record where things stand. None of this submits anything on your behalf — you're always the one clicking submit.

The full loop: `jobhunt sync` → `jobhunt list` → `jobhunt show <id>` → `jobhunt tailor <id>` → `jobhunt apply <id> --mark` → `jobhunt status <id> interview` (or `offer`, `rejected`, ...).

All data stays on your machine, in `~/.jobhunt/jobhunt.db` (SQLite),
`~/.jobhunt/config.yaml`, and `~/.jobhunt/out/`. What's sent to the
Anthropic API: job text + your profile summary for scoring, and job text +
your full master CV (minus `basics`/contact details, re-attached locally
at render time) for tailoring. Nothing else leaves your machine.

## Scheduling

jobhunt has no built-in scheduler — run `jobhunt sync` on whatever schedule
you like via cron or launchd. It's always safe to run more often than
necessary: remote-board sources self-throttle via `minIntervalHours`, and
every upsert is idempotent. See [`docs/SCHEDULING.md`](docs/SCHEDULING.md)
for cron and launchd examples, including a gotcha specific to nvm/fnm/volta
users (scheduled jobs don't load your shell profile, so `node`/`jobhunt`
may not resolve the way they do in your terminal).

## Development

```sh
npm run build    # prisma generate + nest build
npm test         # jest — fixture-based, no live network
npm run test:live  # opt-in: one real request per adapter, to catch upstream API drift
npm run lint     # tsc --noEmit
```

Adapter tests run against real API responses saved under `test/fixtures/`,
captured once and committed rather than hitting the network on every test
run. `test:live` is the exception — it's excluded from the default `npm
test` run and exists specifically to catch a source's API/feed shape
changing since those fixtures were captured.

## Project layout

```
src/
├─ common/     # http, text/HTML, hashing, concurrency limiter, errors
├─ config/     # config.yaml loading/validation (zod) + comment-preserving edits
├─ db/         # Prisma client + the one repository everything else uses
├─ sources/    # one adapter per ATS, behind a shared JobSource interface
├─ jobs/       # normalize, dedupe, filter, extraction, and the sync pipeline
├─ llm/        # the only module that imports the Anthropic SDK
├─ cv/         # master CV schema, tailoring, anti-fabrication validator, PDF rendering
└─ commands/   # thin CLI commands — parse args, call a service, print
```

## Roadmap

Ideas beyond what's built today, roughly in likely order:

1. **Multi-provider LLM support.** Right now `llm/llm.service.ts` is a thin wrapper around the Anthropic SDK specifically — model IDs in `config.yaml` (`llm.extractionModel`, `llm.tailorModel`) are Claude-specific, and `LlmService.callStructured()` is built around Anthropic's tool-use API shape. Making this provider-agnostic (OpenAI, Gemini, local models via Ollama, etc.) means introducing a provider-neutral interface for "structured output from a prompt + schema" and an adapter per provider, similar in spirit to how `JobSource` abstracts ATS/aggregator differences today. Not started — flagging it here as the next thing worth designing before building.
2. Additional ATS adapters (Workable, SmartRecruiters) via the existing `JobSource` interface.
3. Regional job-board adapters (would need HTML scraping, out of scope for the sources built so far).
4. Assisted form pre-fill for `apply` (Playwright-driven, always human-submitted — never full auto-apply).
5. Cover-letter generation using a job's `requirementMap`.
6. Daily digest delivery (email/Slack) built on the existing `list --format md`.
7. Saved searches / multiple profiles (e.g. a "backend" profile and a "full-stack" profile scored separately against the same job pool).

None of these are started — this list exists so a future scoped piece of work has somewhere to start from, not as a commitment.
