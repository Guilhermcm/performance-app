// "Ajustar" in the run check-in (plan decision 1): the planned workout's items, in the plan's own
// format, with the zone and the minutes of each block and the count of each repeat to change. No
// item is added or taken away, so the list stays within the 12 items the database takes.
//
// A field out of range says why under it and still goes out as typed (an empty field as NaN), so
// checkRunDetail refuses what the person sees as wrong and the post waits for it.
import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { t } from '../../lib/i18n.js'
import { zoneName } from './labels'
import type { Block, Item, Zone } from './types'

const ZONES: Zone[] = ['easy', 'moderate', 'hard', 'walk']
const inRange = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi
// Digits only; an empty field is no number.
const digits = (text: string, max: number) => {
  const d = text.replace(/\D/g, '').slice(0, max)
  return d === '' ? NaN : Number(d)
}
const shown = (n: number) => (Number.isFinite(n) ? String(n) : '')

export default function BlocksEditor({ items, onChange }: { items: Item[]; onChange(items: Item[]): void }) {
  const put = (i: number, item: Item) => onChange(items.map((it, k) => (k === i ? item : it)))
  return (
    <div className="flex flex-col gap-3">
      {items.map((item, i) => (
        'repeat' in item
          ? <RepeatPart key={i} n={i + 1} item={item} onChange={next => put(i, next)} />
          : <Part key={i} name={t('Part {0}', i + 1)}><BlockRow block={item} onChange={next => put(i, next)} /></Part>
      ))}
    </div>
  )
}

function Part({ name, nested, children }: { name: string; nested?: boolean; children: ReactNode }) {
  const id = useId()
  return (
    <div role="group" aria-labelledby={id} className={cn('flex flex-col gap-2', !nested && 'rounded-xl border border-border p-3')}>
      <p id={id} className="text-xs font-medium text-muted-foreground">{name}</p>
      {children}
    </div>
  )
}

function RepeatPart({ n, item, onChange }: { n: number; item: { repeat: number; blocks: Block[] }; onChange(item: Item): void }) {
  const id = useId()
  const ok = inRange(item.repeat, 2, 20)
  return (
    <Part name={t('Part {0}', n)}>
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="sr-only">{t('Repeats')}</label>
        <Input id={id} value={shown(item.repeat)} inputMode="numeric" autoComplete="off"
          aria-invalid={ok ? undefined : true} aria-describedby={ok ? undefined : id + '-note'}
          onChange={e => onChange({ ...item, repeat: digits(e.target.value, 2) })}
          className="h-11 w-16 font-mono text-[15px] tabular-nums" />
        <span aria-hidden className="text-[15px] text-muted-foreground">×</span>
      </div>
      {!ok && <p id={id + '-note'} className="text-xs text-destructive">{t('Repeats go from 2 to 20.')}</p>}
      <div className="flex flex-col gap-3 border-s-2 border-border ps-3">
        {item.blocks.map((b, k) => (
          <Part key={k} nested name={t('Part {0}', `${n}.${k + 1}`)}>
            <BlockRow block={b} onChange={next => onChange({ ...item, blocks: item.blocks.map((x, j) => (j === k ? next : x)) })} />
          </Part>
        ))}
      </div>
    </Part>
  )
}

function BlockRow({ block, onChange }: { block: Block; onChange(block: Block): void }) {
  const id = useId()
  const ok = inRange(block.min, 1, 300)
  return (
    <>
      <div className="flex items-center gap-2">
        <label htmlFor={id + '-zone'} className="sr-only">{t('Zone')}</label>
        <select id={id + '-zone'} value={block.zone} onChange={e => onChange({ ...block, zone: e.target.value as Zone })}
          className="h-11 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 text-[15px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30">
          {ZONES.map(z => <option key={z} value={z}>{zoneName(z)}</option>)}
        </select>
        <label htmlFor={id + '-min'} className="sr-only">{t('Minutes')}</label>
        <Input id={id + '-min'} value={shown(block.min)} inputMode="numeric" autoComplete="off"
          aria-invalid={ok ? undefined : true} aria-describedby={ok ? undefined : id + '-note'}
          onChange={e => onChange({ ...block, min: digits(e.target.value, 3) })}
          className="h-11 w-20 font-mono text-[15px] tabular-nums" />
        <span aria-hidden className="text-sm text-muted-foreground">{t('min')}</span>
      </div>
      {!ok && <p id={id + '-note'} className="text-xs text-destructive">{t('Minutes go from 1 to 300.')}</p>}
    </>
  )
}
