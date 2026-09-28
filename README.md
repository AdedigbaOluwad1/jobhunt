# jobhunt

A personal CLI that pulls open job postings from a watchlist of companies'
ATS boards, filters out obvious mismatches for free, and (starting Phase 3)
uses an LLM to score how well each one fits you. Built for one person to run
on their own machine — not a product, no server, no multi-user support.

The tool never applies to anything on its own. It's a research and tracking
aid: `sync` finds and scores jobs, you decide what to do next.

## Status

| Phase | What it adds | Status |
|---|---|---|
| 0 | Project scaffold, `jobhunt init` | ✅ |
| 1 | Greenhouse adapter, sync/list/show/sources | ✅ |
| 2 | Lever + Ashby adapters, real filtering, closed-job detection | ✅ |
| 3 | LLM match scoring (`ExtractorService`) | 🚧 in progress |
| 4 | CV tailoring + PDF generation | not started |
| 5 | Apply flow + status tracking (`apply`, `status`, `stats`) | not started |
| 6 | Remote-board sources (Remotive, RemoteOK, We Work Remotely) | not started |
| 7 | Docs, scheduling examples, polish | not started |

## Requirements

- Node.js 20+ (developed against 22)
- npm
- An Anthropic API key — only needed once Phase 3 lands; every command below works without one

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
├─ master-cv.yaml  # your CV, used starting Phase 4
├─ .env            # put ANTHROPIC_API_KEY here
├─ jobhunt.db      # SQLite database
└─ out/            # generated PDFs land here later
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

`profile` and `llm` are used for match scoring once Phase 3 lands; you can
fill them in now (see `templates/config.example.yaml` for the full shape
with comments) or leave the defaults.

## Commands

### `jobhunt init`

Creates `$JOBHUNT_HOME`, copies the example config/master-cv (never
overwrites existing files), stubs `.env`, and runs database migrations.

### `jobhunt sync [--source <name>] [--dry-run]`

Fetches every configured source (bounded by `sync.httpConcurrency`),
normalizes and dedupes the results, filters them, and prints a summary:

```
Sync complete in 1.4s
Sources: 3 ok, 1 failed (lever:foo — board not found (404); check the slug in config.yaml)
Fetched 1120 jobs → 37 new, 12 changed, 21 closed, 3 duplicates
Filtered: 29 passed, 8 rejected (top reasons: title-no-match ×5, not-remote ×3)
```

- `--source greenhouse` or `--source greenhouse:stripe` limits the run to one source or one board.
- `--dry-run` fetches and diffs in memory without writing anything.
- Exit codes: `0` full success, `2` some sources failed (partial success), `1` fatal error (bad config, db error).

Safe to run as often as you like — a second run with nothing changed
reports `0 new, 0 changed`.

### `jobhunt list [--all] [--company <text>] [--remote] [--limit <n>] [--format table|json]`

Lists stored jobs. By default: non-closed, non-duplicate, filter-passed
jobs, newest first. `--all` also includes rejected/duplicate/closed jobs
and adds a `why` column explaining the filter reason.

### `jobhunt show <id> [--desc] [--json]`

Prints one job's details — company, title, location, URL, status, source.
`--desc` includes the full (stripped, plain-text) description.

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

All data stays on your machine, in `~/.jobhunt/jobhunt.db` (SQLite) and
`~/.jobhunt/config.yaml`. Nothing leaves except what's explicitly sent to
the Anthropic API once extraction/tailoring are wired up.

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
├─ jobs/       # normalize, dedupe, filter, and the sync pipeline
└─ commands/   # thin CLI commands — parse args, call a service, print
```
