// Every operating downhill ski area in the US, Canada and Mexico, from
// OpenSkiMap (OpenStreetMap data, ODbL), reduced to { id, name, lat, lon,
// region } and written to public/data/ski-areas.json. If the download fails
// it writes an empty list; the app works with only Jake's pins.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cached } from './fetch.mjs'

const URL_ = 'https://tiles.openskimap.org/geojson/ski_areas.geojson'
const OUT = fileURLToPath(new URL('../public/data/ski-areas.json', import.meta.url))
const BLOCKERS = fileURLToPath(new URL('../BLOCKERS.md', import.meta.url))
const COUNTRIES = new Set(['US', 'CA', 'MX'])

let fc
try {
  fc = JSON.parse(readFileSync(await cached('ski_areas.geojson', URL_), 'utf8'))
} catch (err) {
  appendFileSync(BLOCKERS, `\n## OpenSkiMap download failed\n${URL_}: ${err.message}. Background ski areas are empty; re-run \`node scripts/build-ski-areas.mjs\`.\n`)
  writeFileSync(OUT, '[]\n')
  console.error('download failed; wrote an empty list')
  process.exit(0)
}

// The spec names properties.location; the current export carries the same
// fields in properties.places[0]. Accept either.
// Area-weighted planar centroid of the largest polygon. (d3's spherical
// geoCentroid reads RFC 7946 winding as "everything but this ring" and lands
// on the far side of the globe.) Ski areas are small enough for planar math.
function centroid(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : null
  if (!polys) return null
  let best = null
  for (const [ring] of polys) {
    let a = 0, cx = 0, cy = 0
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x0, y0] = ring[j], [x1, y1] = ring[i]
      const c = x0 * y1 - x1 * y0
      a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c
    }
    if (a === 0) continue
    if (!best || Math.abs(a) > best.area) best = { area: Math.abs(a), pt: [cx / (3 * a), cy / (3 * a)] }
  }
  return best?.pt ?? polys[0]?.[0]?.[0] ?? null
}

const placeOf = (p) => p.location ?? p.places?.[0] ?? {}

const out = []
for (const f of fc.features) {
  const p = f.properties
  if (p.type !== 'skiArea' || !p.name) continue
  if (!p.activities?.includes('downhill')) continue
  if (p.status && p.status !== 'operating') continue
  const place = placeOf(p)
  if (!COUNTRIES.has(place.iso3166_1Alpha2)) continue
  if (!f.geometry) continue
  const pt = f.geometry.type === 'Point' ? f.geometry.coordinates : centroid(f.geometry)
  if (!pt) continue
  const [lon, lat] = pt
  out.push({
    id: p.id,
    name: p.name,
    lat: +lat.toFixed(4),
    lon: +lon.toFixed(4),
    region: (place.iso3166_2 || '').split('-')[1] || '',
    country: place.iso3166_1Alpha2,
  })
}
out.sort((a, b) => a.name.localeCompare(b.name))
writeFileSync(OUT, JSON.stringify(out))
console.log(`${out.length} ski areas → public/data/ski-areas.json`)
