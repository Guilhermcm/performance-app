// The "Analysis" card on the Plan (spec §5.8): the week in one line, "2 alerts · chest below
// ideal" or "Balanced plan for hypertrophy". It opens the analysis. With no routine at all it asks
// for a program and opens the catalog; with routines that no day holds, it points to the week.
import type { CSSProperties, ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import LegacyIcon from '../../components/Icon.jsx'
import { t } from '../../lib/i18n.js'
import type { PlanAnalysis } from './analysis'
import { alertCount, alertPhrase, balancedText } from './analysis-copy'
import type { AnalysisProfile } from './goal'
import { useAnalysisProfile, usePlanAnalysis, usePlanStart } from './use-plan-analysis'

const Icon = LegacyIcon as unknown as (p: { name: string; className?: string; style?: CSSProperties }) => ReactElement

// The first alert in the engine's order (missing, low, high, frequency, balance, long, repeated).
export function analysisSummary(analysis: PlanAnalysis, profile: AnalysisProfile): string {
  const [first] = analysis.alerts
  if (!first) return balancedText(profile)
  return `${alertCount(analysis.alerts.length)} · ${alertPhrase(first, analysis)}`
}

export function AnalysisCard() {
  const navigate = useNavigate()
  const { profile } = useAnalysisProfile()
  const analysis = usePlanAnalysis(profile)
  const start = usePlanStart(analysis)

  // The week schedule sits below this card on the Plan: take the person there.
  const toWeek = () => {
    const week = document.getElementById('plan-week')
    week?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    week?.focus({ preventScroll: true })
  }
  const open = () => (start === 'ready' ? navigate('/plan/analise') : start === 'empty' ? navigate('/plan/programas') : toWeek())
  const line = start === 'ready' ? analysisSummary(analysis, profile)
    : start === 'empty' ? t('Pick a program to start') : t('Put a routine on a day of the week')

  return (
    <div className="list" style={{ marginBottom: 14 }}>
      <button type="button" className="item" data-testid="analysis-entry" onClick={open}>
        <span className="lrow-i"><Icon name="chart" /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="tt">{t('Analysis')}</div>
          <div className="ss">{line}</div>
        </div>
        <Icon name="chevronRight" className="chev" />
      </button>
    </div>
  )
}
