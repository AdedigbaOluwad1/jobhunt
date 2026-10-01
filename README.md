# jobhunt

A command-line tool that syncs open job postings from a configurable
watchlist of ATS boards and remote-job aggregators, filters out obvious
mismatches, scores the rest against your profile with an LLM, and generates
a tailored, fact-checked CV for the ones worth applying to.

Single-user by design: no server, no hosted deployment, no shared state.
Everything — job data, your CV, generated PDFs — lives in one local SQLite
database and a couple of YAML files. Applications are never submitted
automatically; the tool prepares everything and hands control back to you.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
  - [LLM providers](#llm-providers)
  - [Configuration reference](#configuration-reference)
- [Commands](#commands)
- [Architecture](#architecture)
- [Scheduling](#scheduling)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Roadmap](#roadmap)
- [License](#license)

## Features

- **Multi-source aggregation** — Greenhouse, Lever, Ashby, Workable, Recruitee,
  BambooHR, Teamtailor, Breezy, SmartRecruiters, and JazzHR boards, plus
  Remotive, RemoteOK, and We Work Remotely, unified behind one adapter
  interface.
- **Deterministic filtering** — title/location/age/description rules run
  before any LLM call, so cost scales with what actually matters.
- **Cross-source deduplication** — the same posting found on an ATS board
  and a remote-job aggregator resolves to one record, with the ATS listing
  as the source of truth.
- **LLM-scored matches** — structured extraction and a 0–100 match score
  per posting, cached by content hash so nothing is re-scored unless it
  changed.
- **Fact-checked CV tailoring** — an LLM selects and lightly rewords bullets
  from your master CV; a deterministic validator rejects anything it can't
  verify against the source material, with no manual review required to
  catch fabrication.
- **Full status tracking** — from first seen through applied, interview,
  offer, or rejected, with weekly stats.
- **Local-first** — one SQLite database, no external services beyond the
  LLM calls you explicitly opt into.
- **Multi-provider LLM support** — Anthropic, OpenAI, Cloudflare Workers AI,
  or an open-weight model running locally (Ollama's native API, or any
  OpenAI-compatible server — LM Studio, vLLM, llama.cpp server), mixed
  freely between extraction and tailoring.

## Requirements

| | |
|---|---|
| Node.js | 20 or later |
| npm | any recent version |
| An LLM | required for match scoring and CV tailoring only — a hosted API key (Anthropic, OpenAI, Cloudflare Workers AI) or a local model server (e.g. Ollama) |
| Chromium | required for CV tailoring only (`npx playwright install chromium`) |

Every command other than `sync`'s extraction step and `tailor` works with
no LLM configured. Using a local model needs no API key at all — see
[LLM providers](#llm-providers).

## Installation

```sh
git clone https://github.com/AdedigbaOluwad1/jobhunt
cd jobhunt
npm install
npm run build
npm link
jobhunt init
```

`jobhunt init` is idempotent and creates `~/.jobhunt/` (override with the
`JOBHUNT_HOME` environment variable):

```
~/.jobhunt/
├── config.yaml      Source watchlist, filters, profile, and runtime settings
├── master-cv.yaml   Your CV — the single source of truth for tailoring
├── .env             ANTHROPIC_API_KEY / OPENAI_API_KEY / CLOUDFLARE_API_TOKEN (only for providers you use)
├── jobhunt.db       SQLite database
└── out/             Generated CV PDFs and their JSON source
```

> **Note:** the binary is named `jobhunt`, not `jobs` — `jobs` is a shell
> builtin in bash/zsh (job control) and would shadow it silently.

## Configuration

`jobhunt init` copies two annotated templates into `$JOBHUNT_HOME` —
[`templates/config.example.yaml`](templates/config.example.yaml) and
[`templates/master-cv.example.yaml`](templates/master-cv.example.yaml) —
with placeholder values marked for replacement. The two worked examples
below show what a complete, functioning setup looks like once filled in,
for a fictional backend engineer named Jordan Ellis.

### Example: `config.yaml`

```yaml
profile:
  # Used only for match scoring — never sent in full, and never used for tailoring.
  summary: >
    Backend engineer with 7 years of experience building distributed systems
    in TypeScript and Go. Strong with queue-based architectures, PostgreSQL,
    and infrastructure reliability.
  yearsExperience: 7
  targetTitles: [backend engineer, senior backend engineer, infrastructure engineer]
  mustHaveSkills: [typescript, postgresql]
  dealbreakers: ["security clearance", "on-site only"]

sources:
  greenhouse: [stripe, figma]        # board tokens — see `jobhunt sources add` to find more
  lever: [veeva]                     # company slugs
  ashby: [linear, ramp]              # job board names
  workable: []                       # apply.workable.com/<slug>
  recruitee: []                      # <slug>.recruitee.com
  bamboohr: []                       # <slug>.bamboohr.com
  teamtailor: []                     # careers-site host, e.g. careers.example.com
  breezy: []                         # <slug>.breezy.hr
  smartrecruiters: []                # jobs.smartrecruiters.com/<Identifier>
  jazzhr: []                         # <slug>.applytojob.com
  remote:
    remotive: { enabled: true, categories: [software-dev], minIntervalHours: 12 }
    remoteok: { enabled: true, minIntervalHours: 12 }
    wwr:      { enabled: true, feeds: [remote-programming-jobs], minIntervalHours: 12 }

filters:
  titleInclude: [backend, infrastructure, platform, distributed systems]
  titleExclude: [intern, principal, director, manager, frontend, mobile]
  remoteOnly: true
  locationsAllow: [remote, worldwide, us, emea]
  descriptionExclude: ["security clearance", "us citizenship required"]
  maxAgeDays: 21

llm:
  extractionModel: anthropic/claude-haiku-4-5-20251001   # verify current model IDs in Anthropic docs
  tailorModel: anthropic/claude-sonnet-5
  maxDescriptionChars: 12000
  extractionConcurrency: 3

sync:
  httpConcurrency: 5
  httpTimeoutMs: 15000
  httpRetries: 2
  maxExtractPerRun: 50
  minScoreToHighlight: 75

cv:
  maxPages: 1
  maxBulletsPerRole: 4
  paper: A4
```

Every source slug above (`stripe`, `figma`, `veeva`, `linear`, `ramp`) is a
real, currently active board — this file works as-is if you drop it in and
run `jobhunt sync`. See [Configuration reference](#configuration-reference)
below for every field.

### LLM providers

`llm.extractionModel` and `llm.tailorModel` are each `"<provider>/<model>"`,
and the two fields can point at different providers — for example a local
model for high-volume extraction and a hosted one for tailoring:

| Provider | Example model value | Credentials |
|---|---|---|
| `anthropic` | `anthropic/claude-haiku-4-5-20251001` | `ANTHROPIC_API_KEY` in `.env` or the environment |
| `openai` | `openai/gpt-4o-mini` | `OPENAI_API_KEY` in `.env` or the environment |
| `ollama` | `ollama/qwen3.6:latest` | none required |
| `local` | `local/llama3.1` | none required |
| `cloudflare` | `cloudflare/@cf/meta/llama-3.3-70b-instruct-fp8-fast` | `CLOUDFLARE_API_TOKEN` in `.env` or the environment, plus `accountId` in config |

**`ollama`** talks to [Ollama](https://ollama.com)'s native `/api/chat`
directly (not its OpenAI-compatible endpoint) and defaults to Ollama's
default address, `http://localhost:11434`. Use this one for anything served
through Ollama — including thinking-capable models. Only the native API can
turn thinking off, via `think: false` (the default here); the
OpenAI-compatible endpoint silently ignores that setting and burns
substantially more tokens per call on hidden reasoning it never asked to
see. Override the address, or opt back into thinking, with:

```yaml
llm:
  providers:
    ollama: { baseUrl: http://localhost:11434, think: false }
```

**`local`** is the fallback for any OTHER OpenAI-compatible local server —
LM Studio, vLLM, llama.cpp server — that Ollama's native API doesn't cover.
It defaults to Ollama's OpenAI-compatible address
(`http://localhost:11434/v1`) as a reasonable starting point, but for Ollama
itself prefer `ollama` above. Point it elsewhere with:

```yaml
llm:
  providers:
    local: { baseUrl: http://localhost:1234/v1 }
```

`llm.providers.openai.baseUrl` works the same way, for routing OpenAI-shaped
calls through a proxy. Structured output (match scoring, CV tailoring) is
implemented with tool/function calling, so a local model needs reasonably
capable tool-calling support (e.g. Llama 3.1+, Qwen2.5+) — smaller or
older models may fail to produce a valid tool call.

**`cloudflare`** targets [Workers AI](https://developers.cloudflare.com/workers-ai/)
through its OpenAI-compatible endpoint. Pick a model that supports function
calling, since every call forces a single tool call. Set your account ID in
config and the API token (with Workers AI permission) in `.env`:

```yaml
llm:
  providers:
    cloudflare: { accountId: <your-account-id> }
```

`baseUrl` overrides the derived URL, for example to route through AI Gateway.

### Example: `master-cv.yaml`

Every experience, project, education, and bullet entry needs a stable,
unique `id` — tailoring references bullets by id, and ids must not change
once you've synced or tailored against them.

```yaml
basics:
  name: Jordan Ellis
  email: jordan.ellis@example.com
  phone: "+1 555-0142"
  location: Austin, TX
  links:
    - { label: GitHub, url: https://github.com/jordanellis }
    - { label: LinkedIn, url: https://linkedin.com/in/jordanellis }

summary: >
  Backend engineer with 7 years of experience designing and scaling
  distributed systems. Focused on queue-based architectures, developer
  tooling, and infrastructure reliability.

skills:
  - group: Languages
    items: [TypeScript, Go, SQL]
  - group: Backend
    items: [Node.js, NestJS, Prisma, BullMQ, PostgreSQL, Redis]
  - group: Infrastructure
    items: [AWS, Docker, Terraform, GitHub Actions]

experience:
  - id: exp-northwind
    company: Northwind Labs
    title: Senior Backend Engineer
    location: Remote
    start: "2021-06"
    end: null                 # null = present
    bullets:
      - id: exp-northwind-1
        text: Redesigned the event ingestion pipeline with BullMQ and Redis, cutting p95 processing latency from 4.2s to 380ms.
        tags: [bullmq, redis, backend]
      - id: exp-northwind-2
        text: Migrated a monolithic billing service to a NestJS microservice, reducing billing-related incidents by 60% over two quarters.
        tags: [nestjs, migration]
      - id: exp-northwind-3
        text: Introduced Terraform-managed staging/production parity, eliminating environment-drift bugs.
        tags: [terraform, infrastructure]

  - id: exp-vertex
    company: Vertex Analytics
    title: Backend Engineer
    location: Austin, TX
    start: "2018-08"
    end: "2021-05"
    bullets:
      - id: exp-vertex-1
        text: Built a multi-tenant reporting API in Node.js and PostgreSQL serving 200+ enterprise customers.
        tags: [nodejs, postgresql]
      - id: exp-vertex-2
        text: Implemented row-level security and query-plan optimizations that cut average dashboard load time by 45%.
        tags: [postgresql, performance]

projects:
  - id: proj-queuelens
    name: QueueLens
    url: https://github.com/jordanellis/queuelens
    bullets:
      - id: proj-queuelens-1
        text: Built an open-source BullMQ monitoring dashboard with real-time job-failure alerting.
        tags: [bullmq, opensource]

education:
  - id: edu-utexas
    institution: University of Texas at Austin
    degree: B.S. Computer Science
    start: "2014"
    end: "2018"
```

### Configuration reference

Every key is validated at startup with a strict schema — an unrecognized
key is a startup error, not a silent no-op.

| Key | Type | Default | Description |
|---|---|---|---|
| `profile.summary` | string | — | Sent to the LLM for match scoring only, never for tailoring. |
| `profile.yearsExperience` | number | — | Used in the seniority/experience-fit component of the match score. |
| `profile.targetTitles` | string[] | — | Context for the LLM; not a hard filter. |
| `profile.mustHaveSkills` | string[] | — | Context for the LLM; not a hard filter. |
| `profile.dealbreakers` | string[] | — | Phrases that incur an automatic score penalty. |
| `sources.greenhouse` | string[] | `[]` | Greenhouse board tokens. |
| `sources.lever` | string[] | `[]` | Lever company slugs. |
| `sources.lever_eu` | string[] | `[]` | Lever slugs hosted on `api.eu.lever.co`. |
| `sources.ashby` | string[] | `[]` | Ashby job board names. |
| `sources.workable` | string[] | `[]` | Workable account slugs (`apply.workable.com/<slug>`). |
| `sources.recruitee` | string[] | `[]` | Recruitee subdomains (`<slug>.recruitee.com`). |
| `sources.bamboohr` | string[] | `[]` | BambooHR subdomains (`<slug>.bamboohr.com`). |
| `sources.teamtailor` | string[] | `[]` | Teamtailor careers-site hosts, e.g. `careers.example.com`. |
| `sources.breezy` | string[] | `[]` | Breezy subdomains (`<slug>.breezy.hr`). |
| `sources.smartrecruiters` | string[] | `[]` | SmartRecruiters company identifiers. |
| `sources.jazzhr` | string[] | `[]` | JazzHR subdomains (`<slug>.applytojob.com`). |
| `sources.companyNames` | map&lt;string,string&gt; | — | Optional slug → display-name override. |
| `sources.remote.remotive.enabled` | boolean | — | Enables the Remotive adapter. |
| `sources.remote.remotive.categories` | string[] | `[software-dev]` | One sync target per category. |
| `sources.remote.remotive.minIntervalHours` | number | `12` | Minimum interval between fetches of this source. |
| `sources.remote.remoteok.enabled` | boolean | — | Enables the RemoteOK adapter. |
| `sources.remote.remoteok.minIntervalHours` | number | `12` | Minimum fetch interval. |
| `sources.remote.wwr.enabled` | boolean | — | Enables the We Work Remotely adapter. |
| `sources.remote.wwr.feeds` | string[] | `[remote-programming-jobs]` | One sync target per RSS feed. |
| `sources.remote.wwr.minIntervalHours` | number | `12` | Minimum fetch interval. |
| `filters.titleInclude` | string[] | — | Word-boundary match; at least one required if non-empty. |
| `filters.titleExclude` | string[] | — | Word-boundary match; any match rejects the job. Evaluated before `titleInclude`. |
| `filters.remoteOnly` | boolean | — | Reject anything not detected as remote. |
| `filters.locationsAllow` | string[] | — | Substring allowlist, applied only to non-remote jobs' location text. |
| `filters.descriptionExclude` | string[] | — | Case-insensitive substring match anywhere in the description. |
| `filters.maxAgeDays` | number | — | Reject a job older than this when `postedAt` is known. |
| `llm.extractionModel` | string | — | Model used for match scoring, as `"<provider>/<model>"`. See [LLM providers](#llm-providers). |
| `llm.tailorModel` | string | — | Model used for CV tailoring, as `"<provider>/<model>"`. |
| `llm.maxDescriptionChars` | number | — | Description truncation length before sending to the LLM. |
| `llm.extractionConcurrency` | number | — | Max concurrent extraction calls per sync. |
| `llm.providers.openai.baseUrl` | string | OpenAI's API | Overrides the OpenAI API base URL, e.g. to route through a proxy. |
| `llm.providers.ollama.baseUrl` | string | `http://localhost:11434` | Overrides Ollama's native API address. |
| `llm.providers.ollama.think` | boolean | `false` | Passed as Ollama's native `think` option; `false` skips hidden reasoning on thinking-capable models. |
| `llm.providers.cloudflare.accountId` | string | — | Cloudflare account ID; required for `cloudflare/…` models. The Workers AI base URL is derived from it. |
| `llm.providers.cloudflare.baseUrl` | string | derived from `accountId` | Overrides the Workers AI base URL, e.g. to route through AI Gateway. |
| `llm.providers.local.baseUrl` | string | `http://localhost:11434/v1` | Overrides the local OpenAI-compatible server's base URL (LM Studio, vLLM, llama.cpp server, …). |
| `sync.httpConcurrency` | number | — | Max concurrent HTTP fetches per sync. |
| `sync.httpTimeoutMs` | number | — | Per-request timeout. |
| `sync.httpRetries` | number | — | Retries on network error, 429, or 5xx, with backoff. |
| `sync.maxExtractPerRun` | number | — | Default cap on extractions per sync (`--max-extract` overrides). |
| `sync.minScoreToHighlight` | number | — | Threshold for the "New matches" list in the sync summary. |
| `cv.maxPages` | number | — | Target maximum PDF page count; least-relevant bullets are dropped to fit. |
| `cv.maxBulletsPerRole` | number | — | Upper bound on bullets per role/project in tailoring. |
| `cv.paper` | `A4` \| `Letter` | — | PDF page size. |

## Commands

### `jobhunt init`

```
jobhunt init
```

Creates `$JOBHUNT_HOME`, copies the example config and master CV (without
overwriting existing files), stubs `.env`, and applies database migrations.
Idempotent.

### `jobhunt sync`

```
jobhunt sync [--source <name>] [--dry-run] [--no-extract] [--max-extract <n>]
```

Fetches every configured source, normalizes and deduplicates the results,
applies filters, and scores the survivors with an LLM.

| Flag | Effect |
|---|---|
| `--source <name>` | Limit to one source or board, e.g. `greenhouse` or `greenhouse:stripe`. |
| `--dry-run` | Fetch and diff in memory; write nothing. |
| `--no-extract` | Skip the LLM scoring step for this run. |
| `--max-extract <n>` | Override `sync.maxExtractPerRun` for this run. |

```
Sync complete in 1.4s
Sources: 3 ok, 1 failed (lever:foo — board not found (404); check the slug in config.yaml), 1 skipped (remotive:software-dev — fetched 3h ago)
Fetched 1120 jobs → 37 new, 12 changed, 21 closed, 3 duplicates
Filtered: 29 passed, 8 rejected (top reasons: title-no-match ×5, not-remote ×3)
Extracted 27 (2 failed)

New matches ≥ 70:
id    score  company  title                                  location
#412  92     Acme     Senior Backend Engineer (TypeScript)    remote
#415  81     Globex   Full Stack Engineer                     EMEA
```

Remote-board sources are throttled by their own `minIntervalHours` and are
skipped, not re-fetched, within that window. If no API key is configured,
extraction is skipped with an explicit message rather than failing the
run. Idempotent: an unchanged sync reports `0 new, 0 changed`, and
extraction never re-scores unchanged content.

Exit codes: `0` success, `2` partial (one or more sources failed), `1`
fatal (invalid config, database error).

### `jobhunt list`

```
jobhunt list [--all] [--company <text>] [--remote] [--min-score <n>] [--limit <n>] [--format table|json|md]
```

Lists stored jobs, sorted by match score (unscored last), then recency. By
default, only non-closed, non-duplicate, filter-passed jobs are shown.

| Flag | Effect |
|---|---|
| `--all` | Include rejected, duplicate, and closed jobs, with a `why` column. |
| `--company <text>` | Filter by company name substring. |
| `--remote` | Remote jobs only. |
| `--min-score <n>` | Only jobs scored at or above `n`. |
| `--limit <n>` | Row limit (default 20). |
| `--format md` | Markdown table with linked titles, e.g. `jobhunt list --format md > digest.md`. |

### `jobhunt show <id>`

```
jobhunt show <id> [--desc] [--json]
```

Prints a job's details — company, title, location, URL, status, source —
and its LLM analysis if one exists (match score, summary, requirements,
stack, seniority, remote policy, gaps, red flags). `--desc` includes the
full plain-text description.

### `jobhunt tailor <id>`

```
jobhunt tailor <id> [--regen] [--open]
```

Generates a tailored CV PDF. Runs extraction on demand if the job has none,
then has an LLM select, reorder, and lightly reword bullets from your
master CV. A deterministic validator checks every bullet, skill, and
summary line against the source material; anything it can't verify is
reverted to the original wording rather than trusted. Facts never
originate from the model — only your master CV does.

```
Tailored CV: ~/.jobhunt/out/acme-backend-engineer-42.pdf (1 page)
  warning: bullet "exp-acme-2" mentions "Kubernetes", which appears in neither the original bullet nor the master vocabulary
```

Without `--regen`, a second run for the same job reuses the existing PDF
with no LLM calls. `--open` opens the generated file. Basics, education,
dates, titles, and company names always come from `master-cv.yaml`
verbatim.

### `jobhunt apply <id>`

```
jobhunt apply <id> [--mark]
```

Opens the job's apply URL in your default browser and prints the tailored
CV's path. If no tailored CV exists yet, an interactive session offers to
generate one; a non-interactive session fails with instructions rather
than hanging on a prompt. `--mark` records the job as applied without
prompting; otherwise you're asked when connected to a terminal.

### `jobhunt status <id> <state>`

```
jobhunt status <id> <state> [--note <text>]
```

Sets a job's status: `new`, `shortlisted`, `applied`, `interview`, `offer`,
`rejected`, `dismissed`, or `withdrawn`. Transitions are unrestricted.
Setting `applied` also records the application timestamp if it isn't set
already. `--note` attaches free text; omitting it on a later change leaves
the existing note untouched.

### `jobhunt dismiss <id...>`

```
jobhunt dismiss <id...>
```

Shorthand for `jobhunt status <id> dismissed` across one or more ids.

### `jobhunt stats`

```
jobhunt stats
```

Counts by status, jobs seen per week, applications per week, average match
score of applied jobs, and the source producing the most well-matched
results.

### `jobhunt sources`

```
jobhunt sources list
jobhunt sources add <source:board>
jobhunt sources remove <source:board>
jobhunt sources check
```

| Subcommand | Effect |
|---|---|
| `list` | Configured targets with last sync result. |
| `add <source:board>` | Verifies the board exists, then adds it to `config.yaml`, preserving comments and formatting. |
| `remove <source:board>` | Removes it from `config.yaml`; stored jobs are kept but no longer refreshed. |
| `check` | Fetches every target once and reports ok/fail; writes nothing. |

## Architecture

1. **Sources** — `greenhouse`, `lever`, `ashby`, `workable`, `recruitee`,
   `bamboohr`, `teamtailor`, `breezy`, `smartrecruiters`, and `jazzhr` query each ATS's
   public API (or RSS feed) directly. `remotive`, `remoteok`, and `wwr` are remote-job
   aggregators, each throttled by `minIntervalHours` and always linking
   back to the aggregator's own listing rather than the employer, per each
   site's terms of use.
2. **Normalization** strips and decodes HTML, detects remote status, and
   computes a content hash and a cross-source deduplication key.
3. **Upsert** by `(source, board, externalId)`: new jobs are inserted,
   unchanged jobs update only their last-seen timestamp, changed jobs are
   updated in place and re-filtered.
4. **Deduplication** collapses a posting found under multiple sources into
   one record; an ATS listing always takes precedence over a remote-board
   aggregator's copy of the same posting.
5. **Filtering** is deterministic and ordered — `maxAgeDays`,
   `titleExclude`, `titleInclude`, `remoteOnly`/`locationsAllow`,
   `descriptionExclude` — and runs before any LLM call. Every non-closed
   job is re-evaluated against the current config on each sync, so editing
   `config.yaml` reclassifies existing jobs without a refetch.
6. **Closed-job detection** marks a previously seen job as closed only
   after a target's fetch succeeds completely; a failed fetch never closes
   anything.
7. **Extraction** sends filter-passed, non-duplicate, non-closed jobs to an
   LLM — job text and your profile summary, never the CV — for structured
   requirements and a 0–100 match score via a schema-validated tool call.
   Results are cached by `(contentHash, promptVersion)`; invalid output is
   retried once, then skipped rather than failing the run.
8. **Tailoring** sends the job's requirements and your full master CV
   (excluding contact details, reattached at render time) to an LLM for
   bullet selection and light rewording. A code-level validator checks
   every claim against the source material; anything unverifiable reverts
   to the original text after one retry. Output renders to a single-column
   PDF via headless Chromium, trimming bullets to fit `cv.maxPages`.
9. **Application tracking** records status transitions and application
   timestamps. No step in this pipeline submits an application on your
   behalf.

Typical workflow:

```
jobhunt sync → jobhunt list → jobhunt show <id> → jobhunt tailor <id> → jobhunt apply <id> --mark → jobhunt status <id> interview
```

All data is stored locally: `~/.jobhunt/jobhunt.db` (SQLite),
`~/.jobhunt/config.yaml`, and `~/.jobhunt/out/`. The only external calls
are to whichever LLM provider is configured (see [LLM providers](#llm-providers),
none at all if both models point at `local`) — job text and your profile
summary for scoring, job text and your master CV (minus contact details)
for tailoring.

## Scheduling

jobhunt has no built-in scheduler; run `jobhunt sync` via cron or launchd
on whatever cadence you prefer. It is safe to run arbitrarily often —
remote-board sources self-throttle and every upsert is idempotent. See
[`docs/SCHEDULING.md`](docs/SCHEDULING.md) for cron and launchd examples,
including a note for nvm/fnm/volta users on resolving `node` correctly in
a non-interactive shell.

## Testing

```sh
npm run build      # prisma generate + nest build
npm test           # unit tests against recorded fixtures; no network access
npm run test:live  # opt-in: one live request per source adapter
npm run lint       # type-check with tsc --noEmit
```

Adapter tests run against real API responses captured under
`test/fixtures/` and committed to the repository. `test:live` is excluded
from the default test run and exists to detect upstream API or feed
changes that fixture-based tests cannot.

## Project structure

```
src/
├── common/    HTTP client, text/HTML utilities, hashing, concurrency limiter, error types
├── config/    config.yaml loading and validation, comment-preserving edits
├── db/        Prisma client and the single repository all data access goes through
├── sources/   One adapter per source, behind a shared interface
├── jobs/      Normalization, deduplication, filtering, extraction, and the sync pipeline
├── llm/       Multi-provider LLM integration (Anthropic, OpenAI, Cloudflare, Ollama native, OpenAI-compatible local)
├── cv/        Master CV schema, tailoring, fabrication validator, PDF rendering
└── commands/  CLI command definitions
```

## Roadmap

- Additional ATS adapters (Workable, SmartRecruiters).
- Regional job boards requiring HTML scraping.
- Assisted, human-submitted form pre-fill for `apply`.
- Cover letter generation from a job's requirement map.
- Scheduled digest delivery (email, Slack) built on `list --format md`.
- Multiple named profiles scored independently against the same job pool.

## License

[MIT](LICENSE)
