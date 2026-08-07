# Usage

Running the server, running Claude Code through it, and the full command reference.

## Start the proxy server

```bash
teamclaude server
```

From a TTY this shows the interactive TUI: an account table with session/weekly quota bars and reset countdowns, a real-time activity log, and keyboard controls.

It falls back to plain log output when stdout is not a TTY (e.g. running as a service). Pass `--headless` (or `--no-tui`) to force plain-log mode from a terminal — useful for backgrounding the proxy.

Headless, you can re-sync accounts from the config without a restart by POSTing to the local control endpoint (the equivalent of pressing **R** in the TUI):

```bash
curl -X POST http://localhost:3456/teamclaude/reload
```

You usually don't need to call it directly. `login`, `import`, `enable`, `disable`, `priority`, `route`, `probe` and `warmup` notify a running server themselves.

### TUI keyboard shortcuts

| Key | Action |
| --- | --- |
| `s` | Switch active account (`←`/`→` picks the default account or a specific [route](routing.md#model-routes)) |
| `d` | Enable/disable an account |
| `p` | Refresh quota on all accounts (one-shot probe of the zero-spend usage endpoint) |
| `R` | Reload accounts from config |
| `g` | Settings (threshold, quota probe, routing, add/remove accounts, sx.org) |
| `q` | Quit |

In selection mode, use `j`/`k` or the arrow keys to navigate, `Enter` to confirm, `Esc` to cancel.

The settings screen is a list, not a set of letter shortcuts: `↑`/`↓` move between rows, `←`/`→` change the value in place (threshold by 1%, probe by 30s, modes cycle), `Enter` opens a row that needs typing or a sub-screen, `Esc` goes back.

## Run Claude Code through the proxy

```bash
teamclaude run
```

`run` probes the proxy first. If it's up, Claude Code is routed through it; if it's **not** running, `run` errors out rather than silently bypassing the proxy — which would spend your own quota with no rotation. Pass `--auto-fallback` to launch `claude` directly instead when the proxy is down:

```bash
teamclaude run --auto-fallback
```

Since **1.1.0**, `run` defaults to [MITM forward-proxy mode](proxy-modes.md#mitm-proxy-mode-default) so even hardcoded `api.anthropic.com` endpoints are intercepted. For the previous base-URL-only behavior, pass `--no-mitm`:

```bash
teamclaude run --no-mitm
```

Arguments after `--` go to `claude`:

```bash
teamclaude run -- --model opus
```

### Setting the environment yourself

`teamclaude env` prints the same export lines `run` uses:

```bash
eval "$(teamclaude env)"           # MITM: HTTPS_PROXY + NODE_EXTRA_CA_CERTS
eval "$(teamclaude env --no-mitm)" # base-URL: ANTHROPIC_BASE_URL only
claude
```

Only the export lines go to stdout (so `eval` is safe); a short summary and any hints go to stderr. No `ANTHROPIC_API_KEY` is emitted — loopback clients are exempt from the proxy key gate, and setting it would drop Claude Code out of subscription mode. A remote (non-loopback) client must add the proxy key itself.

**Using an agent multiplexer or a tool that spawns `claude` itself?** Export this environment in the process that launches those `claude` instances — e.g. `eval "$(teamclaude env)"` in the shell you start the multiplexer from. Every spawned `claude` then gets the same routing (and MITM interception of hardcoded endpoints) without going through `teamclaude run`. The trade-off: `run`'s proxy-up/down guard only applies when you launch via `run`, so start the server before the multiplexer.

### Routing plain `claude` automatically

So you don't have to type `teamclaude run` every time, add a shell alias that sends plain `claude` through the proxy:

```bash
teamclaude alias              # print the alias for your shell
teamclaude alias --install    # or write it to your shell rc (--uninstall to remove)
```

This is an interactive-shell alias — it affects `claude` typed at a prompt, not `claude` spawned by editors or scripts. It's a thin passthrough to `teamclaude run`, which holds the proxy-up/down logic (so it errors when the proxy is down; add `--auto-fallback` to launch claude directly instead).

## Command reference

```bash
teamclaude login             # Add an account via OAuth (--api for an API key)
teamclaude import            # Import credentials from Claude Code
teamclaude server            # Start the proxy (--headless for plain logs)
teamclaude run               # Run Claude Code through the proxy
teamclaude env               # Print export lines for routing claude yourself
teamclaude alias             # Print/install a `claude` alias that routes via the proxy
teamclaude accounts          # List accounts with subscription tier and token status
teamclaude status            # Show live proxy status (requires running server)
teamclaude remove <name>     # Remove an account (by name or email)
teamclaude disable <name>    # Temporarily exclude an account from rotation
teamclaude enable <name>     # Re-enable it (also clears a stuck error state)
teamclaude priority <name> 1 # Set rotation priority (lower = preferred)
teamclaude route list        # Manage per-model routes (add/rm)
teamclaude probe 300         # Enable background quota refresh (off by default)
teamclaude warmup 600        # Enable keep-warm (off by default, spends quota)
teamclaude api <path>        # Call an API endpoint with account credentials
teamclaude update            # Check npm for a newer teamclaude and install it
teamclaude version           # Print the installed version
teamclaude help              # Show all commands
```

`teamclaude status` prints the same picture as the TUI, once, as text. Handy over SSH or in a script; `--json` for machine-readable output.

![teamclaude status output](assets/status-redacted.png)

## When the proxy is not reachable

If your machine is enrolled against a hosted proxy and that proxy is down, Claude Code cannot reach the API — the failure is a transport error the proxy never saw, so it cannot explain itself. The recovery does not depend on anyone being awake:

```bash
teamclaude unenrol
```

That removes the `env` block enrolment added to `~/.claude/settings.json`, the marked block in your shell rc, and the certificate files. What is left reaches the upstream directly, as it did before enrolling.

**It does not have to be done perfectly.** A partial removal degrades safely, which was measured: with the proxy gone and `NODE_EXTRA_CA_CERTS` still pointing at a deleted file, the client warned `Ignoring extra certs … load failed` and carried on. Deleting the certificate files by hand and reopening a terminal is enough if the command itself is unavailable.

Re-enrol with `teamclaude enrol --proxy <url>` when the service is back.

## What a proxy error is telling you

Failures the proxy originates carry a distinct `error.type`, but **the message is the part you see** — the client prints it verbatim and does not show the type. So the message says the whole thing:

| You can act on it | The message names the step |
| --- | --- |
| `credential_refused` | which account, and `teamclaude login` to re-add it |
| `destination_not_allowed` | the host, and the `proxy.connect.allow` entry that would permit it |
| `destination_address_blocked` | the address it resolved to, and the setting that would permit it |
| `egress_not_pinned` | the egress address seen against the pinned one |

| You cannot | The message carries a reference |
| --- | --- |
| `upstream_unreachable` | the upstream could not be reached |
| `upstream_error` | the upstream failed in a way the proxy could not recover from |
| `proxy_internal_error` | a fault inside the proxy |

The second group ends with `Reference: 7f3a9c21.` — eight hex characters that also appear in the server log for that request. Quoting it to whoever runs the proxy turns "it broke" into something they can look up.

## Auto-update

When TeamClaude is installed globally via npm, it self-updates in the background: it checks the npm registry at most once a day, and when a newer version is published it runs `npm install -g @karpeleslab/teamclaude@latest` and applies it on the next launch. The check runs after a `teamclaude run` session ends and when a headless server starts. A git checkout is never touched — update that with `git pull`. Run `teamclaude update` to update on demand.

Disable it with `TEAMCLAUDE_DISABLE_AUTOUPDATE=1` or `"autoUpdate": false` in the config.

## Request logging

Log full request/response details to a directory, one file per request:

```bash
teamclaude server --log-to /tmp/requests
```

`--activity-log FILE` appends the TUI activity lines to a file instead, and works in headless mode too.

Claude Code's telemetry (`/api/event_logging/*`) is high-volume activity-log noise and is hidden from the log by default; see [`eventLogging`](configuration.md#fields) to block or show it instead.
