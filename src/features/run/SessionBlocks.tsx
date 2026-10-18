// A running workout's blocks in one line ("10 easy + 4 × 4 hard + 10 easy") and, under it, each
// zone it uses with its pace range from the plan's VDOT, or how the zone feels when there is no
// VDOT (spec §4.2 and §6.4). The walk zone has no pace and always shows its cue.
import { itemText, blocksInline, zoneFeel, zoneName } from './labels'
import { formatPaceRange, zonePaces } from './vdot'
import type { Item, Zone } from './types'

const ORDER: Zone[] = ['easy', 'moderate', 'hard', 'walk']

/** The zones a workout uses, in the order easy, moderate, hard, walk. */
export function zonesOf(items: Item[]): Zone[] {
  const used = new Set(items.flatMap(it => ('repeat' in it ? it.blocks : [it])).map(b => b.zone))
  return ORDER.filter(z => used.has(z))
}

export default function SessionBlocks({ session, vdot }: { session: { blocks: Item[] }; vdot?: number | null }) {
  const paces = vdot != null ? zonePaces(vdot) : null
  return (
    <div className="flex flex-col gap-1">
      {/* The short line is for the eye; a screen reader gets the minutes spelled out. */}
      <p aria-hidden className="font-mono text-sm tabular-nums">{blocksInline(session.blocks)}</p>
      <p className="sr-only">{session.blocks.map(itemText).join('; ')}</p>
      <ul className="flex list-none flex-col gap-0.5 text-sm text-muted-foreground">
        {zonesOf(session.blocks).map(z => (
          <li key={z} className="flex items-baseline justify-between gap-3">
            <span className="font-medium text-foreground">{zoneName(z)}</span>
            {paces && z !== 'walk'
              ? <span className="font-mono tabular-nums">{formatPaceRange(paces[z])}</span>
              : <span className="text-end">{zoneFeel(z)}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
