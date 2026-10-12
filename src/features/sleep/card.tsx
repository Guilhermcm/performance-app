import { Moon } from 'lucide-react'

// The frame of the sleep cards on Home and on /sono.
export const SLEEP_CARD = 'rounded-3xl border border-border bg-card p-4 text-card-foreground'

// The moon in the pillar's colour, at the head of a sleep card.
export function SleepTile() {
  return (
    <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-pillar-sleep/15 text-pillar-sleep">
      <Moon className="size-5" strokeWidth={1.75} />
    </span>
  )
}
