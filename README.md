# jobhunt

A personal CLI that pulls open job postings from a watchlist of companies'
ATS boards, filters out obvious mismatches for free, and uses an LLM to
score how well each one fits you. Built for one person to run on their own
machine — not a product, no server, no multi-user support.

The tool never applies to anything on its own. It's a research and tracking
aid: `sync` finds and scores jobs, you decide what to do next.

## Status

| Phase | What it adds | Status |
|---|---|---|
| 0 | Project scaffold, `jobhunt init` | ✅ |
| 1 | Greenhouse adapter, sync/list/show/sources | ✅ |
| 2 | Lever + Ashby adapters, real filtering, closed-job detection | ✅ |
| 3 | LLM match scoring (`ExtractorService`), cached by content hash | ✅ |
| 4 | CV tailoring + PDF generation (`jobhunt tailor`) | ✅ |
| 5 | Apply flow + status tracking (`apply`, `status`, `stats`) | not started |
| 6 | Remote-board sources (Remotive, RemoteOK, We Work Remotely) | not started |
| 7 | Docs, scheduling examples, polish | not started |

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
Sources: 3 ok, 1 failed (lever:foo — board not found (404); check the slug in config.yaml)
Fetched 1120 jobs → 37 new, 12 changed, 21 closed, 3 duplicates
Filtered: 29 passed, 8 rejected (top reasons: title-no-match ×5, not-remote ×3)
Extracted 27 (2 failed)
```

- `--source greenhouse` or `--source greenhouse:stripe` limits the run to one source or one board.
- `--dry-run` fetches and diffs in memory without writing anything (skips extraction too).
- `--no-extract` skips the LLM scoring step for this run.
- `--max-extract <n>` caps how many jobs get (re-)extracted this run (default `sync.maxExtractPerRun` in config.yaml).
- If `ANTHROPIC_API_KEY` isn't set, extraction is skipped with one clear line (`Extraction skipped: ANTHROPIC_API_KEY not set (N job(s) waiting)`) — the rest of the sync still runs and succeeds.
- Exit codes: `0` full success, `2` some sources failed (partial success), `1` fatal error (bad config, db error).

Safe to run as often as you like — a second run with nothing changed
reports `0 new, 0 changed`, and extraction makes zero LLM calls for jobs
that haven't changed since they were last scored.

### `jobhunt list [--all] [--company <text>] [--remote] [--min-score <n>] [--limit <n>] [--format table|json]`

Lists stored jobs, sorted by match score (highest first, unscored last),
then by newest. By default: non-closed, non-duplicate, filter-passed jobs.
`--all` also includes rejected/duplicate/closed jobs and adds a `why`
column explaining the filter reason. `--min-score` only shows jobs scored
at or above that threshold.

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

### `jobhunt sources list | add <source:board> | remove <source:board> | check`

- `list` — configured targets with their last sync result (ok/error, job count, last fetched).
- `add greenhouse:stripe` — verifies the board actually exists with a live request, then adds it to `config.yaml` (preserving your comments and formatting).
- `remove greenhouse:stripe` — drops it from `config.yaml`; jobs already stored are kept, just no longer refreshed.
- `check` — fetches every configured target once and reports ok/fail; writes nothing to the database.

## How it works

1. **Sources** (`greenhouse`, `lever`, `ashby` today) pull raw postings straight from each ATS's public, unauthenticated job-board API.
2. **Normalize** strips and decodes HTML descriptions, detects remote status, and computes a content hash plus a cross-source dedupe key.
3. **Upsert** by `(source, board, externalId)`: new jobs are inserted, unchanged jobs just bump `lastSeenAt`, changed jobs update in place and get re-filtered.
4. **Dedupe**: if the same posting shows up under two sources, the earlier one wins the dedupe key — and once remote-board aggregators exist (Phase 6), an ATS listing always wins over one from an aggregator.
5. **Filter**, cheaply, before anything costs money: `maxAgeDays` → `titleExclude` → `titleInclude` → `remoteOnly`/`locationsAllow` → `descriptionExclude`. First failing rule wins and its reason is what `list --all` shows. Every non-closed job is re-checked against the *current* config on each sync, so editing `config.yaml` reclassifies old jobs without a refetch.
6. **Closed detection**: after a target's fetch *succeeds*, any previously-seen job missing from that response is marked closed. A failed fetch never closes anything — a broken board must never be read as "these jobs are gone."
7. **Extract & score**: every filter-passed, non-duplicate, non-closed job gets sent to an LLM (job text + your `profile` block — never the full CV) which returns structured requirements and a 0–100 match score via a forced tool call, validated against a strict schema. Results are cached by `(contentHash, promptVersion)`, so unchanged jobs cost nothing on repeat syncs; bumping the prompt version re-extracts everything. Invalid output gets one retry with the validation error appended, then the job is skipped for that run rather than crashing it.
8. **Tailor**: on request (`jobhunt tailor <id>`), an LLM selects, reorders, and lightly rewords bullets from your master CV — the full master CV (minus contact details) plus the job's extracted requirements go into the prompt this time. A code-level validator then checks every bullet/skill/summary for fabricated numbers, technologies, or ids; anything that still fails after one retry reverts to your original master-CV wording rather than being trusted. The result renders to a single-column PDF via headless Chromium, trimming the least-relevant bullets if it runs over `cv.maxPages`.

All data stays on your machine, in `~/.jobhunt/jobhunt.db` (SQLite),
`~/.jobhunt/config.yaml`, and `~/.jobhunt/out/`. What's sent to the
Anthropic API: job text + your profile summary for scoring, and job text +
your full master CV (minus `basics`/contact details, re-attached locally
at render time) for tailoring. Nothing else leaves your machine.

## Development

```sh
npm run build   # prisma generate + nest build
npm test        # jest — fixture-based, no live network
npm run lint    # tsc --noEmit
```

Adapter tests run against real API responses saved under `test/fixtures/`,
captured once and committed rather than hitting the network on every test
run.

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
