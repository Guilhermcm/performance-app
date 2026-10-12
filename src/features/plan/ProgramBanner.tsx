// The strip at the top of the Plan after a program is applied (spec §4.5): its name, Undo and a
// close button. It goes away when closed or when the plan is edited (S.program.dismissed, set by
// the store on any routine or week edit). After an Undo, if a sync brings back a routine it
// removed, the strip says so instead.
import { Layers, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t } from '../../lib/i18n.js'
import { useStore } from '../../store/useStore.js'
import { canUndo, undoAppliedProgram, useUndoneRoutines } from './program-actions'
import { programCopy } from './program-copy'
import type { PlanState } from './programs'

type AppStore = { S: PlanState; update(fn: (s: PlanState) => void): void }

const BOX = 'mb-3.5 flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-card-foreground'

export function ProgramBanner() {
  const S = useStore((s: AppStore) => s.S)
  const update = useStore((s: AppStore) => s.update)
  const undone = useUndoneRoutines(s => s.ids)
  const clear = useUndoneRoutines(s => s.clear)
  const program = S.program

  if (program && canUndo(S)) {
    return (
      <section aria-label={t('Your program')} className={BOX}>
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary"><Layers className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{t('Your program')}</p>
          <p className="truncate text-[15px] font-semibold">{programCopy(program.id).name}</p>
        </div>
        <Button variant="outline" className="h-11 shrink-0 rounded-xl" onClick={() => undoAppliedProgram(program.appliedAt)}>{t('Undo')}</Button>
        <Button variant="ghost" size="icon" className="size-11 shrink-0 rounded-full" aria-label={t('Close')}
          onClick={() => update(s => { if (s.program) s.program.dismissed = true })}>
          <X aria-hidden className="size-5" />
        </Button>
      </section>
    )
  }

  const back = undone.filter(id => (S.routines ?? []).some(r => r.id === id))
  if (!back.length) return null
  return (
    <div role="status" className={BOX}>
      <p className="min-w-0 flex-1 text-sm leading-snug">{t('Routines removed by Undo came back from another device. Delete them in the list if you don’t want them.')}</p>
      <Button variant="ghost" size="icon" className="size-11 shrink-0 rounded-full" aria-label={t('Close')} onClick={clear}>
        <X aria-hidden className="size-5" />
      </Button>
    </div>
  )
}
