// The "Analysis" card on the Plan (spec §5.8): the week in one line, "2 alerts · chest below
// ideal" or "Balanced plan for hypertrophy". It opens the analysis; on an empty plan it asks for a
// program and opens the catalog instead.
import { useMemo, type CSSProperties, type ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import LegacyIcon from '../../components/Icon.jsx'
import { t } from '../../lib/i18n.js'
import { useStore } from '../../store/useStore.js'
import { useProfile } from '../profile/useProfile'
import { analyzePlan, type PlanAnalysis, type PlanInput } from './analysis'
import { alertCount, alertPhrase, balancedText } from './analysis-copy'
import { profileOf, type AnalysisProfile } from './goal'

const Icon = LegacyIcon as unknown as (p: { name: string; className?: string; style?: CSSProperties }) => ReactElement

// The first alert in the engine's order (missing, low, high, frequency, balance, long, repeated).
export function analysisSummary(analysis: PlanAnalysis, profile: AnalysisProfile): string {
  const [first] = analysis.alerts
  if (!first) return balancedText(profile)
  return `${alertCount(analysis.alerts.length)} · ${alertPhrase(first, analysis)}`
}

// The analysis profile of the person: profiles.goal, read the way the Programs screen reads it.
export function useAnalysisProfile() {
  const goal = useProfile(s => s.profile?.goal ?? null)
  return { goal, profile: profileOf(goal) }
}

export function usePlanAnalysis(profile: AnalysisProfile) {
  const S = useStore((s: { S: PlanInput }) => s.S)
  return useMemo(() => analyzePlan(S, profile), [S, profile])
}

export function AnalysisCard() {
  const navigate = useNavigate()
  const { profile } = useAnalysisProfile()
  const analysis = usePlanAnalysis(profile)
  const empty = analysis.empty

  return (
    <div className="list" style={{ marginBottom: 14 }}>
      <button type="button" className="item" data-testid="analysis-entry"
        onClick={() => navigate(empty ? '/plan/programas' : '/plan/analise')}>
        <span className="lrow-i"><Icon name="chart" /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="tt">{t('Analysis')}</div>
          <div className="ss">{empty ? t('Pick a program to start') : analysisSummary(analysis, profile)}</div>
        </div>
        <Icon name="chevronRight" className="chev" />
      </button>
    </div>
  )
}
