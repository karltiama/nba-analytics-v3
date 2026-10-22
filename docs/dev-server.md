# Local dev server

Reuse the Next.js server for this worktree only when ownership is positive. The main Court Context server is [http://localhost:3000](http://localhost:3000).

Preferred start, only when port 3000 has no listener:

```powershell
npm run dev -- --port 3000
```

Next.js 16 (`next` `16.0.10`) retries the next port only when the port source is the default. That is bare `npm run dev`, with no `--port` and no `PORT`. The retry loop runs while `portRetryCount < 10`, so a default start can bind 3001 through 3010. An explicit `--port 3000` sets `allowRetry` to false and exits when 3000 is taken. `next start` does not retry. Keep the flag.

`next dev` forks `next/dist/server/lib/start-server.js`. That child calls `listen`. The `npm` process, `cmd.exe`, and the `next` parent often do not own the port, and the child command line is not the worktree root. `README.md` shows bare `npm run dev` for a first human setup. Agents use the command above.

## Inspect the listener

Windows PowerShell. Do not use `lsof` or `kill`. Do not run `taskkill /IM node.exe /F`, and do not stop processes because they are Node or because they listen on 3000–3011.

Worktree roots:

```powershell
git rev-parse --show-toplevel
git worktree list --porcelain
```

`git rev-parse --show-toplevel` uses forward slashes (`C:/...`). Process command lines use backslashes (`C:\...`). Do not compare those strings raw.

Listener:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

For the owning PID, then for each ancestor you accept:

```powershell
Get-CimInstance Win32_Process -Filter "ProcessId = <pid>" |
  Select-Object ProcessId, ParentProcessId, CreationDate, ExecutablePath, CommandLine
```

Record `ProcessId`, `ParentProcessId`, `CreationDate`, `ExecutablePath`, and `CommandLine` for every process inspected.

Walk `ParentProcessId` only while the parent process exists, its `CreationDate` is present, and that time is strictly earlier than the child `CreationDate`. Stop on a missing parent, a missing creation time, a repeated PID, or a creation time that is not earlier. A later or equal creation time means the PID was reused. Do not treat that process as an ancestor.

Windows CIM does not reliably expose a working directory. Do not infer the worktree from the port, the window title, or `node.exe`.

## Compare paths

Normalize every candidate before comparing:

- Take drive-letter and UNC tokens from `CommandLine`, plus `ExecutablePath`. Strip quotes.
- Replace `/` with `\`.
- Run `[System.IO.Path]::GetFullPath` so the path is absolute, `.` and `..` are removed, and there is no trailing slash.
- If the path exists and is a junction or symlink, resolve the target as well. A lexical path and a resolved target that fall under different worktree roots are not evidence.

A path matches a worktree root only when the canonical paths are equal, case-insensitive, or the candidate continues with `\` immediately after that root. `C:\src\nba` does not match `C:\src\nba-analytics-v3`.

`C:\Program Files\nodejs\node.exe`, `npm-cli.js`, and `C:\Windows\System32\cmd.exe` are not worktree evidence. `npm`, `cmd.exe`, and `node.exe` still belong in the ancestry record so a later Next child or `next dev` command can be tied to them.

## Classify

Compare the accepted chain with every root from `git worktree list --porcelain`.

- **This worktree.** At least one evidence path matches the current root, and no evidence path matches another worktree. A path under `node_modules` counts only when no other worktree resolves the same Next install (`next\dist\server\lib\start-server.js`). A shared or linked install is not unique.
- **Other worktree.** At least one evidence path matches another listed worktree, and none match the current root, with the same shared-install rule.
- **Unknown.** No matching worktree path, paths in two worktrees, a shared or linked install, or a parent link the conclusion needs but cannot trust. Do not guess.

## Before starting

| Listener on port 3000 | Action |
|---|---|
| None | Start `npm run dev -- --port 3000`. |
| This worktree | Reuse `http://localhost:3000`. Do not start another server. |
| Other worktree | Report that worktree, PID, and command line. Do not reuse it and do not terminate it. |
| Unknown | Report PID, parent PID, creation time, executable, and command line. Do not start a server. Do not change ports. Do not kill anything. |

An other-worktree listener does not occupy this checkout. A temporary server for this checkout is allowed only through the lifecycle below. Unknown ownership is not that case.

## Temporary preview

Start one only when port 3000 is positively another worktree. Use a managed terminal or other tracked session, and one explicit port that `Get-NetTCPConnection` shows is free.

Record the worktree path, port, parent PID, listener PID once it binds, each creation time, and the child PIDs in that tree.

When the task ends:

1. Stop the server through the same terminal or session.
2. Check that port with `Get-NetTCPConnection -State Listen -LocalPort <port>`.
3. If it is free, cleanup is confirmed. Do not kill anything else.
4. If a listener remains, inspect its ancestry again with the same walk.
5. Terminate a process only when it is in the recorded tree, and a fresh CIM read still shows the same `ProcessId` and `CreationDate`. Parent links must still have a strictly earlier parent creation time. Stop children before parents, one `Stop-Process -Id <pid>` at a time.
6. Check the port again.
7. If a listener remains and fails that identity check, report its PID, creation time, and port. Do not claim cleanup succeeded.

Leave a server that was already running. Never stop an unidentified PID.

## Database

Each extra Next.js dev or preview server can open its own Supabase Postgres connections. Concurrent servers have hit `EMAXCONNSESSION`. Keep one server for this worktree. Load tests against production Supabase need explicit authorization.

## Finish

Report:

- which server was reused, or that none was
- which server was started, or that none was
- port and worktree path
- ownership: this worktree, other worktree, or unknown
- whether temporary cleanup was confirmed, and any remaining PID

## Scenario outcomes

| Case | Outcome |
|---|---|
| A. Port 3000 is free | Start `npm run dev -- --port 3000` |
| B. This worktree, listener is the `start-server.js` child | Reuse |
| C. Listener belongs to another worktree | Report. Do not reuse or terminate |
| D. Parent has exited; the child path matches this worktree | Reuse. Do not walk the missing parent |
| D. Parent has exited; the child path matches no worktree | Report unknown. Do not start or kill |
| E. Command line uses `\`, Git root uses `/` | Reuse after normalization |
| F. Ownership unknown | Report. Do not start a server or kill a process |
| G. Temporary session stop releases the port | Cleanup confirmed. Do not kill anything else |
| H. Session parent exits; listener creation time still matches the recorded tree | Stop those matching descendants, then confirm the port is free |
| I. PID reused, or creation time differs | Report. Do not terminate |
