# envpeek

Edit your `.env` without leaving Claude Code.

envpeek is a mod for Claude Code. It adds a pane that lists the keys of the `.env` file in the folder you are working in, and lets you change a value, add a key or delete one. No editor window, no asking the model to touch your secrets.

## What it does

- **`/env`** opens the pane on `.env` in the current folder. `/env .env.local` opens another file.
- **Values are hidden by default.** Each key shows as dots until you select it or press "Show values".
- **Select a key to edit it.** The value appears in a text field; Enter saves.
- **Add** a key by typing `KEY=value`. If the folder has no `.env` yet, the first add creates it.
- **Delete** the selected key.
- **A file picker** appears when the folder holds several `.env*` files.
- **A button above the prompt** opens the pane in one click and shows how many keys the file has. "minimise" tucks it away into one line under the prompt; `/env show` brings it back, `/env hide` minimises it.

## What it does to your file

- Only the line you change is rewritten. Comments, blank lines, key order and `export` prefixes stay exactly as they were.
- The file is read again before every save, so an edit made somewhere else in the meantime is kept.
- A value is whatever follows `=`, as written. envpeek does not add or strip quotes.

## Privacy

- The mod keeps no value from your file. Its saved state is the file name, the selected key, a status note and whether the button is minimised.
- It never sends anything to the model, a server or a log. It reads and writes the one file you point it at.
- "Show values" puts your secrets on screen, like opening the file would. Mind screen shares.

## Install

envpeek needs a Claude Code build with mod support. It was built and tested on 2.1.288 (the desktop app's Code tab); 2.1.132 does not load it.

From a checkout:

```bash
git clone https://github.com/Oxde/envpeek.git
claude --plugin-dir ./envpeek
```

Or as a plugin, inside a Claude Code session:

```
/plugin marketplace add Oxde/envpeek
/plugin install envpeek
```

## Where it runs

| Surface | Pane | Button above the prompt |
|---|---|---|
| Terminal | yes | yes |
| Desktop app | yes | yes |
| VS Code | yes | yes |
| Mobile | no: the app draws no text field yet | yes |

## Limits

- The strip above the prompt belongs to Claude Code. A mod chooses what sits in it, not how wide it is, and only the buttons in it take a click.
- The minimised hint under the prompt is text. A mod cannot put a button there, so restoring is `/env show`.
- Multi-line values are shown and edited one line at a time.

## Development

The whole mod is `hooks/register.tsx`; its state contract is `types/index.d.ts`.

```bash
claude plugin validate .
claude plugin test .
```

The tests draw the pane and the button on every surface, press and type into them, and check what lands in the file.

## Licence

MIT © oxde
