# AI Workspace Session Manager

**English** | [Tiếng Việt](README.vi.md)

A VS Code extension that manages **multiple global workspaces**, each holding **multiple open
terminals** — both terminals you open by hand and terminals running Claude Code. No manifest
lives inside your repo: the entire workspace list is stored in the extension's global storage
(`workspaces.json`) and updates itself continuously while you work — there is no manual Save
button. Open VS Code, and the "AI Workspaces" tree shows your existing workspaces; click one
to activate it, and the extension reopens exactly the terminals from your last session,
resuming the right Claude Code conversation (if any) or re-running the recorded
`startCommand`.

## Requirements

- VS Code ≥ 1.93 (uses the Terminal Shell Integration API for accurate cwd tracking)
- VS Code Shell Integration working (on by default with PowerShell/bash/zsh) — needed for
  auto-remembering running apps and accurate cwd updates
- Claude Code ≥ 2.1 (the `claude` command available on PATH) — only needed for
  `kind: claude` terminals

## Key features

- **Global workspace list**: not tied to a specific folder/repo; one workspace can hold
  terminals pointing at many different repos/folders.
- **Adoption**: while a workspace is active,
  - a terminal you open yourself with <kbd>Ctrl+Shift+`</kbd> (unnamed, not a task runner) →
    **added automatically** to the active workspace, with a toast offering "Remove" in case
    it was added by mistake;
  - a terminal created by a task runner/another extension (custom name) → a toast suggests
    adding it; it only joins the workspace if you click "Add";
  - any open terminal can be added manually via the terminal tab's right-click menu
    (**AI Workspace: Add open terminal to workspace**) — if no workspace is active, the
    command asks you to pick/create one (without activating it).
- **Auto-save**: every change (add/remove terminal, rename, session attach, cwd change,
  workspace activate/close) is saved with a 500 ms debounce to `workspaces.json`, written
  via temp+rename (atomic) — there is no manual Save action anywhere.
- **Activate / switch workspaces**: click an inactive workspace → each saved terminal is
  reopened. If another workspace is currently active, the extension shows a modal
  "Save and close X before opening Y?" before switching; cancelling does nothing.
- **Claude terminals** (`kind: claude`): on reopen the extension sends
  `claude --resume '<sessionId>' -n '<claudeName>'`; if the entry never had a sessionId
  (freshly created), the extension mints a new uuid, sends `--session-id`, and flushes to
  disk BEFORE sending the command (no orphaned sessions if VS Code dies mid-launch).
- **Plain terminals** (`kind: plain`): tracks the shell (name + cwd) and **auto-remembers
  the running app** — the extension listens to Shell Integration events: any command that
  runs for 15 seconds or more (dev server, ssh, watcher…) automatically becomes the
  `startCommand`, written to disk the moment the command *starts* (nothing is lost if
  VS Code dies mid-run); trivial commands (`ls`, `git status`…) are filtered out. The next
  workspace activation re-runs exactly that app — no explicit declaration needed. You can
  still set/edit it manually via **AI Workspace: Set start command for terminal**. On
  reopen, if the `startCommand` is not yet trusted, the extension shows a modal quoting the
  command verbatim, with "Trust and run" or "Open shell only". Changing the `startCommand`
  (including via auto-capture) invalidates the old trust (fingerprint changes) — the next
  activation asks for trust again.
- **Automatic Claude session capture**: every ~3 seconds the extension matches the cwd of
  open terminals in the active workspace against `claude agents --json` (only
  `kind: interactive` rows). A unique match → `claudeSessionId`/peer name attached
  automatically, and the `plain` terminal is "promoted" to `claude`. Multiple terminals with
  the same cwd / multiple sessions in the same cwd → the extension **walks the process
  ancestry** (the session's pid, walked up its ancestor chain, must reach exactly one
  terminal's shell pid) to resolve deterministically; only what remains unresolvable shows a
  QuickPick, asked once per cwd group (not re-asked every poll cycle if you dismiss it).
  When you **close a workspace**, the extension runs one final capture sweep and re-asks
  even the groups you previously dismissed — after closing there is no way left to capture.
  If the machine can't resolve it, attach manually via **"Assign Claude session to
  terminal"** on the terminal item in the tree.
- **One active workspace per VS Code window**: best-effort lock via `activeWindowId`;
  opening the same workspace in a second window shows a warning with an "Open anyway"
  override.
- **Closing a terminal does not remove it from the workspace**: closing a terminal by hand
  (the X button or `exit`) only moves the entry to the "not open" state in the tree — the
  workspace still remembers it, and reactivating the workspace reopens it. To remove it for
  good, use **AI Workspace: Remove terminal from workspace**.
- **Deleting a workspace does not close real terminals**: deleting a workspace from the list
  only forgets it — its real open terminals keep running untouched.

## Commands

| Command | Command ID | Context |
|---|---|---|
| AI Workspace: Create new workspace | `aiWorkspace.createWorkspace` | Palette / "+" button on the view |
| AI Workspace: Activate workspace | `aiWorkspace.activateWorkspace` | Click item / context menu of an inactive workspace |
| AI Workspace: Close active workspace | `aiWorkspace.closeActiveWorkspace` | Palette / context menu of the active workspace (bottom group, with confirmation modal) |
| AI Workspace: Workspace settings | `aiWorkspace.workspaceSettings` | Workspace context menu — per-workspace terminal location (follow global / editor area / bottom panel) |
| AI Workspace: Rename workspace | `aiWorkspace.renameWorkspace` | Workspace context menu |
| AI Workspace: Delete workspace | `aiWorkspace.deleteWorkspace` | Workspace context menu (with confirmation modal) |
| AI Workspace: New Claude terminal | `aiWorkspace.newClaudeTerminal` | Palette / workspace context menu — asks for ONE path only, then arrow-key through command variants (new session / `-c` / `-r`, each with a `--dangerously-skip-permissions` twin); the terminal opens there immediately, named after the folder |
| AI Workspace: New terminal | `aiWorkspace.newPlainTerminal` | Palette / workspace context menu — asks for ONE path, opens a plain terminal there (added to the workspace, apps auto-captured as usual) |
| AI Workspace: Rename terminal | `aiWorkspace.renameTerminal` | Terminal item context menu — or use VS Code's built-in Rename on the terminal tab; the name syncs back to the tree within ~3 seconds |
| AI Workspace: Set start command for terminal | `aiWorkspace.setStartCommand` | `plain` terminal context menu |
| AI Workspace: Remove terminal from workspace | `aiWorkspace.removeTerminal` | Terminal context menu |
| AI Workspace: Open terminal | `aiWorkspace.focusTerminal` | Click a terminal item in the tree |
| AI Workspace: Add open terminal to workspace | `aiWorkspace.addOpenTerminalToWorkspace` | Terminal tab right-click menu / palette |
| AI Workspace: Assign Claude session to terminal | `aiWorkspace.assignClaudeSession` | Terminal item context menu in the tree |

The "AI Workspaces" tree (in Explorer, view id `aiWorkspace.workspaces`) has 2 levels:
level 1 is the workspace list (sorted by most recently active, the active workspace gets its
own badge), level 2 is each workspace's terminals with a status label (running / idle /
waiting / open / not open / error), refreshed every ~3 seconds while the view is visible
(polling stops when the view is hidden).

**Terminal location**: every terminal the extension creates or restores opens as a **tab in
the editor area** by default (setting `aiWorkspace.terminalLocation`, switch to `panel` to
get the classic bottom panel). Each workspace can override this via **AI Workspace:
Workspace settings** in its context menu — the choice is saved with the workspace and
applies to both new and restored terminals. For terminals you open yourself with
<kbd>Ctrl+Shift+`</kbd>, use VS Code's own setting
`terminal.integrated.defaultLocation: "editor"`.

## Safety principles

- Never runs a `startCommand` that has not been explicitly trusted (trust is fingerprinted
  on the command's content; changing the command invalidates the old trust).
- Never closes real terminals when deleting a workspace or removing a terminal from one.
- A corrupt/unparseable `workspaces.json` → backed up to `workspaces.json.bak-<epoch>` and
  the list is re-initialised empty, with a one-time warning — corrupt data is never silently
  discarded.
- A terminal whose `--resume` id no longer maps to a conversation: the extension does not
  intervene; the terminal still opens and the error shows directly inside it; the entry
  keeps its id so you can fix it by hand / retry.

## Known limitations

- No migration from the MVP data model (the old in-repo `workspace.yaml` manifest) — v2 is a
  completely different data model (global storage, not a file in the repo).
- Shell content/history is not restored — only Claude Code conversations resume via
  `--resume`; plain terminals just reopen at the right cwd and run the `startCommand`
  (if any).
- No workspace auto-activates when VS Code opens — the tree only shows the list; you pick.
- The "one active workspace per window" lock is best-effort only (no heartbeat, no hard
  lock); killing a window abruptly can leave a stale lock — the other window uses "Open
  anyway" to get out of that state.
- Two entries in two different workspaces can point at the same `claudeSessionId`: session
  matching only looks at the active workspace, so it can't know a session was already
  claimed by another workspace. Activating both workspaces will `--resume` the same
  conversation twice.
- Multiple VS Code windows: every save merges by id, and **each window only overwrites the
  workspaces it has touched itself** (created, renamed, activated, added/removed
  terminals…). Untouched workspaces follow the latest copy on disk, so another window's
  ongoing work is not clobbered. Each workspace's state is therefore that of the last window
  to touch it.
- Deleting a workspace in one window can be undone by another window that still holds it in
  RAM and has touched it — its next save may resurrect it.
- No multi-machine workspace management, no workspace sharing via git.

## Development

```bash
npm install
npm test              # 116 unit/integration tests (vitest) — pure core, no vscode API
npm run test:vscode   # 6 smoke tests running inside a real Extension Host
npm run typecheck     # tsc --noEmit
npm run build         # bundle with esbuild into dist/extension.js
```

Press <kbd>F5</kbd> in VS Code (using the "Run Extension" configuration in
`.vscode/launch.json`) to open an Extension Host window with the extension running in debug
mode — use that window to run the manual test checklist in `docs/manual-verification.md`,
since most dialog-driven flows (modals, toasts, QuickPicks) cannot be tested automatically
in a headless Extension Host.
