import type { ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

// What a number field holds: null when empty, NaN when it is not a number. A comma works as the
// decimal mark, the way a Brazilian keyboard types it.
export function parseAmount(s: string): number | null {
  const v = s.trim().replace(',', '.')
  if (!v) return null
  return /^\d*\.?\d*$/.test(v) ? Number(v) : NaN
}

// The value as the field shows it when a sheet opens.
export const amountText = (n: number | null | undefined): string => (n == null ? '' : String(n))

type FieldProps = {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  error?: string | null
  hint?: string
  numeric?: boolean
  placeholder?: string
  maxLength?: number
  className?: string
  trailing?: ReactNode
}

// A labelled input with its error under it; numbers open the decimal keypad.
export function Field({ id, label, value, onChange, error, hint, numeric, placeholder, maxLength, className, trailing }: FieldProps) {
  const note = error || hint
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id} className="text-sm text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <Input id={id} value={value} placeholder={placeholder} maxLength={maxLength}
          inputMode={numeric ? 'decimal' : undefined} autoComplete="off"
          aria-invalid={error ? true : undefined} aria-describedby={note ? id + '-note' : undefined}
          onChange={e => onChange(e.target.value)}
          className={cn('h-12 text-[15px]', numeric && 'font-mono tabular-nums')} />
        {trailing}
      </div>
      {note && <p id={id + '-note'} className={cn('text-xs leading-snug', error ? 'text-destructive' : 'text-muted-foreground')}>{note}</p>}
    </div>
  )
}
