# Chat enhancements

Paseo plugin that turns absolute file and folder paths outside the workspace into clickable links anywhere in agent chat. Clicking a link opens a file in the default text editor or a folder in the file browser.

## Install

1. Install [Paseo](https://paseo.sh) 0.13.0 or later and launch it once.
2. Run the setup script from this folder:

   ```powershell
   powershell -ExecutionPolicy Bypass -File install.ps1
   ```

   It installs the plugin with `paseo plugin install <folder>`, or runs `paseo plugin reload chat-enhancements` if the plugin is already installed. Run it again to reload the plugin after editing it. If plugins are disabled in `~/.paseo/config.json`, it warns you: turn on **Settings > Plugins > Enable plugins**, or set `pluginsEnabled` to `true` and run `paseo reload`.

Option: `-PaseoCli <path>` points to `paseo.cmd` if it is not on `PATH` or in the default Paseo install folders.

## Features

### Path links in chat

- Detects absolute paths in every open agent chat, including text added while an agent streams:
  - Windows host: drive paths (`C:\...`, `C:/...`, or a bare drive root `C:\`), UNC paths (`\\server\share\...`), `~\` or `~/` home paths, and MSYS/Git Bash paths (`/c/Users/...`).
  - macOS and Linux hosts: `/...` and `~/` paths.
- Paths may contain up to 8 spaces (for example `C:\Program Files\...`) and up to 400 characters. A trailing line suffix (`:12`, `:12:3`, `:12-20`) or trailing punctuation is dropped when the path without it exists. The longest existing path wins.
- Only links paths that exist on the daemon host, are a file or folder, and lie outside the chat's workspace folder (case-insensitive on Windows). Paths inside the workspace are left to Paseo.
- Does not link text inside existing links, text inputs, or editable fields. Relative paths and URLs are not matched.
- Paths that did not exist are checked again after 15 seconds, so files an agent creates later become links.
- Links use Paseo's own link color with a dotted underline, which turns solid on hover. Hovering shows a tooltip: "Open in text editor: <path>" or "Open in file browser: <path>".
- Left-click opens the path. Releasing a text-selection drag over a path selects text instead of opening it. If opening fails, the tooltip shows "Could not open: <reason>" for 4 seconds.

### Opening paths (on the daemon host)

- Files open in the default plain text editor:
  - Windows: the program registered for `.txt` (the user's `UserChoiceLatest`/`UserChoice` choice, else the `.txt` class), falling back to `notepad.exe`. Store apps that register no open command also fall back to Notepad.
  - macOS: `open -t`.
  - Linux: the `text/plain` default from `xdg-mime` via `gtk-launch`, falling back to `xdg-open`.
- Folders open in Explorer on Windows, `open` on macOS, and `xdg-open` on Linux.
- Server RPCs: `paths.resolve` (up to 256 paths per call, 1024 characters each) reports which paths are an existing file or folder outside the workspace; `paths.open` opens one path.
- A path whose lookup takes over 3 seconds, such as one on an unreachable network share, is not linked.

## Limitations

- Works only in the web and desktop (Electron) clients, and needs the browser's CSS Custom Highlight API. Links are off elsewhere.
- Paths are resolved and opened on the machine running the Paseo daemon, not necessarily the machine showing the chat.
- The plugin finds chats through Paseo's internal `agent-chat-scroll` test id, and the chat's workspace through Paseo's internal React pane context. A Paseo update may break these: without chats nothing is linked; without the workspace, paths inside the workspace are linked too.
