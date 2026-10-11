import { useId, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'

// The shortcuts of spec 4.2, first in the picker.
export const QUICK_EMOJIS = ['💪', '🔥', '👏', '😂', '😮'] as const

// A short list of common emojis by theme, instead of a full emoji package: anything else can be
// pasted. Emojis from Unicode 13 and older, so they show on phones a few years old too.
const GROUPS: { key: string; label: () => string; emojis: string[] }[] = [
  { key: 'faces', label: () => t('Faces'), emojis: ['😀', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😋', '😜', '🤪', '😎', '🤓', '🥳', '😏', '😮', '😲', '😳', '🥵', '🥶', '😱', '😤', '😭', '😴', '🤯', '🤔', '🙃', '😬', '🥲', '🙈'] },
  { key: 'gestures', label: () => t('Gestures'), emojis: ['👏', '🙌', '👍', '👎', '👊', '✊', '🤛', '🤜', '🤝', '🙏', '💪', '🦾', '🦵', '✌️', '🤘', '🤙', '👌', '👋', '☝️', '👀', '🧠'] },
  { key: 'sports', label: () => t('Sports'), emojis: ['🏋️', '🤸', '🧘', '🏃', '🚴', '🏊', '⛹️', '🤾', '🧗', '🥊', '🥋', '⚽', '🏀', '🏐', '🎾', '🏈', '⚾', '🏓', '🏸', '🛹', '⛳', '🏆', '🥇', '🥈', '🥉', '🏅', '🎯', '⏱️', '👟'] },
  { key: 'food', label: () => t('Food'), emojis: ['🍎', '🍌', '🍓', '🍉', '🥑', '🥦', '🥕', '🍗', '🥩', '🍳', '🥚', '🍚', '🍝', '🍕', '🍔', '🌮', '🥗', '🍣', '🥛', '☕', '🧃', '💧', '🍫', '🍩', '🍪', '🍦', '🍺', '🥤'] },
  { key: 'nature', label: () => t('Nature'), emojis: ['🔥', '⚡', '🌟', '✨', '☀️', '🌈', '🌊', '🌙', '⛰️', '🌳', '🌸', '🌻', '🍀', '🐐', '🦁', '🐯', '🐻', '🐺', '🦍', '🦄', '🐢', '🐇', '🐝', '🦋'] },
  { key: 'symbols', label: () => t('Symbols'), emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💯', '✅', '✔️', '❗', '‼️', '❓', '💥', '💫', '💤', '🎉', '🎊', '🚀', '👑', '💎', '🔝', '🆙', '📈', '⬆️'] }
]

// The server keeps an emoji of 1 to 16 bytes (checkin_reactions.emoji).
const MAX_BYTES = 16
const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u

// Whether a pasted text is one emoji the server takes: one grapheme (a skin tone, a flag or a
// keycap is still one), that is an emoji, and fits in 16 bytes.
export function emojiProblem(text: string): null | 'not_one' | 'too_long' {
  const s = text.trim()
  if (!s) return 'not_one'
  const parts = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)]
  if (parts.length !== 1 || !PICTOGRAPH.test(s)) return 'not_one'
  return new TextEncoder().encode(s).length > MAX_BYTES ? 'too_long' : null
}

const FULL_TEXT = () => t('You already left 10 reactions here. Remove one to add another.')

// Picks one emoji. `chosen`: the ones I already left on the post (picking one again takes it back).
// `full`: I am at 10, so only those can be picked.
export function EmojiPicker({ onPick, chosen = [], full = false }: { onPick: (emoji: string) => void; chosen?: readonly string[]; full?: boolean }) {
  const pasteId = useId()
  const errorId = useId()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const mine = new Set(chosen)
  const blocked = (e: string) => full && !mine.has(e)

  const submit = (ev: FormEvent) => {
    ev.preventDefault()
    const problem = emojiProblem(text)
    if (problem) { setError(problem === 'too_long' ? t('This emoji doesn’t work here. Try another one.') : t('Paste a single emoji.')); return }
    const e = text.trim()
    if (blocked(e)) { setError(FULL_TEXT()); return }
    setError(null)
    setText('')
    onPick(e)
  }

  const cell = (e: string, big = false) => (
    <button key={e} type="button" aria-pressed={mine.has(e)} disabled={blocked(e)} onClick={() => onPick(e)}
      className={cn('grid place-items-center rounded-xl outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-35 motion-reduce:transition-none',
        big ? 'size-12 text-[26px]' : 'size-11 text-2xl',
        mine.has(e) ? 'bg-primary/20 ring-1 ring-primary' : 'hover:bg-secondary active:bg-secondary')}>
      {e}
    </button>
  )

  return (
    <div className="flex flex-col gap-4">
      {full && <p role="status" className="rounded-xl bg-secondary/70 px-3 py-2 text-sm leading-snug">{FULL_TEXT()}</p>}
      <div role="group" aria-label={t('Quick reactions')} className="flex justify-between gap-1">
        {QUICK_EMOJIS.map(e => cell(e, true))}
      </div>
      <form onSubmit={submit} className="flex flex-col gap-1.5" noValidate>
        <label htmlFor={pasteId} className="text-sm font-semibold">{t('Paste any emoji')}</label>
        <div className="flex gap-2">
          <Input id={pasteId} value={text} autoComplete="off" enterKeyHint="done" className="h-11 flex-1 text-xl"
            aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
            onChange={e => { setText(e.target.value); setError(null) }} />
          <Button type="submit" variant="outline" className="h-11 rounded-xl px-4">{t('Use')}</Button>
        </div>
        {error && <p id={errorId} className="text-sm text-destructive">{error}</p>}
      </form>
      {GROUPS.map(g => (
        <section key={g.key} role="group" aria-label={g.label()} className="flex flex-col gap-1.5">
          <h3 aria-hidden className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{g.label()}</h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-0.5">{g.emojis.map(e => cell(e))}</div>
        </section>
      ))}
    </div>
  )
}
