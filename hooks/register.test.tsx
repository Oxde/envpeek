import { expect, mock, test } from 'claude-code/testing'

import { envFile, findEnvFiles, mask, parse, removeKey, setValue } from './register'

const START = '# service keys\nAPI_KEY=hunter2-value\nexport PORT = 3000\n\nEMPTY=\n'
const PANE = {
  component: 'Pane',
  requestId: 'envpeek',
  props: { title: 'Env', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const
const name = (path: string) => path.split('/').pop() ?? path

test('the text helpers keep everything they are not asked to change', () => {
  expect(parse(START)).toEqual([
    { key: 'API_KEY', value: 'hunter2-value' },
    { key: 'PORT', value: ' 3000' },
    { key: 'EMPTY', value: '' },
  ])
  expect(setValue(START, 'API_KEY', 'new')).toBe('# service keys\nAPI_KEY=new\nexport PORT = 3000\n\nEMPTY=\n')
  expect(setValue(START, 'PORT', '8080')).toBe('# service keys\nAPI_KEY=hunter2-value\nexport PORT =8080\n\nEMPTY=\n')
  expect(setValue(START, 'NEW', '1')).toBe(`${START}NEW=1\n`)
  expect(setValue('A=1', 'B', '2')).toBe('A=1\nB=2\n')
  expect(setValue('', 'A', '1')).toBe('A=1\n')
  expect(removeKey(START, 'PORT')).toBe('# service keys\nAPI_KEY=hunter2-value\n\nEMPTY=\n')
  expect(mask('hunter2-value')).toBe('•••••••••••••')
  expect(mask('')).toBe('(empty)')
})

test('values stay hidden until asked for, and edits land in the file', async ($, on) => {
  const files = new Map<string, string>()
  const links = new Set<string>()
  on('fs.exists', async (_$, e) => ({ value: files.has(name(e.path)) }))
  on('fs.stat', async () => ({ value: { kind: 'file' as const, size: 1, mtimeMs: 0, isLink: links.has('.env') } }))
  on('fs.read', async (_$, e) => {
    const text = files.get(name(e.path))

    if (text === undefined) {
      throw new Error(`ENOENT ${e.path}`)
    }

    return { value: text }
  })
  on('fs.write', async (_$, e) => {
    files.set(name(e.path), e.text)

    return { value: undefined }
  })
  on('session.cwd', async () => ({ value: '/work/shop' }))
  on('fs.list', async () => ({ value: [...files.keys()].map(file => ({ name: file, kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false })) }))

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    files.clear()
    files.set('.env', START)
    const ui = await $.ui.mount({ plugin: 'envpeek', surface, ...PANE })

    // hidden by default: the key is shown, nothing of the value
    expect(await ui.find({ type: 'Text', text: /shop\/\.env/ })).toBeDefined()
    const row = String((await ui.find({ key: 'row-0' }))?.props.label)
    expect(row).toContain('API_KEY')
    expect(row.includes('hunter2')).toBe(false)
    expect(await ui.find({ key: 'value' })).toBeUndefined()

    // select a key, type a new value, Enter saves it in place
    await ui.press({ key: 'row-0' })
    expect((await ui.find({ key: 'value' }))?.props.value).toBe('hunter2-value')
    await ui.input({ key: 'value', text: 'changed' })
    expect(files.get('.env')).toBe('# service keys\nAPI_KEY=changed\nexport PORT = 3000\n\nEMPTY=\n')
    expect(await ui.find({ key: 'value' })).toBeUndefined()

    // add a key, refuse a bad one, delete one
    await ui.input({ key: 'new', text: 'DEBUG=1' })
    expect(files.get('.env')?.endsWith('EMPTY=\nDEBUG=1\n')).toBe(true)
    const before = files.get('.env')
    await ui.input({ key: 'new', text: '1BAD=x' })
    expect(files.get('.env')).toBe(before)
    await ui.press({ key: 'row-1' })
    await ui.press({ key: 'delete' })
    expect(files.get('.env')?.includes('PORT')).toBe(false)

    // show values on request
    await ui.press({ key: 'reveal' })
    expect(String((await ui.find({ key: 'row-0' }))?.props.label)).toContain('changed')
    await ui.press({ key: 'reveal' })
    await ui.unmount()
  }
})

test('on a surface without a text field it says so instead of drawing fields', async $ => {
  const ui = await $.ui.mount({ plugin: 'envpeek', surface: 'mobile', ...PANE })
  expect(await ui.find({ type: 'Text', text: /needs a text field/ })).toBeDefined()
  await ui.unmount()
})

test('only .env files inside the folder can be opened', async ($, on) => {
  expect(envFile('.env')).toBe('.env')
  expect(envFile('.env.local')).toBe('.env.local')
  expect(envFile('apps/web/.env.production')).toBe('apps/web/.env.production')

  for (const bad of ['/tmp/.env', '~/elsewhere/.env', '~/notes.txt', '../.env', 'a/../../.env', './.env', 'notes.txt', '.envrc', '.env/', 'C:\\\\x\\\\.env', '.env.$(rm)', '']) {
    expect(envFile(bad)).toBe(null)
  }

  const opened: string[] = []
  on('ui.open', async (_$, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  const answer = await $.command.run({ command: 'env', args: '~/elsewhere/notes.txt', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(JSON.stringify(answer)).toContain('only opens .env files')
  expect(opened.length).toBe(0)
})

test('a symbolic link is left alone and a pasted line break is refused', async ($, on) => {
  const files = new Map<string, string>([['.env', 'A=1\n']])
  let isLink = true
  on('fs.exists', async () => ({ value: true }))
  on('fs.stat', async () => ({ value: { kind: 'file' as const, size: 1, mtimeMs: 0, isLink } }))
  on('fs.read', async () => ({ value: files.get('.env') ?? '' }))
  on('fs.write', async (_$, e) => {
    files.set('.env', e.text)

    return { value: undefined }
  })
  on('fs.list', async () => ({ value: [] }))
  on('session.cwd', async () => ({ value: '/work/shop' }))

  const linked = await $.ui.mount({ plugin: 'envpeek', surface: 'terminal', ...PANE })
  expect(await linked.find({ type: 'Text', text: /symbolic link/ })).toBeDefined()
  expect(await linked.find({ key: 'new' })).toBeUndefined()
  await linked.unmount()

  isLink = false
  const ui = await $.ui.mount({ plugin: 'envpeek', surface: 'terminal', ...PANE })
  await ui.input({ key: 'new', text: 'B=2\nEVIL=1' })
  expect(files.get('.env')).toBe('A=1\n')
  expect(await ui.find({ type: 'Text', text: /one line/ })).toBeDefined()
  // swapped for a link between the draw and the save: the write is refused
  isLink = true
  await ui.input({ key: 'new', text: 'B=2' })
  expect(files.get('.env')).toBe('A=1\n')
  await ui.unmount()
})

test('a project with frontend and backend folders offers each .env as a choice', async ($, on) => {
  const file = (name: string) => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })
  const dir = (name: string) => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })
  const tree: Record<string, ReturnType<typeof file>[] | ReturnType<typeof dir>[] | (ReturnType<typeof file> | ReturnType<typeof dir>)[]> = {
    '': [file('.env'), file('README.md'), dir('backend'), dir('frontend'), dir('node_modules'), dir('.git'), { ...dir('linked'), isLink: true }],
    backend: [file('.env'), file('.env.test'), file('server.ts')],
    frontend: [file('.env.local'), dir('src')],
    'frontend/src': [file('.env.example'), dir('deep')],
    'frontend/src/deep': [file('.env')],
    node_modules: [file('.env')],
    '.git': [file('.env')],
    linked: [file('.env')],
  }
  const contents: Record<string, string> = { '.env': 'ROOT=1\n', 'backend/.env': 'DB_URL=postgres\nPORT=4000\n' }
  // the engine hands hooks absolute paths; the first one listed is the working folder itself
  let root: string | null = null
  const rel = (path: string) => {
    if (!path.startsWith('/')) {
      return path
    }

    root ??= path

    return path === root ? '' : path.slice(root.length + 1)
  }
  on('fs.list', async (_$, e) => ({ value: tree[rel(e.path)] ?? [] }))
  on('fs.exists', async (_$, e) => ({ value: rel(e.path) in contents }))
  on('fs.stat', async () => ({ value: { kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false } }))
  on('fs.read', async (_$, e) => ({ value: contents[rel(e.path)] ?? '' }))
  on('fs.write', async (_$, e) => {
    contents[rel(e.path)] = e.text

    return { value: undefined }
  })
  on('session.cwd', async () => ({ value: '/work/shop' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))

  // two folders down at most; dependency, hidden and linked folders are not entered
  expect(await findEnvFiles({ fs: { list: async path => tree[path ?? ''] ?? [] } })).toEqual(['.env', 'backend/.env', 'backend/.env.test', 'frontend/.env.local', 'frontend/src/.env.example'])

  await $.command.run({ command: 'env', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  const ui = await $.ui.mount({ plugin: 'envpeek', surface: 'desktop', ...PANE })
  expect(String((await ui.find({ key: 'row-0' }))?.props.label)).toContain('ROOT')
  await ui.select({ key: 'file', value: 'backend/.env' })
  expect(await ui.find({ type: 'Text', text: /shop\/backend\/\.env/ })).toBeDefined()
  expect(String((await ui.find({ key: 'row-0' }))?.props.label)).toContain('DB_URL')
  await ui.press({ key: 'row-1' })
  await ui.input({ key: 'value', text: '5000' })
  expect(contents['backend/.env']).toBe('DB_URL=postgres\nPORT=5000\n')
  expect(contents['.env']).toBe('ROOT=1\n')
  await ui.unmount()
})

test('the button above the prompt opens the pane and names the file', async ($, on) => {
  mock.store(on)
  let hasFile = true
  const opened: string[] = []
  on('fs.exists', async () => ({ value: hasFile }))
  on('fs.read', async () => ({ value: 'A=1\nB=2\n' }))
  on('ui.open', async (_$, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 80, scroll: { offset: 0, bodyRows: 3 }, view: {} } } as const

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    hasFile = true
    const ui = await $.ui.mount({ plugin: 'envpeek', surface, ...BAND })
    expect((await ui.find({ key: 'open-env' }))?.props.label).toBe('.env')
    await ui.press({ key: 'open-env' })
    expect(opened.pop()).toBe('envpeek')
    await ui.unmount()

    hasFile = false
    const none = await $.ui.mount({ plugin: 'envpeek', surface, ...BAND })
    expect((await none.find({ key: 'open-env' }))?.props.label).toBe('+ .env')
    await none.unmount()
  }
})

test('the button can be put away and brought back, and the choice is stored', async ($, on) => {
  mock.store(on)
  on('fs.exists', async () => ({ value: true }))
  on('fs.read', async () => ({ value: 'A=1\n' }))
  const status: (string | undefined)[] = []
  on('ui.status', async (_$, e) => {
    status.push(e.text)

    return { value: undefined }
  })
  // what the engine draws for the band when no mod draws one: nothing of ours
  on('ui.render', async (engine, e) => {
    const { Box } = engine.ui.resolve(e)

    return <Box />
  })
  const run = (args: string) => $.command.run({ command: 'env', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 80, scroll: { offset: 0, bodyRows: 3 }, view: {} } } as const
  const ui = await $.ui.mount({ plugin: 'envpeek', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'open-env' })).toBeDefined()
  await ui.press({ key: 'hide-env' })
  expect(await ui.find({ key: 'open-env' })).toBeUndefined()
  // hidden: a line under the prompt says how to get back
  expect(status.at(-1)).toContain('/env show')
  await run('show')
  expect(await ui.find({ key: 'open-env' })).toBeDefined()
  expect(status.at(-1)).toBeUndefined()
  await run('hide')
  expect(await ui.find({ key: 'open-env' })).toBeUndefined()
  await run('show')
  await ui.unmount()
})

test('a folder without a .env gets one on the first add', async ($, on) => {
  const files = new Map<string, string>()
  const links = new Set<string>()
  on('fs.exists', async (_$, e) => ({ value: files.has(name(e.path)) }))
  on('fs.stat', async () => ({ value: { kind: 'file' as const, size: 1, mtimeMs: 0, isLink: links.has('.env') } }))
  on('fs.read', async (_$, e) => ({ value: files.get(name(e.path)) ?? '' }))
  on('fs.write', async (_$, e) => {
    files.set(name(e.path), e.text)

    return { value: undefined }
  })
  on('session.cwd', async () => ({ value: '/work/shop' }))
  on('fs.list', async () => ({ value: [] }))
  const ui = await $.ui.mount({ plugin: 'envpeek', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /does not exist yet/ })).toBeDefined()
  await ui.input({ key: 'new', text: 'TOKEN=abc' })
  expect(files.get('.env')).toBe('TOKEN=abc\n')
  await ui.unmount()
})
