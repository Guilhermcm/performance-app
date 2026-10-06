import { t } from '../../lib/i18n.js'
import { fmtGrams } from './labels'

// Protein, carbs and fat of a portion, each with its name: never by colour alone.
export function MacroLine({ protein, carbs, fat }: { protein: number; carbs: number; fat: number }) {
  const parts: [string, number][] = [[t('Protein'), protein], [t('Carbs'), carbs], [t('Fat'), fat]]
  return (
    <dl className="flex gap-4 text-right">
      {parts.map(([label, v]) => (
        <div key={label} className="flex flex-col">
          <dt className="text-[11px] text-muted-foreground">{label}</dt>
          <dd className="font-mono text-sm tabular-nums">{fmtGrams(v)}</dd>
        </div>
      ))}
    </dl>
  )
}
