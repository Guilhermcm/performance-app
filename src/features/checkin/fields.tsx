import { useId, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

// The limits of a check-in (0017_checkins.sql) and the fields that enforce them, shared by the new
// check-in (CheckinFlow) and the edit of a posted one (EditCheckinSheet).
export const TITLE_MAX = 60
export const TEXT_MAX = 500
export const DURATION_MAX = 600

export function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-semibold">{label}</legend>
      {children}
    </fieldset>
  )
}

export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick}
      className={cn('min-h-11 rounded-full border px-4 text-sm font-medium outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none',
        on ? 'border-primary bg-primary/15 text-foreground' : 'border-border bg-card text-muted-foreground')}>
      {children}
    </button>
  )
}

export function Choice({ on, onClick, icon, children }: { on: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick}
      className={cn('flex min-h-12 items-center justify-center gap-2 rounded-2xl border px-3 text-[15px] font-medium outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none',
        on ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-card text-muted-foreground')}>
      {icon}{children}
      {on && <Check aria-hidden className="size-4" />}
    </button>
  )
}

// A text field with its limit and a counter; typing past the limit stops at it.
export function Counted({ id, label, hint, value, max, multiline, onChange }:
  { id: string; label: string; hint?: string; value: string; max: number; multiline?: boolean; onChange: (v: string) => void }) {
  const countId = useId()
  const described = hint ? `${id}-hint ${countId}` : countId
  const set = (v: string) => onChange(v.slice(0, max))
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold">{label}</label>
        <span id={countId} className="font-mono text-xs tabular-nums text-muted-foreground">{`${value.length}/${max}`}</span>
      </div>
      {hint && <p id={`${id}-hint`} className="-mt-1 text-xs text-muted-foreground">{hint}</p>}
      {multiline ? (
        <textarea id={id} value={value} maxLength={max} rows={3} aria-describedby={described} onChange={e => set(e.target.value)}
          className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-[15px] shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30" />
      ) : (
        <Input id={id} value={value} maxLength={max} autoComplete="off" aria-describedby={described} onChange={e => set(e.target.value)} className="h-12 text-[15px]" />
      )}
    </div>
  )
}
