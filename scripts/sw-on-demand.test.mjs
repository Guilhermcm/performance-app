/* The on-demand chunks the build hands the service worker to precache (scripts/sw-on-demand.mjs),
   and the worker caching them at install (public/sw.js). */
import { describe, expect, it, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ON_DEMAND_SLOT, onDemandFiles, stampOnDemand } from './sw-on-demand.mjs'

const chunk = (fileName, moduleIds, extra = {}) => ({ type: 'chunk', fileName, moduleIds, imports: [], isEntry: false, ...extra })

describe('onDemandFiles', () => {
  const bundle = {
    'assets/index-a.js': chunk('assets/index-a.js', ['/app/src/main.jsx'], { isEntry: true }),
    'assets/i18n-b.js': chunk('assets/i18n-b.js', ['/app/src/lib/i18n.js']),
    'assets/taco-c.js': chunk('assets/taco-c.js', ['/app/src/features/nutrition/data/taco.json']),
    'assets/PillarRadar-d.js': chunk('assets/PillarRadar-d.js', ['/app/src/features/home/PillarRadar.tsx'],
      { imports: ['assets/index-a.js', 'assets/recharts-e.js'], viteMetadata: { importedCss: new Set(['assets/PillarRadar-d.css']) } }),
    'assets/recharts-e.js': chunk('assets/recharts-e.js', ['/app/node_modules/recharts/es6/index.js']),
    'assets/esm-f.js': chunk('assets/esm-f.js', ['/app/node_modules/@zxing/library/esm/index.js']),
    'assets/pt-BR-g.js': chunk('assets/pt-BR-g.js', ['/app/src/locales/pt-BR.js']),
    'assets/PillarRadar-d.css': { type: 'asset', fileName: 'assets/PillarRadar-d.css' }
  }

  it('lists the TACO, ZXing and radar chunks with what they import, never the entry or the locale packs', () => {
    expect(onDemandFiles(bundle)).toEqual([
      './assets/PillarRadar-d.css', './assets/PillarRadar-d.js', './assets/esm-f.js', './assets/recharts-e.js', './assets/taco-c.js'
    ])
  })

  it('lists the suggested measures chunk next to the TACO one, so food search works offline from the first launch', () => {
    const b = {
      'assets/taco-c.js': chunk('assets/taco-c.js', ['/app/src/features/nutrition/data/taco.json']),
      'assets/taco-measures-h.js': chunk('assets/taco-measures-h.js', ['/app/src/features/nutrition/data/taco-measures.json'])
    }
    expect(onDemandFiles(b)).toEqual(['./assets/taco-c.js', './assets/taco-measures-h.js'])
  })

  it('reads Windows module ids too', () => {
    const b = { 'assets/taco-c.js': chunk('assets/taco-c.js', ['C:\\app\\src\\features\\nutrition\\data\\taco.json']) }
    expect(onDemandFiles(b)).toEqual(['./assets/taco-c.js'])
  })
})

describe('stampOnDemand', () => {
  it('writes the list into the worker', () => {
    const src = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
    expect(src).toContain(ON_DEMAND_SLOT)
    expect(stampOnDemand(src, ['./assets/taco-c.js'])).toContain('const ON_DEMAND = ["./assets/taco-c.js"]')
  })
  it('fails the build when the slot is gone, rather than ship a worker without the list', () => {
    expect(() => stampOnDemand('const X = 1', [])).toThrow(/ON_DEMAND/)
  })
})

// --- the worker, stamped, in a stand-in environment (see src/lib/sw.test.js) ---
class FakeCache {
  constructor() { this.m = new Map() }
  async put(req, res) { this.m.set(String(req.url || req), res) }
  async add(u) { const r = await globalThis.fetch(u); if (!r.ok) throw new Error('add failed'); this.m.set(String(u), r) }
  async match(req) { return this.m.get(String(req.url || req)) }
  keys() { return [...this.m.keys()] }
}
class FakeCaches {
  constructor() { this.c = new Map() }
  async open(n) { if (!this.c.has(n)) this.c.set(n, new FakeCache()); return this.c.get(n) }
  async keys() { return [...this.c.keys()] }
  async delete(n) { return this.c.delete(n) }
}
const handlers = {}
let skipWaiting = 0
async function loadStampedSW(files) {
  const dir = mkdtempSync(join(tmpdir(), 'sw-on-demand-'))
  const file = join(dir, 'sw.js')
  writeFileSync(file, stampOnDemand(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), files))
  skipWaiting = 0
  globalThis.self = {
    addEventListener: (type, fn) => { handlers[type] = fn },
    skipWaiting: () => { skipWaiting++ },
    clients: { claim: async () => {} },
    registration: {}
  }
  globalThis.location = { origin: 'https://gym.test', href: 'https://gym.test/' }
  globalThis.caches = new FakeCaches()
  await import(pathToFileURL(file).href)
}
const install = async () => {
  let done
  handlers.install({ waitUntil: p => { done = p } })
  await done
}
const shellHtml = '<html><head><script src="./assets/index-new.js"></script></head></html>'
const ok = { ok: true, status: 200, redirected: false }

beforeEach(() => { delete globalThis.self })

describe('sw.js precache of the on-demand chunks', () => {
  it('caches them at install, so the first offline open already has them', async () => {
    await loadStampedSW(['./assets/taco-c.js', './assets/PillarRadar-d.js'])
    globalThis.fetch = async u => (String(u) === 'index.html' ? { ...ok, text: async () => shellHtml } : { ...ok })
    await install()
    expect(skipWaiting).toBe(1)
    const c = await globalThis.caches.open('performance-rt-__BUILD__')
    expect(c.keys()).toEqual(expect.arrayContaining(['./assets/index-new.js', './assets/taco-c.js', './assets/PillarRadar-d.js', 'index.html']))
  })

  it('a missing or redirected on-demand chunk is skipped, not worth failing the install', async () => {
    await loadStampedSW(['./assets/taco-c.js', './assets/PillarRadar-d.js'])
    globalThis.fetch = async u => {
      const s = String(u)
      if (s === 'index.html') return { ...ok, text: async () => shellHtml }
      if (s.includes('taco')) return { ok: false, status: 404, redirected: false }
      if (s.includes('PillarRadar')) return { ...ok, redirected: true }
      return { ...ok }
    }
    await install()
    expect(skipWaiting).toBe(1)
    const keys = (await globalThis.caches.open('performance-rt-__BUILD__')).keys()
    expect(keys).toContain('index.html')
    expect(keys).not.toContain('./assets/taco-c.js')
    expect(keys).not.toContain('./assets/PillarRadar-d.js')
  })
})

describe('sw.js offline answers', () => {
  it('match a cached chunk whatever its Vary header says', async () => {
    // A server that sends `Vary: Origin` (vite preview, some CDNs) stores the precached copy under
    // a request without Origin; the module import that asks for it later carries one. The files
    // are content-hashed, so Vary means nothing to them.
    await loadStampedSW([])
    const seen = []
    globalThis.caches.match = async (req, opts) => { seen.push(opts); return { ok: true, from: 'cache' } }
    globalThis.fetch = async () => { throw new TypeError('offline') }
    let res
    handlers.fetch({ request: { url: 'https://gym.test/assets/taco-c.js', method: 'GET', mode: 'cors' }, respondWith: p => { res = p }, waitUntil: () => {} })
    expect(await res).toEqual({ ok: true, from: 'cache' })
    expect(seen[0]).toMatchObject({ ignoreVary: true })
  })
})
