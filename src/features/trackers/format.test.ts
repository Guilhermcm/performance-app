// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { setLang } from '../../lib/i18n.js'
import { formatDuration, formatValue, parseNumberInput, whenText } from './format'
import { trackerOf } from './test-trackers'

describe('parseNumberInput', () => {
  it('reads the decimal comma in pt-BR', () => {
    expect(parseNumberInput('1,8', 'pt-BR', 1)).toBe(1.8)
  })

  it('rounds to the decimals of the tracker', () => {
    expect(parseNumberInput('72,6', 'pt-BR', 0)).toBe(73)
    expect(parseNumberInput('1,005', 'pt-BR', 2)).toBe(1.01)
    expect(parseNumberInput('-72,5', 'pt-BR', 0)).toBe(-73)
  })

  it('reads the decimal point in English', () => {
    expect(parseNumberInput('1.8', 'en', 1)).toBe(1.8)
    expect(parseNumberInput('1.8', 'en-GB', 1)).toBe(1.8)
  })

  it('takes the other separator alone before 1 or 2 digits, as a keypad of another region types it', () => {
    expect(parseNumberInput('1.8', 'pt-BR', 1)).toBe(1.8)
    expect(parseNumberInput('72.45', 'pt-BR', 2)).toBe(72.45)
    expect(parseNumberInput('-3.5', 'pt-BR', 1)).toBe(-3.5)
    expect(parseNumberInput('1,8', 'en', 1)).toBe(1.8)
    // Three digits after it read as thousands: refused, never guessed.
    expect(parseNumberInput('8.000', 'pt-BR', 0)).toBeNull()
    expect(parseNumberInput('8,000', 'en', 0)).toBeNull()
  })

  it('refuses any thousands separator', () => {
    expect(parseNumberInput('1.234,5', 'pt-BR', 1)).toBeNull()
    expect(parseNumberInput('1,234.5', 'en', 1)).toBeNull()
    expect(parseNumberInput('1,2,3', 'pt-BR', 1)).toBeNull()
  })

  it('refuses text that is not a number', () => {
    for (const text of ['abc', '', '  ', ',', '-', '1,', '1e3', '--1', '1 2', '0x10', 'Infinity']) {
      expect(parseNumberInput(text, 'pt-BR', 1), text).toBeNull()
    }
  })

  it('takes up to 10 integer digits, what the column holds', () => {
    expect(parseNumberInput('9999999999', 'pt-BR', 0)).toBe(9999999999)
    expect(parseNumberInput('12345678901', 'pt-BR', 0)).toBeNull()
    expect(parseNumberInput('-12345678901,5', 'pt-BR', 1)).toBeNull()
  })

  it('reads negatives, a leading separator and surrounding spaces', () => {
    expect(parseNumberInput('-3,5', 'pt-BR', 1)).toBe(-3.5)
    expect(parseNumberInput(',5', 'pt-BR', 1)).toBe(0.5)
    expect(parseNumberInput('  8000 ', 'pt-BR', 0)).toBe(8000)
    expect(parseNumberInput('-0,1', 'pt-BR', 0)).toBe(0)
    expect(Object.is(parseNumberInput('-0,1', 'pt-BR', 0), 0)).toBe(true)
  })

  it('uses the decimal separator of the language', () => {
    expect(parseNumberInput('1,8', 'de-DE', 1)).toBe(1.8)
    expect(parseNumberInput('1,8', 'pt', 1)).toBe(1.8)
    expect(parseNumberInput('1.8', 'zh-CN', 1)).toBe(1.8)
  })
})

describe('formatValue', () => {
  it('writes a number with its unit', () => {
    expect(formatValue(trackerOf({ unit: 'L', decimals: 1 }), 1.8, 'pt-BR')).toBe('1,8 L')
    expect(formatValue(trackerOf({ unit: 'kg', decimals: 1 }), 72.4, 'pt-BR')).toBe('72,4 kg')
    expect(formatValue(trackerOf({ unit: 'L', decimals: 1 }), 1.8, 'en-GB')).toBe('1.8 L')
  })

  it('groups thousands and pads to the decimals', () => {
    expect(formatValue(trackerOf({ unit: 'passos', decimals: 0 }), 8000, 'pt-BR')).toBe('8.000 passos')
    expect(formatValue(trackerOf({ unit: 'kg', decimals: 2 }), 72, 'pt-BR')).toBe('72,00 kg')
  })

  it('leaves the unit out when there is none', () => {
    expect(formatValue(trackerOf({ unit: null, decimals: 0 }), 12, 'pt-BR')).toBe('12')
  })

  it('uses 2 places when the tracker has no decimals set, as the server does', () => {
    expect(formatValue(trackerOf({ unit: '', decimals: null }), 12, 'pt-BR')).toBe('12,00')
  })

  it('never writes a negative zero', () => {
    expect(formatValue(trackerOf({ unit: 'L', decimals: 1 }), -0.04, 'pt-BR')).toBe('0,0 L')
    expect(formatValue(trackerOf({ unit: null, decimals: 0 }), -0, 'en')).toBe('0')
    expect(formatValue(trackerOf({ unit: null, decimals: 0 }), -0.6, 'en')).toBe('-1')
  })

  it('writes a duration as hours and minutes', () => {
    expect(formatValue(trackerOf({ kind: 'duration', unit: null, decimals: null }), 85, 'pt-BR')).toBe('1 h 25 min')
  })
})

describe('formatDuration', () => {
  it('writes minutes, hours and both', () => {
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(60)).toBe('1 h')
    expect(formatDuration(85)).toBe('1 h 25 min')
    expect(formatDuration(1570)).toBe('26 h 10 min')
  })

  it('rounds to the minute', () => {
    expect(formatDuration(84.6)).toBe('1 h 25 min')
    expect(formatDuration(0)).toBe('0 min')
  })
})

describe('whenText', () => {
  it('says today, yesterday and how many days ago', () => {
    expect(whenText('2026-10-16', '2026-10-16')).toBe('today')
    expect(whenText('2026-10-15', '2026-10-16')).toBe('yesterday')
    expect(whenText('2026-10-13', '2026-10-16')).toBe('3 days ago')
  })

  it('counts calendar days across a month and a year', () => {
    expect(whenText('2026-09-30', '2026-10-02')).toBe('2 days ago')
    expect(whenText('2025-12-31', '2026-01-02')).toBe('2 days ago')
  })

  it('treats a day after today as today', () => {
    expect(whenText('2026-10-17', '2026-10-16')).toBe('today')
  })
})

describe('in pt-BR', () => {
  afterEach(async () => { await setLang('en') })

  it('reads as the spec says', async () => {
    await setLang('pt-BR')
    expect(whenText('2026-10-16', '2026-10-16')).toBe('hoje')
    expect(whenText('2026-10-15', '2026-10-16')).toBe('ontem')
    expect(whenText('2026-10-13', '2026-10-16')).toBe('há 3 dias')
    expect(formatDuration(85)).toBe('1 h 25 min')
    expect(formatDuration(1570)).toBe('26 h 10 min')
  })
})
