# Chat enhancements

Paseo plugin that turns absolute file and folder paths outside the workspace into clickable links anywhere in agent chat, and copies rendered chat Markdown as its Markdown source. Clicking a link opens a file in the default text editor or a folder in the file browser.

## Install

Requires [Paseo](https://paseo.sh) 0.13.0 or later with plugins turned on (Settings > Plugins > Enable plugins).

```sh
paseo plugin install https://github.com/alchemyyy/paseo_chat_enhancements
```

`paseo plugin update chat-enhancements` updates it, and `paseo plugin remove chat-enhancements` removes it. The [Plugin manager](https://github.com/alchemyyy/paseo_plugin_manager) plugin checks and updates installed plugins from the sidebar.

The `paseo` command comes with the desktop app: Settings > Integrations > Command line puts it on `PATH`, or run `paseo.cmd` from the app's `resources\bin` folder.

To work on the plugin, clone this repository and install the folder instead (`paseo plugin install <folder>`), then run `paseo plugin reload chat-enhancements` after editing it.

## Features

### Path links in chat

- Detects absolute paths in every open agent chat, including text added while an agent streams:
  - Windows host: drive paths (`C:\...`, `C:/...`, or a bare drive root `C:\`), UNC paths (`\\server\share\...`), `~\` or `~/` home paths, and MSYS/Git Bash paths (`/c/Users/...`).
  - macOS and Linux hosts: `/...` and `~/` paths.
- Paths may contain up to 8 spaces (for example `C:\Program Files\...`) and up to 400 characters. A trailing line suffix (`:12`, `:12:3`, `:12-20`) or trailing punctuation is dropped when the path without it exists. The longest existing path wins.
- Only links paths that exist on the daemon host, are a file or folder, and lie outside the chat's workspace folder (case-insensitive on Windows). Paths inside the workspace are left to Paseo.
- Does not link text inside text inputs or editable fields. URLs are not matched.
- Relative paths are linked only where Paseo already made them a link, such as `NOTES.md` in code or in a table. Paseo looks those up only inside the workspace, so the plugin also tries each folder the same message names by absolute path (a named folder, or a named file's folder). The first folder holding the path that exists outside the workspace takes over the click; otherwise the link stays Paseo's.
- Other existing links are left alone.
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

### Copy as Markdown

- Copying a selection of rendered Markdown in a chat (Ctrl+C or the context menu) puts the Markdown it was rendered from on the clipboard as plain text, instead of the rendered text or Paseo's regenerated Markdown. Rich-text targets still receive Paseo's formatted HTML.
- The copy runs from the first selected character to the last; markup outside the selection is never added. Markup the selection cuts through is removed, so nothing is left half open:
  - Inline code, emphasis, strikethrough, links, and autolinks keep their markup only when the selection covers them whole. Copying `` `hello` there `` from the start of `hello` gives `hello there`; part of a link copies as its text, without the target.
  - A heading, quote, list item, or code block the selection starts inside loses its markup there: the closing `##` or underline, quote markers, list indentation, and the closing fence. One the selection starts before keeps it. A code block cut at its end keeps its opening fence, which is still valid Markdown.
  - Table rows keep their pipes and delimiter row. When the selection spans several cells, a cell selected whole brings its outer pipes, so a selected table copies as a table.
- Escapes (`\*`), entities (`&amp;`), images, and line breaks copy as written. Blank lines at the start and end are dropped.
- A selection running past the start or end of a message takes that message's Markdown up to its start or end. Across messages, each message's Markdown is separated by a blank line, and the text between them (your messages, tool rows) is copied as plain text.
- Selections that cover no rendered Markdown, or reach outside the chat, copy as before.

## Limitations

- Works only in the web and desktop (Electron) clients, and needs the browser's CSS Custom Highlight API. Links are off elsewhere.
- Paths are resolved and opened on the machine running the Paseo daemon, not necessarily the machine showing the chat.
- The plugin finds chats through Paseo's internal `agent-chat-scroll` test id, and the chat's workspace through Paseo's internal React pane context. A Paseo update may break these: without chats nothing is linked; without the workspace, paths inside the workspace are linked too.
- Copy as Markdown reads each message's source from the props of Paseo's internal `MarkdownRenderer`, and its rendered text through the `enrm-text` class of the Markdown renderer. If a Paseo update changes either, copies fall back to Paseo's own. Text the renderer adds, such as a GitHub alert's title, is not copied.

## Development

- `npm run vendor` (`scripts/vendor.mjs`) builds `client/vendor/markdown-tokens.js` from `vendor-src/markdown-tokens.ts`, bundling micromark and its GFM extensions (an installed plugin has no `node_modules`), and `client/vendor/THIRD_PARTY_LICENSES.txt`. `markdown-tokens.d.ts` beside it is hand-written.
- `npm run typecheck`, `npm test`.
