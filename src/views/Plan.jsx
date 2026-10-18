import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { DAYN, weekOrder, weekStartOf, uid, exCount, routineCount, todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { dayAssignSheet, dayAddRoutineSheet, planToolsSheet, confirmSheet, startFlow } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import SwipeToDelete from '../components/SwipeToDelete.jsx'
import { deleteRoutine } from '../lib/routines.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { coachAvailable } from '../lib/coach.js'
import { openCheckinCamera } from '../features/checkin/open-checkin'
import { useCheckins } from '../features/checkin/useCheckins'
import { useWeekTraining } from '../features/checkin/week'
import { ProgramBanner } from '../features/plan/ProgramBanner'
import { AnalysisCard } from '../features/plan/AnalysisCard'
import RunPlanEntry from '../features/run/RunPlanEntry'
import RunDayCard, { weekDayIso } from '../features/run/RunDayCard'
import { sessionsOn } from '../features/run/run-actions'

export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const config = useStore(s => s.config)
  const coachMode = useStore(s => s.coachLocal?.mode)
  const user = useStore(s => s.user)
  // Check-ins need a signed-in account (the store is bound once its profile is in, App.jsx).
  const canCheckIn = !!useCheckins(s => s.userId)
  const week = useWeekTraining()
  const today = todayISO()

  /* The Coach's only entry point in the app. Its screens have existed since the UI landed and
     nothing linked to them, so the feature was reachable only by typing the URL — enabled,
     configured, and invisible. The same predicate every other Coach surface uses gates it, so
     an instance without the feature sees exactly the Plan screen it saw before. */
  const showCoach = coachAvailable(config, user, { demo: DEMO, mobile: MOBILE, coachMode })

  // Swap with the neighbour, the way the routine editor moves an exercise. `S.routines` is the
  // one order the whole app reads, so this is all there is to it (#142).
  const moveRoutine = (i, delta) => update(s => {
    const to = i + delta
    if (to < 0 || to >= s.routines.length) return
    const [moved] = s.routines.splice(i, 1)
    s.routines.splice(to, 0, moved)
  })

  const addRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    nav('/plan/r/' + r.id)
  }

  // Pull one routine off a weekday; drop the key when the day empties (never store []).
  const removeFromDay = (d, rid) => update(s => {
    const next = [].concat(s.week[d] || []).filter(id => id !== rid)
    if (next.length) s.week[d] = next; else delete s.week[d]
  })

  // The same confirmation and the same delete as RoutineEdit's "Delete routine" button, minus
  // its navigation back to /plan, which this screen already is.
  const confirmDelete = r => confirmSheet({
    title: t('Delete routine?'), message: t('“{0}” and its exercises will be removed.', r.name), confirmText: t('Delete'), danger: true,
    onConfirm: () => update(s => { deleteRoutine(s, r.id) })
  })

  return <>
    <div className="hdr">
      <div><h1>{t('Plan')}</h1><div className="sub">{t('Your weekly routine')}</div></div>
      {/* Exercises left the tab bar for Social (Phase 1b) and Stats for Nutrition (Phase 2a); both
          are one tap away here. */}
      <div className="row" style={{ gap: 8, flex: 'none' }}>
        <button className="iconbtn" onClick={() => nav('/stats')} aria-label={t('Stats')} title={t('Stats')}><Icon name="chart" /></button>
        <button className="iconbtn" onClick={() => nav('/library')} aria-label={t('Exercises')} title={t('Exercises')}><Icon name="list" /></button>
        <button className="iconbtn" onClick={planToolsSheet} aria-label={t('Share your plan')} title={t('Share your plan')}><Icon name="upload" /></button>
      </div>
    </div>
    {showCoach && <button className="coach-cta" onClick={() => nav('/coach')}>
      <span className="coach-cta-av"><Icon name="sparkles" /></span>
      <span className="coach-cta-t">
        <b>{t('Coach')}</b>
        <span>{t('Plan design and reviews, from your own training')}</span>
      </span>
      <Icon name="chevronRight" className="coach-cta-chev" />
    </button>}

    {/* The applied program, with Undo until the plan is edited (phase 1d, spec 4.5). */}
    <ProgramBanner />

    {/* My workouts (phase 1c, spec 5.3): the calendar of check-ins, with this week's training days
        toward the Treino goal, counted on this phone before the server confirms them. */}
    {week && <div className="list" style={{ marginBottom: 14 }}>
      <div className="item" data-testid="my-workouts" {...tappable(() => nav('/plan/treinos'))}>
        <span className="lrow-i"><Icon name="camera" /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="tt">{t('My workouts')}</div>
          <div className="ss">{t('{0} of {1} days this week', week.days, week.target)}</div>
        </div>
        <Icon name="chevronRight" className="chev" />
      </div>
    </div>}

    {/* The program catalog (phase 1d, spec 4.4), for an empty plan and a full one alike. */}
    <div className="list" style={{ marginBottom: 14 }}>
      <div className="item" data-testid="programs-entry" {...tappable(() => nav('/plan/programas'))}>
        <span className="lrow-i"><Icon name="sparkles" /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="tt">{t('Programs')}</div>
          <div className="ss">{t('Ready-made plans, with the evidence behind them')}</div>
        </div>
        <Icon name="chevronRight" className="chev" />
      </div>
    </div>

    {/* The running plan (phase 1e-a, spec 6.4): build one, or open it at /plan/corrida. */}
    <RunPlanEntry />

    {/* The plan analysis (phase 1d, spec 5.8): the week in one line, or a program to start with. */}
    <AnalysisCard />

    {/* The tab bar's center is the check-in now (phase 1c), so a workout in progress, or an edit
        of a saved one, is picked up here. */}
    {S.active && <div className="list" style={{ marginBottom: 14 }}>
      <div className="item">
        <span className="lrow-i"><Icon name={S.active.editingWorkoutId ? 'pencil' : 'timer'} /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="tt">{S.active.editingWorkoutId ? t('Editing a saved workout') : t('Workout in progress')}</div>
          <div className="ss">{S.active.name}</div>
        </div>
        <Button size="sm" variant="tinted" style={{ width: 'auto', flex: 'none' }} onClick={() => nav('/workout')}>
          {S.active.editingWorkoutId ? t('Edit workout') : t('Resume workout')}
        </Button>
      </div>
    </div>}

    <div className="cols"><div>
      {/* the Analysis card brings the focus here when there are routines but no day holds one */}
      <h4 className="sec" id="plan-week" tabIndex={-1}>{t('Week schedule')}</h4>
      <div className="list" style={{ display: 'flex', flexDirection: 'column' }}>
        {weekOrder(weekStartOf(S)).map(d => {
          const dayRoutines = [].concat(S.week[d] || []).map(id => S.routines.find(x => x.id === id)).filter(Boolean)
          // This week's runs of the running plan on this day (phase 1e-a), under the routines.
          const iso = weekDayIso(today, weekStartOf(S), d)
          const runs = sessionsOn(S.runPlan, iso, weekStartOf(S)).length > 0
          // An empty day stays one tappable row → pick its first routine (today's behaviour).
          if (!dayRoutines.length && !runs) return <div key={d} className="item" {...tappable(() => dayAssignSheet(d))}>
            <div className="grow"><div className="tt">{t(DAYN[d])}</div></div>
            <span className="tag">{t('Rest')}</span>
            <Icon name="chevronRight" className="chev" /></div>
          // A day with runs and no routine: the run card, and the ＋ picks its first routine.
          if (!dayRoutines.length) return <div key={d} className="item" style={{ display: 'block', padding: '10px 14px' }}>
            <div className="row between">
              <div className="tt">{t(DAYN[d])}</div>
              <button className="iconbtn sm" aria-label={t('Add routine')} title={t('Add routine')}
                style={{ width: 30, height: 30, margin: '-5px 3px', fontSize: 15 }}
                onClick={() => dayAssignSheet(d)}><Icon name="plus" /></button>
            </div>
            <RunDayCard day={d} iso={iso} />
          </div>
          // A populated day: always-visible routine sub-rows + inline ✕. Adding a second routine
          // is a small ＋ in the day's header, centred over the ✕ column (#276): a full-width
          // "＋ Add routine" under every planned day made the week read as a list of buttons,
          // when most people train one routine a day. The ＋ keeps the option for those who don't.
          return <div key={d} className="item" style={{ display: 'block', padding: '10px 14px' }}>
            <div className="row between" style={{ marginBottom: 6 }}>
              <div className="tt">{t(DAYN[d])}</div>
              <div className="row" style={{ gap: 8 }}>
                <div className="small dim">{routineCount(dayRoutines.length)}</div>
                <button className="iconbtn sm" aria-label={t('Add routine')} title={t('Add routine')}
                  style={{ width: 30, height: 30, margin: '-5px 3px', fontSize: 15 }}
                  onClick={() => dayAddRoutineSheet(d)}><Icon name="plus" /></button>
              </div>
            </div>
            {dayRoutines.map(r => <div key={r.id} className="row" style={{ gap: 8, padding: '4px 0 4px 8px' }}>
              <span className="lrow-i" style={{ width: 26, height: 26, fontSize: 14 }}><Icon name={glyphOf(r.emoji)} /></span>
              <div className="grow" style={{ minWidth: 0 }}><div className="tt" style={{ fontSize: 14 }}>{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
              <button className="iconbtn sm" aria-label={t('Remove')} onClick={() => removeFromDay(d, r.id)}><Icon name="xmark" /></button>
            </div>)}
            {runs && <RunDayCard day={d} iso={iso} />}
          </div>
        })}
      </div>
    </div><div>
      <div className="row between" style={{ marginTop: 22, marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Routines')}</h4>
        <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New')}</Button>
      </div>
      {S.routines.length ? <div className="list">{S.routines.map((r, i) => <SwipeToDelete key={r.id} className="item"
        deleteLabel={t('Delete routine')} onDelete={() => confirmDelete(r)} {...tappable(() => nav('/plan/r/' + r.id))}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div>
          {/* The plan comes first (phase 1c): a check-in with this routine, or the live workout as
              the second way. One live workout at a time: a running one is resumed above. */}
          {(canCheckIn || !S.active) && <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {canCheckIn && <Button size="sm" variant="tinted" icon="camera" style={{ width: 'auto', minHeight: 44 }}
              aria-label={t('Post a check-in') + ': ' + r.name}
              onClick={ev => { ev.stopPropagation(); openCheckinCamera({ routineId: r.id }) }}>{t('Post a check-in')}</Button>}
            {!S.active && <Button size="sm" variant="plain" icon="play" style={{ width: 'auto', minHeight: 44 }}
              aria-label={t('Train with the app') + ': ' + r.name}
              onClick={ev => { ev.stopPropagation(); startFlow([r.id]) }}>{t('Train with the app')}</Button>}
          </div>}
        </div>
        {/* The order of this list is the order of `S.routines`, and every other screen reads the
            same array — the Start screen, the day-assignment sheets, the routine pickers. So
            moving a routine here moves it everywhere, which is what the request asked for (#142). */}
        {S.routines.length > 1 && <div style={{ display: 'flex', gap: 2, flex: 'none' }}>
          <button className="iconbtn" aria-label={t('Move up')} title={t('Move up')} disabled={i === 0}
            style={{ width: 28, height: 24, borderRadius: 7, fontSize: 12 }}
            onClick={ev => { ev.stopPropagation(); moveRoutine(i, -1) }}><Icon name="chevronUp" /></button>
          <button className="iconbtn" aria-label={t('Move down')} title={t('Move down')} disabled={i === S.routines.length - 1}
            style={{ width: 28, height: 24, borderRadius: 7, fontSize: 12 }}
            onClick={ev => { ev.stopPropagation(); moveRoutine(i, 1) }}><Icon name="chevronDown" /></button>
        </div>}
        <Icon name="chevronRight" className="chev" /></SwipeToDelete>)}</div> : <>
        <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Create one or pick a program.')}</div>
        <Button icon="sparkles" onClick={() => nav('/plan/programas')}>{t('See programs')}</Button>
      </>}
      {/* A freestyle session, or several routines at once, start from the workout screen. */}
      {!S.active && <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
        <Button size="sm" variant="plain" icon="reset" style={{ width: 'auto', minHeight: 44 }} onClick={() => nav('/workout')}>{t('Choose a different workout')}</Button>
      </div>}
    </div></div>
  </>
}
