import { useEffect, useMemo, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { InfoSource } from '@/components/ui/info-source'
import { cn } from '@/lib/utils'
import { t, exerciseNameFor, exerciseNameClass } from '../../lib/i18n.js'
import { EXIDX, exOr } from '../../lib/exercises.js'
import { fmtNum } from '../../lib/format.js'
import { useStore } from '../../store/useStore.js'
import { loadUp } from '../plan/LoadUpBadge'
import { detailOf, draftFor } from './ingest'
import type { CheckinDetail } from './types'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  routineId: string | null
  // A detail already given in this check-in, to reopen as it was.
  initial?: CheckinDetail | null
  // The check-in is already posted, so its session is in the history (editing it).
  posted?: boolean
  // null when every exercise was turned off: the check-in goes without a detail.
  onConfirm: (detail: CheckinDetail | null) => void
}

type Row = { id: string; on: boolean; sets: { w: string; r: string }[] }

// A comma works as the decimal mark, the way a Brazilian keyboard types it.
const parse = (s: string): number => {
  const v = s.trim().replace(',', '.')
  const n = Number(v)
  return v && Number.isFinite(n) && n > 0 ? n : 0
}
const text = (n: number) => (n > 0 ? String(n) : '')

type AppState = { unit?: string } & Parameters<typeof draftFor>[0] & Parameters<typeof loadUp>[0]
type AppStore = { S: AppState }

// The load the next workout of each exercise goes up to (LoadUpBadge's loadUp), shown beside its
// fields. Not when editing a posted check-in: its session is already in the history, and the
// suggestion would then be the one after it. A draft reopened before posting still shows it.
function suggestions(S: AppState, routineId: string | null, posted: boolean): Map<string, number> {
  const out = new Map<string, number>()
  const r = posted || !routineId ? null : (S.routines ?? []).find(x => x.id === routineId)
  for (const cfg of r?.ex ?? []) {
    const up = out.has(cfg.id) ? null : loadUp(S, cfg, r)
    if (up) out.set(cfg.id, up.weight)
  }
  return out
}

// "Detalhar treino" (spec 3.4): the exercises of the routine with last time's load and reps filled in;
// the person changes what was different, turns off what was skipped, and saves.
export default function DetailSheet({ open, onOpenChange, routineId, initial, posted = false, onConfirm }: Props) {
  const unit = useStore((s: AppStore) => s.S.unit) || 'kg'
  const build = (): Row[] => draftFor(useStore.getState().S, routineId, initial)
    .map(e => ({ id: e.id, on: e.on, sets: e.sets.map(s => ({ w: text(s.w), r: text(s.r) })) }))
  const [rows, setRows] = useState<Row[]>(build)
  // Each opening starts from the routine and the detail as they are now.
  useEffect(() => { if (open) setRows(build()) }, [open])
  const suggested = useMemo(() => suggestions(useStore.getState().S, routineId, posted), [open, routineId, posted])

  const change = (i: number, fn: (r: Row) => Row) => setRows(rs => rs.map((r, k) => (k === i ? fn(r) : r)))
  const setField = (i: number, j: number, key: 'w' | 'r', v: string) =>
    change(i, r => ({ ...r, sets: r.sets.map((s, k) => (k === j ? { ...s, [key]: v } : s)) }))
  const addSet = (i: number) => change(i, r => ({ ...r, sets: [...r.sets, { ...(r.sets.at(-1) ?? { w: '', r: '' }) }] }))
  const removeSet = (i: number, j: number) => change(i, r => ({ ...r, sets: r.sets.filter((_, k) => k !== j) }))

  const save = () => {
    onConfirm(detailOf(rows.map(r => ({ id: r.id, on: r.on, sets: r.sets.map(s => ({ w: parse(s.w), r: Math.round(parse(s.r)) })) })), unit === 'lb' ? 'lb' : 'kg'))
    onOpenChange(false)
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="h-[92dvh] max-h-[92dvh]">
        <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
          <DrawerTitle className="text-xl">{t('Detail workout')}</DrawerTitle>
          <DrawerDescription>{t('Loads and reps come from last time. Change only what was different.')}</DrawerDescription>
        </DrawerHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          {rows.length === 0 && (
            <p className="rounded-2xl bg-card p-4 text-sm text-muted-foreground">{t('This routine has no exercises with weight and reps.')}</p>
          )}
          {rows.map((row, i) => {
            const ex = exOr(row.id)
            const nameId = `detail-ex-${i}`
            const hintId = `detail-up-${i}`
            const up = row.on ? suggested.get(row.id) : undefined
            return (
              <section key={row.id} role="group" aria-labelledby={nameId} className="flex flex-col gap-2 rounded-2xl bg-card p-3">
                <div className="flex items-center gap-3">
                <button type="button" role="checkbox" aria-checked={row.on} onClick={() => change(i, r => ({ ...r, on: !r.on }))}
                  className="flex min-h-11 flex-1 items-center gap-3 rounded-xl text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                  <span aria-hidden className={cn('grid size-6 shrink-0 place-items-center rounded-md border', row.on ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>
                    {row.on && <Check className="size-4" />}
                  </span>
                  <span id={nameId} className={cn('flex-1 text-[15px] font-medium', exerciseNameClass((EXIDX as Record<string, unknown>)[row.id]), !row.on && 'text-muted-foreground line-through')}>
                    {exerciseNameFor(ex)}
                  </span>
                </button>
                {up !== undefined && (
                  <span className="inline-flex shrink-0 items-center">
                    <span id={hintId} className="text-sm font-medium tabular-nums text-primary">{t('suggested {0}', `${fmtNum(up)} ${unit}`)}</span>
                    {/* the same source as the load badge on the routine list */}
                    <InfoSource refs={['plotkin2022']} label={t('Why raise the load')}
                      note={t('You did every rep last time, so the load can go up.')} />
                  </span>
                )}
                </div>
                {row.on && (
                  <>
                    <ol className="flex list-none flex-col gap-2 p-0">
                      {row.sets.map((s, j) => {
                        const set = t('Set {0}', j + 1)
                        return (
                          <li key={j} className="flex items-center gap-2">
                            <span className="w-16 shrink-0 text-sm tabular-nums text-muted-foreground">{set}</span>
                            <Input value={s.w} inputMode="decimal" autoComplete="off" aria-label={`${set} · ${t('Weight ({0})', unit)}`}
                              aria-describedby={up !== undefined ? hintId : undefined}
                              placeholder={unit} onChange={e => setField(i, j, 'w', e.target.value)}
                              className="h-11 flex-1 font-mono text-[15px] tabular-nums" />
                            <Input value={s.r} inputMode="numeric" autoComplete="off" aria-label={`${set} · ${t('Reps')}`}
                              placeholder={t('Reps')} onChange={e => setField(i, j, 'r', e.target.value)}
                              className="h-11 flex-1 font-mono text-[15px] tabular-nums" />
                            <Button variant="ghost" size="icon" className="size-11 shrink-0 rounded-xl" aria-label={t('Remove set')} onClick={() => removeSet(i, j)}>
                              <X aria-hidden className="size-4" />
                            </Button>
                          </li>
                        )
                      })}
                    </ol>
                    <Button variant="secondary" className="h-11 gap-2 self-start rounded-xl" onClick={() => addSet(i)}>
                      <Plus aria-hidden className="size-4" />{t('Add set')}
                    </Button>
                  </>
                )}
              </section>
            )
          })}
        </div>

        <DrawerFooter className="border-t border-border pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Button className="h-12 rounded-2xl text-[15px] font-semibold" disabled={rows.length === 0} onClick={save}>{t('Save')}</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
