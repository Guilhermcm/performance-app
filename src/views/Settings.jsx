import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { workoutControls } from '../lib/workout-controls.js'
import { speedUnitOf } from '../lib/speed.js'
import { useUI } from '../store/useUI.js'
import { todayISO, weekStartOf, MONDAY, SUNDAY, fmtPlate } from '../lib/format.js'
import { inventoryFor, ownsPlates } from '../lib/plates.js'
import { effortOf } from '../lib/history.js'
import { unlock, playOnSilentSupported, vibrateSupported } from '../lib/sound.js'
import { IS_ANDROID } from '../lib/api.js'
import { wakeLockSupported } from '../lib/wakelock.js'
import { t, LANGS, INSTR_LANGS, EXERCISE_NAME_LANGS, baseLang } from '../lib/i18n.js'
import { SELECTABLE_LANGS } from '../lib/i18n-core.js'
import { effectiveLang } from '../lib/default-lang.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE, shareExport, shareExportBlob } from '../lib/mobile.js'
import { referencedFiles } from '../lib/media-refs.js'
import { mediaStore } from '../lib/media-store.js'
import { fetchToStore } from '../lib/media-sync.js'
import { limitsFrom } from '../lib/media-limits.js'
import { starterPlanSheet, confirmSheet, importFromApp, importFromHevy, equipmentProfileSheet, plateInventorySheet, menuSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Section, Row, SelectRow, Switch, Segmented } from '../components/ui.jsx'
import { useProfile } from '../features/profile/useProfile.ts'
import { SOURCE_URL } from '../features/profile/ProfileScreen.tsx'

export default function Settings() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const profile = useProfile(s => s.profile)
  const config = useStore(s => s.config)
  // What the app is showing, which for a profile that never picked a language is worked out on
  // this device rather than stored (#303).
  const lang = effectiveLang(S, config)
  const { update, importConflict, importBackup, setUnit, resetEverything: resetAll } = useStore()
  const toast = useUI(s => s.toast)
  const fileRef = useRef(null)
  const importRef = useRef(null)
  const wakeOK = wakeLockSupported()

  // Two honest choices on a unit switch (issue #22): convert the numbers, or keep them and only
  // change the label — the old behaviour, still right for someone who logged in lb all along
  // under a kg label. Closing the sheet leaves the unit as it was.
  const switchUnit = v => {
    if (v === S.unit) return
    menuSheet({
      title: t('Convert to {0}?', v),
      subtitle: t('Every stored weight — logged sets, working weights, routine targets, body weight, bar weights — is in {0}. Convert the numbers, or keep them and only change the label?', S.unit),
      items: [
        { icon: 'shuffle', label: t('Convert the numbers'), onClick: () => { setUnit(v); profileUnit(v) } },
        { icon: 'pencil', label: t('Keep the numbers, change the label'), onClick: () => { setUnit(v, { convert: false }); profileUnit(v) } },
      ],
    })
  }

  // The profile keeps the unit too (Profile screen, onboarding): it follows, quietly — the app's
  // own copy has already switched, and a profile that could not be saved catches up next time.
  const profileUnit = v => {
    const p = useProfile.getState()
    if (p.profile && p.profile.unit !== v) p.save({ unit: v }).catch(() => {})
  }

  // Reads the store at the moment of the tap: the sheet that asks before a sign-out offers it too,
  // and the copy it exports is the one that has not reached the server.
  const doExport = async () => {
    const json = JSON.stringify(useStore.getState().S, null, 2)
    const name = 'opengym-backup-' + todayISO() + '.json'
    // WKWebView can't download blob URLs — the native build hands the file to the share sheet.
    if (MOBILE) {
      try { await shareExport(json, name); toast(t('Backup exported')) } catch (e) { /* share sheet dismissed */ }
      return
    }
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
    toast(t('Backup exported'))
  }
  // "Export with photos & videos": the same JSON plus every file the state refers to, in a zip
  // (lib/backup-media.js). Signed in, a file this device never downloaded is fetched for it; one
  // nobody has is left out and counted. The sign-out sheet offers it while media are waiting.
  const doExportZip = async () => {
    const { exportBackupZip } = await import('../lib/backup-media.js')
    const st = useStore.getState()
    const signedIn = !!(st.user && st.config?.media)
    let out
    try { out = await exportBackupZip(st.S, { fetchOne: signedIn ? fetchToStore : null }) }
    catch { toast(t('Something went wrong')); return }
    const name = 'opengym-backup-' + todayISO() + '.zip'
    if (out.missing) toast(t(out.missing === 1 ? '{0} file could not be included' : '{0} files could not be included', out.missing))
    if (MOBILE) {
      try { await shareExportBlob(out.blob, name); if (!out.missing) toast(t('Backup exported')) } catch (e) { /* share sheet dismissed */ }
      return
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(out.blob); a.download = name; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 60000)
    if (!out.missing) toast(t('Backup exported'))
  }
  // Import takes the JSON backup and the zip alike, told apart by their first bytes. A zip's
  // files go into the local store only once the import is confirmed, each checked against its
  // name first; the state's media refs and links pass the usual gates (lib/backup-media.js).
  const doImport = async ev => {
    const f = ev.target.files[0]; if (!f) return
    ev.target.value = ''
    let read
    try {
      const { readBackupFile } = await import('../lib/backup-media.js')
      read = await readBackupFile(f)
    } catch (e) { toast(t('Import failed: {0}', e.message)); return }
    const apply = async mergeWith => {
      if (read.files.length) {
        const { storeBackupMedia } = await import('../lib/backup-media.js')
        await storeBackupMedia(read.files, { limits: limitsFrom(useStore.getState().config) })
      }
      importBackup(read.state, { mergeWith })
      toast(t('Backup imported'))
    }
    // Signed in, the server is asked first: a workout logged since the backup was made, or on
    // another device meanwhile, would be deleted from the profile by the replace — said, with the
    // choice to merge those in instead (useStore importConflict / importBackup).
    const conflict = await importConflict(read.state)
    if (conflict) {
      const n = conflict.workouts
      menuSheet({
        title: t('Import backup?'),
        subtitle: t(n === 1
          ? 'The server has 1 workout that is not in this backup, logged since it was made or on another device. Replacing deletes it.'
          : 'The server has {0} workouts that are not in this backup, logged since it was made or on another device. Replacing deletes them.', n),
        items: [
          { icon: 'trash', label: t('Replace anyway'), danger: true, onClick: () => apply(null) },
          { icon: 'shuffle', label: t('Merge them in'), onClick: () => apply(conflict) },
          { icon: 'xmark', label: t('Cancel'), onClick: () => {} },
        ],
      })
      return
    }
    confirmSheet({
      title: t('Import backup?'), message: t('This replaces all current data with the backup file.'), confirmText: t('Import'), danger: true,
      onConfirm: () => apply(null)
    })
  }
  // Whether any custom exercise has a photo or video: the rows about them only show then.
  const hasMedia = referencedFiles(S).length > 0
  // Signed in, the empty state is pushed to the profile like any other change, so the wipe
  // reaches every device that syncs with it — the dialog has to say so.
  const resetEverything = () => confirmSheet({
    title: t('Reset everything?'),
    message: user
      ? t('Deletes your plan, workouts, body weight, photos and videos from your profile on this server and on every signed-in device. This cannot be undone.')
      : t('Deletes your plan, workouts, body weight, photos and videos on this device. This cannot be undone.'),
    confirmText: t('Delete everything'), danger: true,
    onConfirm: () => {
      resetAll()
      nav('/home'); toast(t('All data reset'))
      clearMediaAfterReset().catch(() => {})
    },
  })

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Home')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 10 }}><h1>{t('Settings')}</h1></div>
    </div>

    {/* ---------- profile: name, body, goal, equipment, sharing, sign-out ---------- */}
    {user && profile && <Section>
      <Row icon="personCircle" iconTint="var(--acc)" title={t('Profile')} subtitle={profile.display_name} accessory="chevron" onClick={() => nav('/perfil')} />
    </Section>}

    {/* ---------- general ---------- */}
    <Section title={t('General')} footer={t('Switching the unit offers to convert every stored weight.')}>
      <SelectRow
        icon="globe" iconTint="var(--blue)" title={t('Language')}
        value={lang} onChange={v => update(s => { s.lang = v; s.langAuto = false })}
        options={SELECTABLE_LANGS.map(l => [l, LANGS[l]]).map(([k, name]) => ({
          value: k, label: name,
          subtitle: INSTR_LANGS.includes(k) ? null : t("Exercise instructions aren't available in this language yet — they stay in English."),
        }))}
      />
      {EXERCISE_NAME_LANGS.includes(baseLang(lang)) && <>
        <Row icon="dumbbell" iconTint="var(--purple)" title={t('English exercise names')}
          subtitle={t('Show the English name in parentheses next to the translated one.')}>
          <Switch checked={S.enParens?.[baseLang(lang)] ?? true}
            disabled={S.enOnly?.[baseLang(lang)] === true}
            onChange={v => update(s => { s.enParens = { ...(s.enParens || {}), [baseLang(lang)]: v } })} />
        </Row>
        <Row icon="globe" iconTint="var(--purple)" title={t('English names only')}
          subtitle={t('Replace the translated names with the original English ones.')}>
          <Switch checked={S.enOnly?.[baseLang(lang)] === true}
            onChange={v => update(s => { s.enOnly = { ...(s.enOnly || {}), [baseLang(lang)]: v } })} />
        </Row>
      </>}
      <Row icon="scale" iconTint="var(--teal)" title={t('Weight unit')}>
        <Segmented className="seg-inline"
          options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]}
          value={S.unit} onChange={v => switchUnit(v)} />
      </Row>
      {/* Cardio speed (Discord "miles per hour"). Unlike the weight unit this converts nothing:
          speeds stay stored in km/h and only what is shown and typed follows it (lib/speed.js).
          Until chosen it follows the weight unit, so a profile in pounds already reads mph. */}
      <Row icon="figureRun" iconTint="var(--teal)" title={t('Speed unit')}>
        <Segmented className="seg-inline"
          options={[{ value: 'kmh', label: 'km/h' }, { value: 'mph', label: 'mph' }]}
          value={speedUnitOf(S)} onChange={v => update(s => { s.speedUnit = v })} />
      </Row>
      {/* Display only: one decimal reads fine for plate-loadable numbers, two for anyone whose
          per-side figure lands on .25 or .75, or who loads microplates (issue #139). Nothing is
          stored or rounded differently — lib/format.js fmtNum just prints what is already there. */}
      <Row icon="plate" iconTint="var(--teal)" title={t('Weight decimals')} subtitle={t('How precisely weights are shown.')}>
        <Segmented className="seg-inline"
          options={[{ value: 1, label: t('0.5') }, { value: 2, label: t('0.25') }]}
          value={S.wdec === 2 ? 2 : 1} onChange={v => update(s => { s.wdec = v })} />
      </Row>
      {/* Monday or Sunday — the Plan list, the Home strip, the calendar grid and every
          "this week" total follow it. Stored as a getDay() index (see lib/format.js). */}
      <Row icon="calendar" iconTint="var(--orange)" title={t('Week starts on')}>
        <Segmented className="seg-inline"
          options={[{ value: MONDAY, label: t('Monday') }, { value: SUNDAY, label: t('Sunday') }]}
          value={weekStartOf(S)} onChange={v => update(s => { s.weekStart = v })} />
      </Row>
      {/* Membership QR codes on Home (views/CheckIn.jsx); off = no Home card, no route. */}
      <Row icon="qr" iconTint="var(--blue)" title={t('Gym check-in')}
        subtitle={t('Show a card on Home with your membership QR codes.')}>
        <Switch checked={S.checkIn !== false} onChange={v => update(s => { s.checkIn = v })} />
      </Row>
      {/* The Home summary is optional; hiding it leaves weight logging, history and Stats intact. */}
      <Row icon="scale" iconTint="var(--green)" title={t('Body weight')}
        subtitle={t('Show the body weight card on Home.')}>
        <Switch checked={S.showWeightCard !== false} onChange={v => update(s => { s.showWeightCard = v })} />
      </Row>
    </Section>

    {/* ---------- during a workout ---------- */}
    <Section title={t('During a workout')} footer={wakeOK ? t('The screen stays on while a workout is running, so you don’t have to unlock your phone between sets.') : null}>
      {/* The quick weigh-in that opens on Start (sheets.jsx startFlow, issue #137); off skips straight
          to the session. Home and Stats still log weight by hand. */}
      <Row icon="scale" iconTint="var(--green)" title={t('Weigh in before workouts')}
        subtitle={t('Asks for your body weight when a workout starts. Off starts the session straight away.')}>
        <Switch checked={S.weighIn !== false} onChange={v => update(s => { s.weighIn = v })} />
      </Row>
      {/* One exercise at a time (cards with Prev/Next), the whole session stacked as a
          scrollable list, or that list stripped to just names and set rows (compact).
          Legacy/unknown values read as cards. The running session can override this from
          the workout header's ⋮ menu without changing this default. */}
      <Row icon="list" iconTint="var(--blue)" title={t('Workout view')}>
        <Segmented className="seg-inline"
          options={[{ value: 'cards', label: t('Cards') }, { value: 'list', label: t('List') }, { value: 'compact', label: t('Compact') }]}
          value={['list', 'compact'].includes(S.workoutView) ? S.workoutView : 'cards'}
          onChange={v => update(s => { s.workoutView = v })} />
      </Row>
      {/* Whose reps a planned session opens with (lib/session-start.js). The plan's by default:
          the routine is what you said you would do, and history and progression decide the
          weight. The other choice is the old behaviour, reps carried over from last time.
          Absent (an older profile) reads as the plan. */}
      <SelectRow icon="clipboard" iconTint="var(--acc)" title={t('Planned sessions start from')}
        value={S.startFrom === 'last' ? 'last' : 'plan'} onChange={v => update(s => { s.startFrom = v })}
        options={[
          { value: 'plan', label: t('Your plan'), subtitle: t('The routine’s sets and reps. Your history decides the weight.') },
          { value: 'last', label: t('Your last session'), subtitle: t('The reps you logged last time in that routine, carried over.') },
        ]} />
      {/* The line under each exercise that the rows are held against (#173). Tapping the line in
          a workout switches it too; this is where the choice can be found without knowing that. */}
      <SelectRow icon="history" iconTint="var(--blue)" title={t('Shown under each exercise')}
        value={S.logRef === 'best' ? 'best' : 'last'} onChange={v => update(s => { s.logRef = v })}
        options={[
          { value: 'last', label: t('Last time'), subtitle: t('What you did the last time, in that routine.') },
          { value: 'best', label: t('Best set'), subtitle: t('Your heaviest set of the exercise, from any workout.') },
        ]} />
      {/* The lean workout screen keeps the sets and one "more" button per exercise; each switch
          brings one of the old always-visible button groups back for people who liked them. */}
      <Row icon="wrench" iconTint="var(--purple)" title={t('Workout controls')} accessory="chevron"
        subtitle={t('Everything hidden here stays one tap away: the ⋯ button of an exercise and the number of a set.')}
        onClick={() => workoutControlsSheet()} />
      <SelectRow icon="timer" iconTint="var(--orange)" title={t('Rest timer')}
        value={S.restSec} onChange={v => update(s => { s.restSec = v })}
        options={[{ value: 0, label: t('Off') }, ...[60, 90, 120, 150, 180].map(v => ({ value: v, label: v + 's' }))]} />
      {/* Default for a rest-pause burst added live on a plain set — a planned exercise's own
          "Rest (s)" (in its Intensifier config) overrides this, same as the main rest timer
          is the fallback whenever an exercise has no progression rule of its own. */}
      <SelectRow icon="bolt" iconTint="var(--acc)" title={t('Rest-pause rest')}
        value={S.restPauseSec} onChange={v => update(s => { s.restPauseSec = v })}
        options={[10, 15, 20, 30].map(v => ({ value: v, label: v + 's' }))} />
      {(wakeOK || !MOBILE) && (
        <Row icon="sun" iconTint="var(--yellow)" title={t('Keep screen awake')}
          subtitle={wakeOK ? null : t('Not supported in this browser.')}>
          <Switch checked={wakeOK && S.keepAwake !== false} disabled={!wakeOK}
            onChange={v => update(s => { s.keepAwake = v })} />
        </Row>
      )}
      {/* 'full'/'mini' is also what the tap-toggle on the workout animation writes; 'off' hides
          workout media entirely (library, detail sheet and picker thumbs are unaffected).
          Legacy/unknown values read as 'full'. */}
      <Row icon="figureRun" iconTint="var(--green)" title={t('Exercise animations')}>
        <Segmented className="seg-inline"
          options={[{ value: 'full', label: t('Full') }, { value: 'mini', label: t('Small') }, { value: 'off', label: t('Hidden') }]}
          value={S.gifSize === 'mini' || S.gifSize === 'off' ? S.gifSize : 'full'}
          onChange={v => update(s => { s.gifSize = v })} />
      </Row>
      <Row icon="bell" iconTint="var(--pink)" title={t('Sounds')}>
        {/* Turning Sounds on is a tap: unlock the audio context now so a timer that ends before
            the next set check can already sound (iOS, #152). */}
        <Switch checked={!!S.sound} onChange={v => { if (v) unlock(true); update(s => { s.sound = v }) }} />
      </Row>
      {/* iOS only (WebKit's audio-session API, iOS 17+): with it off the ring/silent switch mutes
          the timer. On, the phone treats the timer like a music player — exclusive, and the
          music app is not told it may resume — so it is a choice, off by default (lib/sound.js). */}
      {S.sound && playOnSilentSupported() && (
        <Row icon="bell" iconTint="var(--orange)" title={t('Play sounds when the phone is on silent')}
          subtitle={t('Music playing on this phone stops during a workout and does not resume by itself.')}>
          <Switch checked={!!S.soundOnSilent} onChange={v => update(s => { s.soundOnSilent = v })} />
        </Row>
      )}
      {/* The buzz at the end of a rest or a hold and on a set tick, on its own switch like the
          sound (Discord, asierlama). Not offered where there is nothing to buzz: iOS has no
          navigator.vibrate. */}
      {vibrateSupported() && (
        <Row icon="bell" iconTint="var(--indigo)" title={t('Vibrate')}>
          <Switch checked={S.vibrate !== false} onChange={v => update(s => { s.vibrate = v })} />
        </Row>
      )}
      <Row icon="sun" iconTint="var(--yellow)" title={t('Flash screen when timer ends')}>
        <Switch checked={!!S.timerFlash} onChange={v => update(s => { s.timerFlash = v })} />
      </Row>
      <Row icon="timer" title={t('Keep timing after target')}
        subtitle={t('Timed sets continue up to 15 extra minutes. Tap Done to log the actual duration.')}>
        <Switch aria-label={t('Keep timing after target')} checked={!!S.timedSetOvertime}
          onChange={v => update(s => { s.timedSetOvertime = v })} />
      </Row>
      {/* Two names for the same judgement, so the column asks in the scale you already think in.
          The (i) sits before the control — you read it on the way to the choice, not after it. */}
      <Row icon="target" iconTint="var(--purple)" title={t('Effort per set')}>
        <button className="helpbtn" aria-label={t('What are RIR and RPE?')} onClick={effortHelpSheet}><Icon name="info" /></button>
        <Segmented className="seg-inline"
          options={[{ value: 'none', label: t('Off') }, { value: 'rir', label: t('RIR') }, { value: 'rpe', label: t('RPE') }]}
          value={effortOf(S)} onChange={v => update(s => { s.effort = v; delete s.showRir })} />
      </Row>
    </Section>

    {/* ---------- equipment ---------- */}
    <EquipmentCard S={S} update={update} />

    {/* ---------- appearance ---------- */}
    <Section title={t('Appearance')} footer={DEMO || MOBILE ? undefined : t('synced with your profile')}>
      <Row icon="moon" iconTint="var(--indigo)" title={t('Theme')}>
        <Segmented
          className="seg-inline"
          options={[
            { value: 'dark', icon: 'moon', label: t('Dark') },
            { value: 'light', icon: 'sun', label: t('Light') },
            { value: 'system', icon: 'gear', label: t('System') },
          ]}
          value={S.theme || 'dark'}
          onChange={v => update(s => { s.theme = v })}
        />
      </Row>
      {/* Purely how the muscle map is drawn — nothing else in the app reads this. */}
      <Row icon="figureStrength" iconTint="var(--teal)" title={t('Body diagram')}>
        <Segmented
          className="seg-inline"
          options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]}
          value={S.body === 'female' ? 'female' : 'male'}
          onChange={v => update(s => { s.body = v })}
        />
      </Row>
    </Section>

    {/* ---------- data: fill it, bring things over, back it up, wipe it ---------- */}
    <Section title={t('Data')}>
      <Row icon="sparkles" iconTint="var(--acc)" title={t('Load starter plan')} accessory="chevron" onClick={starterPlanSheet} />
      <Row icon="shuffle" iconTint="var(--teal)" title={t('Import from another app')}
        subtitle={t('FitNotes, Strong, Hevy — or body weight from Apple Health')}
        accessory="chevron" onClick={() => importRef.current.click()} />
      <Row icon="key" iconTint="var(--teal)" title={t('Import from Hevy')}
        subtitle={t('Pull your history with a Hevy Pro API key')}
        accessory="chevron" onClick={importFromHevy} />
      <Row icon="upload" iconTint="var(--blue)" title={t('Import backup')} accessory="chevron" onClick={() => fileRef.current.click()} />
      <Row icon="download" iconTint="var(--blue)" title={t('Export backup (JSON)')} subtitle={hasMedia ? t('Without photos and videos') : undefined} accessory="chevron" onClick={doExport} />
      {hasMedia && <Row icon="download" iconTint="var(--blue)" title={t('Export with photos & videos (.zip)')} accessory="chevron" onClick={doExportZip} />}
      {/* 14 is AUTO_BACKUP_KEEP in lib/mobile.js, written out because the Settings tests mock
          that module wholesale; mobile.autobackup.test.js pins the two together. */}
      {MOBILE && <Row icon="history" iconTint="var(--blue)" title={t('Auto-backup on changes')}
        subtitle={t('Saves a dated copy to Documents/openGym after finishing a workout or editing a routine, and keeps the newest {0} — point a sync app at that folder, or copy it out by hand.', 14)}>
        <Switch checked={!!S.autoBackup} onChange={v => update(s => { s.autoBackup = v })} />
      </Row>}
      <Row icon="trash" iconTint="var(--red)" title={t('Reset everything')} danger onClick={resetEverything} />
    </Section>
    <input ref={fileRef} type="file" accept=".json,.zip,application/json,application/zip" style={{ display: 'none' }} onChange={doImport} />
    {/* Reset after reading so picking the same file twice still fires onChange. */}
    <input ref={importRef} type="file" accept=".csv,.xml,text/csv,text/xml" style={{ display: 'none' }}
      onChange={ev => { const f = ev.target.files[0]; if (f) importFromApp(f); ev.target.value = '' }} />

    {/* "Add to Home screen" makes no sense inside the native app */}
    {!MOBILE && <Section title={t('Tip')}>
      <Row icon="lightbulb" iconTint="var(--yellow)"
        title={IS_ANDROID ? t('In Chrome: ⋮ menu → Add to Home screen') : t('In Safari: Share → Add to Home Screen')}
        subtitle={t('to install openGym as a full-screen app.') + ' ' + (user ? t('Your data syncs with your profile — sign in anywhere to see it.') : t('Guest data stays on this device — export a backup now and then!'))} />
    </Section>}

    {/* The version, at the bottom of Settings — which is where the support template has been
        telling people to look for it, and where it was not. On the phone build there is no
        address bar and no about box, so without this there is no way to tell which build you
        are running, or whether an update actually installed. */}
    <div className="dim small" style={{ textAlign: 'center', marginTop: 4, lineHeight: 1.6 }}>
      openGym v{__APP_VERSION__} · {t('free & open source (AGPL v3)')}<br />
      <a href={SOURCE_URL} target="_blank" rel="noopener" style={{ display: 'inline-block', padding: '10px 6px' }}>{t('Source code (AGPL-3.0)')}</a> ·{' '}
      <a href="https://github.com/DuarteSantos8/openGym" target="_blank" rel="noopener" style={{ display: 'inline-block', padding: '10px 6px' }}>{t('Based on openGym')}</a><br />
      exercise data: hasaneyldrm/exercises-dataset (MIT)<br />
      exercise images and animations © <a href="https://gymvisual.com/" target="_blank" rel="noopener">Gym visual</a>
    </div>
  </div>
}

// The whole point is that the two scales are one judgement counted from opposite ends, and a
// paragraph is a bad way to say that — the conversion table shows it in one look. Reading down
// a column is the answer to "what do I put here", so the numbers get their own aligned columns.
const EFFORT_ROWS = [
  ['0', '10', 'Nothing left — went to failure'],
  ['1', '9', 'One more rep in the tank'],
  ['2', '8', 'Two more reps'],
  ['3', '7', 'Three more reps'],
  ['4+', '≤6', 'Easy — warm-up territory'],
]
// RIR 2 / RPE 8: the row a working set usually lands on — the anchor the others are read
// against. Not where the stepper starts; + walks up from the bottom of the scale.
const EFFORT_TYPICAL = 2

// Settings → During a workout → Workout controls. S.wc overlays DEF.wc, so a profile from
// before this setting existed reads as the lean default.
function WorkoutControlsSheet() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const wc = workoutControls(S)
  const set = (k, v) => update(s => { s.wc = { ...workoutControls(s), [k]: v } })
  return <>
    <h3>{t('Workout controls')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Everything hidden here stays one tap away: the ⋯ button of an exercise and the number of a set.')}</div>
    <Section>
      <Row icon="plus" iconTint="var(--acc)" title={t('Weight and reps buttons')} subtitle={t('Off: tap the number and type it')}>
        <Switch checked={wc.steppers} onChange={v => set('steppers', v)} />
      </Row>
      <Row icon="bolt" iconTint="var(--orange)" title={t('Drop and burst shortcuts on every set')}>
        <Switch checked={wc.setShortcuts} onChange={v => set('setShortcuts', v)} />
      </Row>
      <Row icon="link" iconTint="var(--blue)" title={t('Superset buttons in the exercise header')}>
        <Switch checked={wc.pairButtons} onChange={v => set('pairButtons', v)} />
      </Row>
      <Row icon="shuffle" iconTint="var(--teal)" title={t('Move, swap and remove buttons below the exercise')}>
        <Switch checked={wc.exerciseButtons} onChange={v => set('exerciseButtons', v)} />
      </Row>
    </Section>
  </>
}
function workoutControlsSheet() {
  useUI.getState().openSheet(() => <WorkoutControlsSheet />)
}

function effortHelpSheet() {
  useUI.getState().openSheet(close => <>
    <h3>{t('Effort per set')}</h3>
    <div className="muted small" style={{ lineHeight: 1.5 }}>
      {t('How hard a set was, logged next to weight and reps. Two scales for the same judgement, counted from opposite ends.')}
    </div>
    <div className="efftbl">
      <div className="r hd"><span className="n">{t('RIR')}</span><span className="n">{t('RPE')}</span><span className="f">{t('How it felt')}</span></div>
      {EFFORT_ROWS.map(([rir, rpe, feel], i) => (
        <div key={rir} className={'r' + (i === EFFORT_TYPICAL ? ' on' : '')}>
          <span className="n">{rir}</span><span className="n">{rpe}</span><span className="f">{t(feel)}</span>
        </div>
      ))}
    </div>
    <div className="dim small" style={{ lineHeight: 1.5, display: 'grid', gap: 8 }}>
      <div>{t('RIR counts the reps you left; RPE reads the same effort off a 10-point scale — so RPE ≈ 10 − RIR. Pick the one you already think in.')}</div>
      <div>{t('The highlighted row is where most working sets land. Sets you have already logged keep their own scale, and nothing else reads the value — progression and estimated 1RM are unaffected.')}</div>
    </div>
    <div style={{ height: 8 }} />
  </>)
}

// Equipment profiles ("Home", "Gym", ...) — each an id/name/eq-list; the active one filters
// the Library, exercise picker, and flags routine entries that need something outside it
// (see lib/equipment.js). Purely local/synced state — no server changes needed.
function EquipmentCard({ S, update }) {
  const profiles = S.equipProfiles || []
  const remove = p => confirmSheet({
    title: t('Delete profile?'), message: t('"{0}" and its equipment list will be removed.', p.name),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => update(s => {
      s.equipProfiles = (s.equipProfiles || []).filter(x => x.id !== p.id)
      if (s.activeEquipId === p.id) s.activeEquipId = (s.equipProfiles[0] && s.equipProfiles[0].id) || null
    }),
  })
  // The plates you own, per unit (lib/plates.js) — what the set rows' plate lines load from.
  const plateSummary = ownsPlates(S)
    ? inventoryFor(S).map(p => fmtPlate(p.w) + '×' + p.n).join(' · ') || t('None')
    : t('Standard set — tap to count the pairs you own.')
  return <Section title={t('Equipment')} footer={t('Filters the exercise library and picker, and flags routine exercises that need something you don’t have in the active profile.')}>
    <Row icon="plate" iconTint="var(--orange)" title={t('Plates')} subtitle={plateSummary} accessory="chevron" onClick={() => plateInventorySheet()} />
    {profiles.length > 0 && <Row icon="dumbbell" iconTint="var(--acc)" title={t('Filter by equipment')}>
      <Switch checked={!!S.equipFilterOn} onChange={v => update(s => { s.equipFilterOn = v })} />
    </Row>}
    {profiles.length > 0 && <SelectRow icon="list" iconTint="var(--blue)" title={t('Active profile')}
      value={S.activeEquipId || ''} onChange={v => update(s => { s.activeEquipId = v })}
      options={profiles.map(p => ({ value: p.id, label: p.name }))} />}
    {profiles.map(p => (
      <Row key={p.id} icon="dumbbell" iconTint="var(--teal)" title={p.name}
        subtitle={t('{0} equipment types', p.equipment.length)} accessory="chevron"
        onClick={() => equipmentProfileSheet(p)}>
        <button className="iconbtn" aria-label={t('Delete')} onClick={ev => { ev.stopPropagation(); remove(p) }}><Icon name="trash" /></button>
      </Row>
    ))}
    <Row icon="plus" iconTint="var(--acc)" title={t('Add equipment profile')} accessory="chevron" onClick={() => equipmentProfileSheet(null)} />
  </Section>
}

/* After "Reset everything": the photos and videos go too. This device keeps only the files a
   stash refers to: another account's changes kept here are not this reset's to delete. */
async function clearMediaAfterReset() {
  const st = useStore.getState()
  const keep = typeof st.stashedMediaHashes === 'function' ? await st.stashedMediaHashes() : new Set()
  await mediaStore.retainOnly(keep)
}

