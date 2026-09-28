# Scheduling `jobhunt sync`

jobhunt has no built-in scheduler — run `sync` however your OS already runs
periodic jobs. It's safe to run as often as you like: remote-board sources
throttle themselves via `minIntervalHours`, and every upsert is idempotent,
so a redundant run just reports `0 new, 0 changed`.

## Using nvm/fnm/volta? Read this first

cron and launchd don't load your shell profile, so `jobhunt` (and even
`node`) may not resolve the way they do in your terminal — especially with a
Node version manager like nvm, fnm, or volta, where `which node` points at a
per-shell-session symlink that won't exist for a job started outside your
shell. Two ways around it:

1. Resolve the real, version-manager-independent paths once and hardcode them:
   ```sh
   node -e "console.log(process.execPath)"        # the real node binary
   node -e "console.log(require.resolve('jobhunt/dist/main.js'))" 2>/dev/null \
     || echo "$(npm root -g)/jobhunt/dist/main.js"  # the real dist/main.js
   ```
   Then call `/path/to/that/node /path/to/that/dist/main.js sync` directly
   instead of relying on `jobhunt` being on `PATH`.
2. Or wrap the call in a small shell script that sources your version
   manager first (e.g. `source ~/.nvm/nvm.sh && jobhunt sync`), and point
   cron/launchd at the script instead of at `jobhunt` directly.

## cron

Edit your crontab (`crontab -e`) and add a line like:

```
0 7 * * * cd ~/.jobhunt && /path/to/node /path/to/jobhunt/dist/main.js sync >> ~/.jobhunt/sync.log 2>&1
```

This runs a sync every day at 7am, appending output to a log file. Adjust
the schedule and paths as needed; `crontab -l` shows your current jobs.

## launchd (macOS)

Create `~/Library/LaunchAgents/io.jobhunt.sync.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>io.jobhunt.sync</string>

  <key>ProgramArguments</key>
  <array>
    <string>/path/to/node</string>
    <string>/path/to/jobhunt/dist/main.js</string>
    <string>sync</string>
  </array>

  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>7</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>

  <key>StandardOutPath</key>
  <string>/Users/you/.jobhunt/sync.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/you/.jobhunt/sync.log</string>

  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
```

Replace the two `/path/to/...` entries and `/Users/you/.jobhunt/sync.log`,
then load it:

```sh
launchctl load ~/Library/LaunchAgents/io.jobhunt.sync.plist
```

To stop it: `launchctl unload ~/Library/LaunchAgents/io.jobhunt.sync.plist`.

## Checking it actually ran

Either schedule writes plain `jobhunt sync` output to the log path you gave
it — the same summary you'd see running it by hand (`Sync complete in
1.4s`, `Fetched N jobs → ...`). Tail the log after the first scheduled run
to confirm it's picking up your config and API key correctly:

```sh
tail -f ~/.jobhunt/sync.log
```

If `ANTHROPIC_API_KEY` isn't visible to the scheduled job's environment
(common with launchd, which starts with a minimal environment), extraction
will report `Extraction skipped: ANTHROPIC_API_KEY not set` in the log even
though the rest of sync succeeds — put the key in `~/.jobhunt/.env` rather
than relying on a shell-exported environment variable, since jobhunt reads
that file directly regardless of what launched it.
