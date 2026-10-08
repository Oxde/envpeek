/**
 * What the pane remembers between draws. No value from the file is ever kept
 * here: the file is read again on every draw.
 */
export type View = {
  /** the file being edited, relative to the working directory */
  file: string
  /** the key open for editing, or null */
  selected: string | null
  /** values drawn in full instead of masked */
  isRevealed: boolean
  /** the last thing that happened, shown under the list; never contains a value */
  note: string
  /** the button above the prompt is put away; kept across sessions in the mod's store */
  isBandHidden: boolean
  /** bumped after every write so the pane draws the file again */
  rev: number
}

declare module 'claude-code' {
  interface PluginState {
    'envpeek': { view: View }
  }
}
