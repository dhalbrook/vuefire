// @ts-check
// Bundles each entry in size-checks/ the way an app would and reports its size
// and which Firebase SDK packages end up in it. Run after `pnpm run build`.
//
// Exits non-zero if an entry pulls in a Firebase product it doesn't use: none of
// them declare `sideEffects`, so once imported they can't be tree-shaken and
// apps pay for them in full.
import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { build } from 'esbuild'

const ENTRIES_DIR = new URL('../size-checks/', import.meta.url)

/** Firebase packages each entry must not end up bundling. */
const FORBIDDEN = {
  'vuefire-auth.js': [
    '@firebase/app-check',
    '@firebase/database',
    '@firebase/firestore',
    '@firebase/storage',
  ],
  'vuefire-firestore.js': [
    '@firebase/app-check',
    '@firebase/database',
    '@firebase/storage',
    '@firebase/auth',
  ],
  'vuefire-rtdb.js': [
    '@firebase/app-check',
    '@firebase/firestore',
    '@firebase/storage',
    '@firebase/auth',
  ],
}

let failed = false
const entries = (await readdir(ENTRIES_DIR)).filter((f) => f.endsWith('.js'))
for (const entry of entries.sort()) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(entry, ENTRIES_DIR))],
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    external: ['vue', 'vue-demi'],
    metafile: true,
    write: false,
    logLevel: 'error',
  })
  const code = result.outputFiles[0].contents
  const firebasePackages = new Set(
    Object.values(result.metafile.outputs)
      .flatMap((output) => Object.entries(output.inputs))
      // files esbuild read but tree-shook away entirely still show up, with 0 bytes
      .filter(([, { bytesInOutput }]) => bytesInOutput > 0)
      .map(([input]) => input)
      .map((input) => input.match(/.*node_modules\/(@firebase\/[^/]+)\//)?.[1])
      .filter(Boolean)
  )
  console.log(
    `${entry.padEnd(22)} ${kb(code.length).padStart(9)} min ${kb(gzipSync(code).length).padStart(9)} gzip  ${[...firebasePackages].sort().join(' ')}`
  )
  const unexpected = (FORBIDDEN[entry] ?? []).filter((pkg) =>
    firebasePackages.has(pkg)
  )
  if (unexpected.length) {
    console.error(`  ✗ ${entry} should not bundle ${unexpected.join(', ')}`)
    failed = true
  }
}

if (failed) process.exit(1)

/** @param {number} bytes */
function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`
}
