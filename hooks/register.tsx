import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { View } from '../types'

const PANE = 'envpeek'
const START: View = { file: '.env', found: [], selected: null, isRevealed: false, isBandHidden: false, note: '', rev: 0 }
const HIDDEN = 'bandHidden'
/** What stays on screen while the button is hidden: one dim line under the prompt. */
const hint = (file: string) => `${file} · /env to edit · /env show for the button`
const view = atom({ plugin: 'envpeek', key: 'view' } as const, START)

/** `KEY=value`, with an optional `export ` in front; comments and blank lines are not entries. */
const LINE = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_.-]*)(\s*=)(.*)$/
const KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/
const ENV_FILE = /^\.env(\.[A-Za-z0-9_-]+)*$/

/**
 * The file a `/env <name>` may open, or null: a `.env` file (`.env`, `.env.local`) inside the
 * working folder, by a relative path with no `..`. Anything else is refused, so the pane can never
 * be pointed at a key file, a shell profile or a path outside the project.
 */
export function envFile(asked: string): string | null {
  if (asked === '' || asked.startsWith('/') || asked.startsWith('~') || asked.includes('\\') || asked.includes('\0')) {
    return null
  }

  const parts = asked.split('/')

  if (parts.some(part => part === '' || part === '.' || part === '..')) {
    return null
  }

  return ENV_FILE.test(parts.at(-1) ?? '') ? asked : null
}

export type Entry = { key: string; value: string }

/** The entries of a .env text, in file order. The value is everything after `=`, as written. */
export function parse(text: string): Entry[] {
  const out: Entry[] = []

  for (const line of text.split('\n')) {
    const m = LINE.exec(line.replace(/\r$/, ''))

    if (m && !line.trimStart().startsWith('#')) {
      out.push({ key: m[2] ?? '', value: m[4] ?? '' })
    }
  }

  return out
}

/**
 * The text with `key` set to `value`: its own line rewritten in place (comments,
 * order and every other line untouched), or a new line at the end when the
 * key is not there yet.
 */
export function setValue(text: string, key: string, value: string): string {
  const lines = text.split('\n')
  const at = lines.findIndex(line => LINE.exec(line.replace(/\r$/, ''))?.[2] === key && !line.trimStart().startsWith('#'))

  if (at >= 0) {
    const m = LINE.exec((lines[at] ?? '').replace(/\r$/, ''))
    lines[at] = `${m?.[1] ?? ''}${key}${m?.[3] ?? '='}${value}`

    return lines.join('\n')
  }

  const body = text === '' || text.endsWith('\n') ? text : `${text}\n`

  return `${body}${key}=${value}\n`
}

/** The text without `key`'s line. */
export function removeKey(text: string, key: string): string {
  return text
    .split('\n')
    .filter(line => !(LINE.exec(line.replace(/\r$/, ''))?.[2] === key && !line.trimStart().startsWith('#')))
    .join('\n')
}

/** A value as the list shows it while hidden: its length in dots, nothing of its content. */
export function mask(value: string): string {
  return value === '' ? '(empty)' : '•'.repeat(Math.min(value.length, 16))
}

/** Folders that never hold a project's own .env and are slow or pointless to walk. */
const SKIP = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'vendor', 'coverage', 'venv', '__pycache__'])
const MAX_FOLDERS = 80

type Lister = { fs: { list: (path?: string) => Promise<{ name: string; kind: string; isLink: boolean }[]> } }

/**
 * Every .env file in the working folder and up to two folders below it (`backend/.env`,
 * `apps/web/.env.local`), as relative paths: the top folder's first, then by path. Hidden folders,
 * dependency and build folders and symbolic links are not entered, and the walk stops after
 * MAX_FOLDERS folders, so a huge repository cannot stall the pane.
 */
export async function findEnvFiles($: Lister): Promise<string[]> {
  const found: string[] = []
  let listed = 0
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (listed >= MAX_FOLDERS) {
      return
    }

    listed += 1
    const entries = await $.fs.list(dir === '' ? undefined : dir).catch(() => [])

    for (const en of entries) {
      const path = dir === '' ? en.name : `${dir}/${en.name}`

      if (en.kind === 'file' && !en.isLink && envFile(path) !== null) {
        found.push(path)
      } else if (en.kind === 'dir' && !en.isLink && depth < 2 && !en.name.startsWith('.') && !SKIP.has(en.name)) {
        await walk(path, depth + 1)
      }
    }
  }
  await walk('', 0)
  const depth = (path: string) => path.split('/').length

  return found.sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))
}

/**
 * Why an existing path will not be opened, or null when it is an ordinary file: a symbolic link
 * could lead outside the folder, and a directory or device is not a file to edit.
 */
const problem = async ($: { fs: { stat: (path: string) => Promise<{ kind: string; isLink: boolean }> } }, file: string): Promise<string | null> => {
  const stat = await $.fs.stat(file)

  if (stat.isLink) {
    return `${file} is a symbolic link. envpeek edits only real files in this folder, so it leaves this one alone.`
  }

  return stat.kind === 'file' ? null : `${file} is not a regular file.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'env',
      description: 'Edit the .env file of this folder in a pane (/env .env.local for another file, /env hide or /env show for the button)',
    })
    // whether the button is put away outlives the session
    const isBandHidden = (await $.store.get(HIDDEN)) === true
    await update($, view, v => ({ ...v, isBandHidden }))
    $.ui.status(isBandHidden ? hint((await read($, view)).file) : undefined)

    return next(e)
  })

  on('command.run', { command: 'env' }, async ($, e) => {
    const asked = e.args.trim()

    if (asked === 'hide' || asked === 'show') {
      await $.store.set(HIDDEN, asked === 'hide')
      await update($, view, v => ({ ...v, isBandHidden: asked === 'hide' }))
      $.ui.status(asked === 'hide' ? hint((await read($, view)).file) : undefined)

      return { text: asked === 'hide' ? 'The .env button is hidden; a line under the prompt says how to get it back. /env still opens the editor, /env show brings the button back.' : 'The .env button is back above the prompt.' }
    }

    const file = asked === '' ? (await read($, view)).file : envFile(asked)

    if (file === null) {
      return { text: 'envpeek only opens .env files inside this folder, such as .env or .env.local. Nothing was opened.' }
    }

    // values start hidden every time the pane is opened, and the list of .env files is looked up afresh
    const found = await findEnvFiles($)
    await update($, view, v => ({ ...v, file, found, selected: null, isRevealed: false, note: '', rev: v.rev + 1 }))
    await $.ui.open({ id: PANE, title: 'Env', focus: true })

    return { text: `Editing ${file} in the Env pane.` }
  })

  // One small button above the prompt: the way in without typing the command.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const v = await read($, view)

    if (v.isBandHidden) {
      return next(e)
    }

    const { Box, Button } = $.ui.resolve(e)
    // only whether the file is there: its contents are read while the pane is open, never here
    const hasFile = await $.fs.exists(v.file)

    // The row is the app's and spans the prompt's width whatever sits in it, so it is laid out as
    // a row on purpose: the way in and what it leads to on the left, the way to put it away on
    // the right. Only the two buttons take a click; the mod cannot make the rest of the row one.
    return (
      <Box width="100%" justifyContent="space-between" alignItems="center">
        <Button
          key="open-env"
          label={hasFile ? v.file : `+ ${v.file}`}
          onPress={async () => {
            const found = await findEnvFiles($)
            await update($, view, s => ({ ...s, found, selected: null, isRevealed: false, note: '', rev: s.rev + 1 }))
            await $.ui.open({ id: PANE, title: 'Env', focus: true })
          }}
        />
        <Button
          plain
          dimColor
          key="hide-env"
          label="hide"
          onPress={async () => {
            await $.store.set(HIDDEN, true)
            await update($, view, s => ({ ...s, isBandHidden: true }))
            $.ui.status(hint(v.file))
          }}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface === 'mobile') {
      // the mobile app draws no text field yet, so there is nothing to edit with
      const { Box, Text } = $.ui.resolve(e)

      return (
        <Box>
          <Text dimColor>The env editor needs a text field. Open it in the terminal, the desktop app or VS Code.</Text>
        </Box>
      )
    }

    const { Box, Text, Button, Input, Select } = $.ui.resolve(e)
    const v = await read($, view)
    const hasFile = await $.fs.exists(v.file)
    const refusal = envFile(v.file) === null ? 'envpeek only opens .env files inside this folder.' : hasFile ? await problem($, v.file) : null

    if (refusal !== null) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>{v.file}</Text>
          <Text>{refusal}</Text>
          <Button key="close" role="dismiss" label="Close" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      )
    }

    const text = hasFile ? await $.fs.read(v.file) : ''
    const entries = parse(text)
    const files = v.found.includes(v.file) ? v.found : [v.file, ...v.found]
    const open = entries.find(en => en.key === v.selected)
    const folder = (await $.session.cwd()).split('/').filter(Boolean).pop() ?? ''

    // Every write reads the file again first, so an edit made elsewhere in the meantime is kept.
    const write = async (change: (now: string) => string, note: string, selected: string | null) => {
      const isThere = await $.fs.exists(v.file)
      const blocked = isThere ? await problem($, v.file) : null

      // checked again at the moment of writing: the file may have been swapped since the draw
      if (blocked !== null) {
        await say(blocked)

        return
      }

      const now = isThere ? await $.fs.read(v.file) : ''
      await $.fs.write(v.file, change(now))
      await update($, view, s => ({ ...s, note, selected, rev: s.rev + 1 }))
    }
    const say = (note: string) => update($, view, s => ({ ...s, note }))

    // one entry is one line: a pasted line break would smuggle a second key into the file
    const save = async (key: string, value: string, note: string) => {
      if (/[\r\n]/.test(value)) {
        await say('A value is one line. Remove the line break and save again.')

        return
      }

      await write(now => setValue(now, key, value), note, null)
    }

    const add = async (line: string) => {
      const eq = line.indexOf('=')
      const key = (eq < 0 ? line : line.slice(0, eq)).trim()

      if (!KEY.test(key)) {
        await say('A new entry is KEY=value. Keys are letters, digits and _ and cannot start with a digit.')

        return
      }

      await save(key, eq < 0 ? '' : line.slice(eq + 1), `${entries.some(en => en.key === key) ? 'Saved' : 'Added'} ${key}.`)
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>
            {folder}/{v.file}
          </Text>
          <Text dimColor>
            {hasFile ? `${entries.length} ${entries.length === 1 ? 'key' : 'keys'}` : 'This file does not exist yet. Adding a key creates it.'}
            {hasFile && !v.isRevealed ? ' · values hidden' : ''}
          </Text>
        </Box>

        {files.length > 1 && (
          <Select
            key="file"
            label="Folder / file"
            value={v.file}
            options={files.map(name => ({ value: name, label: name }))}
            onSelect={name => update($, view, s => ({ ...s, file: envFile(name) ?? s.file, selected: null, isRevealed: false, note: '' }))}
          />
        )}

        <Box flexDirection="column">
          {entries.map((en, i) => (
            <Button
              plain
              key={`row-${i}`}
              label={`${en.key === v.selected ? '›' : ' '} ${en.key} = ${v.isRevealed ? en.value : mask(en.value)}`}
              onPress={() => update($, view, s => ({ ...s, selected: s.selected === en.key ? null : en.key, note: '' }))}
            />
          ))}
        </Box>

        {open && (
          <Box flexDirection="column">
            <Input
              key="value"
              label={`${open.key} =`}
              value={open.value}
              submitLabel="save"
              autoFocus
              onSubmit={value => save(open.key, value, `Saved ${open.key}.`)}
            />
            <Box gap={2}>
              <Button key="delete" label={`Delete ${open.key}`} onPress={() => write(now => removeKey(now, open.key), `Deleted ${open.key}.`, null)} />
              <Button key="cancel" label="Cancel" onPress={() => update($, view, s => ({ ...s, selected: null }))} />
            </Box>
          </Box>
        )}

        <Input key="new" label="Add" placeholder="KEY=value" submitLabel="add" onSubmit={add} />

        <Box gap={2} flexWrap="wrap">
          <Button key="reveal" label={v.isRevealed ? 'Hide values' : 'Show values'} onPress={() => update($, view, s => ({ ...s, isRevealed: !s.isRevealed }))} />
          <Button
            key="reload"
            label="Reload"
            onPress={async () => {
              const found = await findEnvFiles($)
              await update($, view, s => ({ ...s, found, note: 'Read the file again and looked for .env files.', rev: s.rev + 1 }))
            }}
          />
          <Button
            key="band"
            label={v.isBandHidden ? 'Show the button above the prompt' : 'Hide the button above the prompt'}
            onPress={async () => {
              await $.store.set(HIDDEN, !v.isBandHidden)
              await update($, view, s => ({ ...s, isBandHidden: !v.isBandHidden }))
              $.ui.status(v.isBandHidden ? undefined : hint(v.file))
            }}
          />
          <Button key="close" role="dismiss" label="Close" onPress={() => $.ui.close({ id: PANE })} />
        </Box>

        {files.length <= 1 && <Text dimColor>A .env in a subfolder shows up here as a choice. To start one: /env backend/.env</Text>}
        {v.note !== '' && <Text dimColor>{v.note}</Text>}
      </Box>
    )
  })
}
