# Local dev server

Reuse the Next.js process that already belongs to this worktree. The main Court Context server is [http://localhost:3000](http://localhost:3000).

Preferred start, only after the checks below show that this worktree has no server:

```powershell
npm run dev -- --port 3000
```

Next.js 16 (`next` `16.0.10`) retries the next port only when the port source is the default. That is bare `npm run dev`, with no `--port` and no `PORT`. The retry loop runs while `portRetryCount < 10`, so a default start can bind 3001 through 3010. An explicit `--port 3000` sets `allowRetry` to false and exits when 3000 is taken. `next start` does not retry. Keep the flag. A busy port is a stop, not a reason to launch again.

`README.md` shows bare `npm run dev` for a first human setup. Agents use the command above.

## Inspect before starting

The dev machine is Windows PowerShell. Use these commands. `lsof` and `kill` are not the tools here.

Listeners on the ports agents have used:

```powershell
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -ge 3000 -and $_.LocalPort -le 3011 } |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

Owning process:

```powershell
Get-CimInstance Win32_Process -Filter "ProcessId = <pid>" |
  Select-Object ProcessId, ParentProcessId, ExecutablePath, CommandLine
```

Current worktree:

```powershell
git rev-parse --show-toplevel
```

A listener belongs to this worktree when its `CommandLine` or `ExecutablePath` contains that path. Port 3000 alone is not enough. This repo uses Git worktrees, and each worktree has its own Next.js process and `.next` output. Leave a server in another worktree alone. Do not start a server there.

When a matching server is already listening, open that URL. Do not run `npm run dev`, `next dev`, `next start`, or a second local web server.

When 3000 is held by any other process, report the process id and command line, then stop. Do not switch ports. Do not try 3001, 3002, and so on. Do not kill a process to free 3000.

## Temporary preview

Use another server only when this worktree has no suitable server and the task cannot proceed on the existing one.

- Confirm the existing server cannot serve this checkout.
- Pick one explicit port that `Get-NetTCPConnection` shows is free.
- Record the worktree path, port, and process id.
- Start one process.
- When the task ends, stop that process id only (`Stop-Process -Id <pid>`).
- Run `Get-NetTCPConnection` again and confirm that port is no longer listening.

Leave a server that was already running before the task. Stop a process only when you started it and you still have its process id. An unidentified listener stays up.

## Database

Each extra Next.js dev or preview server can open its own Supabase Postgres connections. Concurrent servers have hit `EMAXCONNSESSION`. Keep one server for this worktree. Load tests against production Supabase need explicit authorization.

## Finish

Report:

- which server was reused, or that none was
- which server was started, or that none was
- port and worktree path
- which temporary process was stopped, or that none was
