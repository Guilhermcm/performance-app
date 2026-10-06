import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { CloudOff, PenLine, Plus, RefreshCw, ScanBarcode, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useOnline } from '@/lib/use-online'
import { t } from '../../lib/i18n.js'
import { normalize, searchLocal, type SearchSection } from './search'
import { loadTaco } from './taco'
import { searchOff } from './off-api'
import { lookupBarcode } from './barcode'
import { keyOf, useNutrition } from './useNutrition'
import { MEAL_LABEL, fmtNumber } from './labels'
import PortionSheet from './PortionSheet'
import QuickAddSheet from './QuickAddSheet'
import CustomFoodSheet from './CustomFoodSheet'
import BarcodeScanner from './BarcodeScanner'
import type { FoodItem, Meal, UserFood } from './types'

const OFF_MIN_LETTERS = 3
const OFF_DELAY_MS = 600
const EMPTY_RECENTS = 10

type Props = { day: string; meal: Meal; open: boolean; onOpenChange: (open: boolean) => void }
type Off = { state: 'idle' | 'waiting' | 'done' | 'rate_limited' | 'offline' | 'failed'; items: FoodItem[] }

const TITLE: Record<SearchSection['key'], () => string> = {
  recent: () => t('Recent'),
  favorite: () => t('Favorites'),
  mine: () => t('My foods'),
  taco: () => t('Food table'),
}

// Before anything is typed: the latest foods and the favourites, each food once.
function startSections(recents: FoodItem[], foods: UserFood[]): SearchSection[] {
  const seen = new Set<string>()
  const once = (items: FoodItem[]) => items.filter(i => { const k = keyOf(i); if (seen.has(k)) return false; seen.add(k); return true })
  const out: SearchSection[] = [
    { key: 'recent', items: once(recents.slice(0, EMPTY_RECENTS)) },
    { key: 'favorite', items: once(foods.filter(f => f.favorite)) },
  ]
  return out.filter(s => s.items.length)
}

// The food search for one meal: a field, the barcode reader, the local sections (recent,
// favourites, own foods, TACO) as you type and Open Food Facts after a pause, with quick add and
// create food at the bottom. Picking a food closes the search and opens its portion; the other
// sheets live here too, so the screen only opens and closes this one.
export default function FoodSearchSheet({ day, meal, open, onOpenChange }: Props) {
  const online = useOnline()
  const foods = useNutrition(s => s.foods)
  const logs = useNutrition(s => s.logs)
  const recents = useMemo(() => useNutrition.getState().recents(), [logs])
  const [q, setQ] = useState('')
  const [taco, setTaco] = useState<FoodItem[]>([])
  const [off, setOff] = useState<Off>({ state: 'idle', items: [] })
  const [retry, setRetry] = useState(0)

  const [portion, setPortion] = useState<FoodItem | null>(null)
  const [portionOpen, setPortionOpen] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createCode, setCreateCode] = useState<string | undefined>()
  const [scanOpen, setScanOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    setQ('')
    let live = true
    loadTaco().then(items => { if (live) setTaco(items) }, () => { if (live) setTaco([]) })
    return () => { live = false }
  }, [open])

  const term = q.trim()
  const online3 = normalize(term).replace(/ /g, '').length >= OFF_MIN_LETTERS

  // Open Food Facts: from 3 letters, 600 ms after the last key, a newer term cancels the older.
  useEffect(() => {
    if (!open || !online3) { setOff({ state: 'idle', items: [] }); return }
    if (!online) { setOff({ state: 'offline', items: [] }); return }
    setOff({ state: 'waiting', items: [] })
    const ctl = new AbortController()
    const timer = setTimeout(async () => {
      const r = await searchOff(term, ctl.signal)
      if (ctl.signal.aborted) return
      if ('items' in r) setOff({ state: 'done', items: r.items })
      else if (r.error !== 'aborted') setOff({ state: r.error, items: [] })
    }, OFF_DELAY_MS)
    return () => { clearTimeout(timer); ctl.abort() }
  }, [open, term, online3, online, retry])

  const sections = useMemo(
    () => (term ? searchLocal(term, { recents, foods, taco }) : startSections(recents, foods)),
    [term, recents, foods, taco]
  )
  // A product already listed above (a favourite from Open Food Facts) is not repeated online.
  const offItems = useMemo(() => {
    const shown = new Set(sections.flatMap(s => s.items.map(keyOf)))
    return off.items.filter(i => !shown.has(keyOf(i)))
  }, [off.items, sections])

  const pick = (item: FoodItem) => {
    setPortion(item); setPortionOpen(true)
    onOpenChange(false)
  }
  const openQuick = () => { setQuickOpen(true); onOpenChange(false) }
  const openCreate = (code?: string) => { setCreateCode(code); setCreateOpen(true); onOpenChange(false) }
  const openScan = () => { setScanOpen(true); onOpenChange(false) }

  const lookup = async (code: string) => {
    const r = await lookupBarcode(code, useNutrition.getState().foods)
    if ('item' in r) { setPortion(r.item); setPortionOpen(true); return }
    if ('notFound' in r) {
      toast(t('Barcode not found. Create the food with it.'))
      openCreate(code)
      return
    }
    if (r.error === 'offline') {
      toast(t('No connection and this code is not in your foods.'), { action: { label: t('Create food'), onClick: () => openCreate(code) } })
      return
    }
    toast(t('Could not look up this barcode.'), { action: { label: t('Try again'), onClick: () => void lookup(code) } })
  }

  const offBusy = off.state === 'waiting'
  const nothing = !!term && sections.length === 0 && !offBusy && offItems.length === 0

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="h-[92dvh] max-h-[92dvh]">
          <DrawerHeader className="gap-3 text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
            <DrawerTitle className="text-xl">{t('Add to {0}', MEAL_LABEL[meal]())}</DrawerTitle>
            <DrawerDescription className="sr-only">{t('Search for a food or scan its barcode.')}</DrawerDescription>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input type="search" value={q} onChange={e => setQ(e.target.value)} aria-label={t('Search foods')}
                  placeholder={t('Search foods')} autoComplete="off" enterKeyHint="search" className="h-11 rounded-xl pl-9 text-base" />
              </div>
              <Button variant="secondary" size="icon" className="size-11 shrink-0 rounded-xl" aria-label={t('Scan barcode')} onClick={openScan}>
                <ScanBarcode aria-hidden className="size-5" />
              </Button>
            </div>
          </DrawerHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">
            {!term && sections.length === 0 && (
              <p className="rounded-2xl bg-card p-4 text-sm text-muted-foreground">{t('Search for a food or scan its barcode.')}</p>
            )}

            {sections.map(s => (
              <Section key={s.key} title={TITLE[s.key]()} note={s.key === 'taco' ? t('Source: TACO, NEPA/Unicamp') : undefined}>
                <Items items={s.items} onPick={pick} />
              </Section>
            ))}

            {nothing && (
              <p className="rounded-2xl bg-card p-4 text-sm text-muted-foreground">{t('Nothing found. Create the food or use quick add.')}</p>
            )}

            {term && !online3 && (
              <p className="text-xs text-muted-foreground">{t('Type at least 3 letters to search online.')}</p>
            )}

            {online3 && off.state !== 'idle' && (
              <Section title={t('Packaged foods')} note={t('Data: Open Food Facts')} busy={offBusy}>
                {offBusy ? (
                  <div aria-label={t('Searching online…')} className="flex flex-col gap-1">
                    {[0, 1, 2].map(i => <Skeleton key={i} className="h-14 rounded-2xl" />)}
                  </div>
                ) : off.state === 'offline' ? (
                  <Notice icon={<CloudOff aria-hidden className="size-4 shrink-0" />}>{t('Online search is unavailable without a connection.')}</Notice>
                ) : off.state === 'rate_limited' ? (
                  <Notice>{t('Online search is unavailable right now. Try again in a moment.')}</Notice>
                ) : off.state === 'failed' ? (
                  <Notice action={
                    <Button variant="outline" className="h-11 gap-2 rounded-xl" onClick={() => setRetry(n => n + 1)}>
                      <RefreshCw aria-hidden className="size-4" />{t('Try again')}
                    </Button>
                  }>{t('Online search failed.')}</Notice>
                ) : offItems.length ? (
                  <Items items={offItems} onPick={pick} />
                ) : (
                  <Notice>{t('No packaged foods found.')}</Notice>
                )}
              </Section>
            )}
          </div>

          <DrawerFooter className="grid grid-cols-2 gap-2 border-t border-border pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <Button variant="secondary" className="h-12 gap-2 rounded-xl text-[15px]" onClick={openQuick}>
              <Plus aria-hidden className="size-4" />{t('Quick add')}
            </Button>
            <Button variant="secondary" className="h-12 gap-2 rounded-xl text-[15px]" onClick={() => openCreate()}>
              <PenLine aria-hidden className="size-4" />{t('Create food')}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {portion && <PortionSheet item={portion} meal={meal} day={day} open={portionOpen} onOpenChange={setPortionOpen} />}
      <QuickAddSheet meal={meal} day={day} open={quickOpen} onOpenChange={setQuickOpen} />
      <CustomFoodSheet barcode={createCode} open={createOpen} onOpenChange={setCreateOpen}
        onSaved={food => { setPortion(food); setPortionOpen(true) }} />
      <BarcodeScanner open={scanOpen} onOpenChange={setScanOpen} onCode={code => void lookup(code)} />
    </>
  )
}

function Section({ title, note, busy, children }: { title: string; note?: string; busy?: boolean; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} aria-busy={busy || undefined} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={id} className="text-sm font-medium text-muted-foreground">{title}</h3>
        {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
      </div>
      {children}
    </section>
  )
}

function Items({ items, onPick }: { items: FoodItem[]; onPick: (item: FoodItem) => void }) {
  return (
    <ul className="flex list-none flex-col gap-1 p-0">
      {items.map(i => (
        <li key={keyOf(i)}>
          <button type="button" onClick={() => onPick(i)}
            className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-card px-4 py-2 text-left outline-none transition-colors duration-150 hover:bg-secondary/60 focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px]">{i.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {[i.brand, t('{0} kcal per 100 g', fmtNumber(i.per100.kcal))].filter(Boolean).join(', ')}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function Notice({ icon, action, children }: { icon?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div role="status" className="flex flex-col items-start gap-3 rounded-2xl bg-card p-4">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">{icon}{children}</p>
      {action}
    </div>
  )
}
