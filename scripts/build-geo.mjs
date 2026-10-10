// Base geography for the map: Natural Earth 10m land, admin-1 and lakes,
// clipped to North America, simplified, written as TopoJSON to public/data/.
// Run: node scripts/build-geo.mjs [simplify%]   (default below; target < 600 KB total)
import mapshaper from 'mapshaper'
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cached } from './fetch.mjs'

const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'
const OUT = fileURLToPath(new URL('../public/data/', import.meta.url))
const pct = process.argv[2] || '11%'

const land = await cached('ne_10m_land.geojson', NE + 'ne_10m_land.geojson')
const admin = await cached('ne_10m_admin_1_states_provinces_lakes.geojson', NE + 'ne_10m_admin_1_states_provinces_lakes.geojson')
const lakes = await cached('ne_10m_lakes.geojson', NE + 'ne_10m_lakes.geojson')

const common = `-simplify ${pct} keep-shapes -o format=topojson quantization=1e5`
await mapshaper.runCommands(`-i "${land}" name=land -clip bbox=-180,10,-40,80 ${common} "${OUT}land.json"`)
await mapshaper.runCommands(
  `-i "${admin}" name=admin -filter '["US","CA","MX"].includes(iso_a2)' -filter-fields iso_a2,name,postal ${common} "${OUT}admin.json"`
)
await mapshaper.runCommands(`-i "${lakes}" name=lakes -clip bbox=-140,25,-60,62 -filter 'scalerank <= 6' ${common} "${OUT}lakes.json"`)

let total = 0
for (const f of ['land', 'admin', 'lakes']) {
  const kb = statSync(`${OUT}${f}.json`).size / 1024
  total += kb
  console.log(`${f}.json ${kb.toFixed(0)} KB`)
}
console.log(`total ${total.toFixed(0)} KB at simplify ${pct}`)
