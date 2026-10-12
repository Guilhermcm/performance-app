// The ⓘ of every "About N min" in the plan screens (spec §5.5): the app's own sum, with no study
// behind it, so a note and no reference.
import { InfoSource } from '@/components/ui/info-source'
import { t } from '../../lib/i18n.js'

export function TimeInfo() {
  return (
    <InfoSource refs={[]} label={t('How the time is estimated')}
      note={t('The app’s estimate: each set counts its own rest plus 40 s to do it. With no rest set, it counts 90 s. Each workout adds 5 min to warm up.')} />
  )
}
