// The chunks the app loads on demand that still have to work offline from the first launch: the
// TACO table and its suggested measures (food search), ZXing (barcode scanner without BarcodeDetector) and the pillar radar
// (Recharts). public/sw.js precaches what index.html references; these are not in it, so the
// build writes their file names into the worker (vite.config.ts, swStamp). The locale packs and
// the other lazy chunks stay out on purpose: together they are many megabytes, and the runtime
// network-first cache keeps whichever ones a device has used.
export const ON_DEMAND_MODULES = [
  /\/src\/features\/nutrition\/data\/taco(-measures)?\.json$/,
  /\/node_modules\/@zxing\/library\//,
  /\/src\/features\/home\/PillarRadar\.tsx$/
]

// The slot in public/sw.js: valid JavaScript as it stands (an empty list for the dev server and
// the tests), replaced with the real list at build.
export const ON_DEMAND_SLOT = '/*__ON_DEMAND__*/[]'

/** A Rollup/Rolldown output bundle → './assets/…' paths of the chunks holding a matching module,
 *  the chunks they import and their CSS. Entry chunks are left out: index.html already has them. */
export function onDemandFiles(bundle, matchers = ON_DEMAND_MODULES) {
  const chunks = Object.values(bundle).filter(c => c.type === 'chunk')
  const byName = new Map(chunks.map(c => [c.fileName, c]))
  const ids = c => (c.moduleIds ?? Object.keys(c.modules ?? {})).map(id => id.replace(/\\/g, '/'))
  const out = new Set()
  const visit = c => {
    if (!c || c.isEntry || out.has(c.fileName)) return
    out.add(c.fileName)
    for (const css of c.viteMetadata?.importedCss ?? []) out.add(css)
    for (const i of c.imports ?? []) visit(byName.get(i))
  }
  for (const c of chunks) if (ids(c).some(id => matchers.some(m => m.test(id)))) visit(c)
  return [...out].sort().map(f => './' + f)
}

export function stampOnDemand(src, files) {
  if (!src.includes(ON_DEMAND_SLOT)) throw new Error('sw.js: ON_DEMAND slot not found')
  return src.replace(ON_DEMAND_SLOT, JSON.stringify(files))
}
