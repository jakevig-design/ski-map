import { useMemo, useState } from 'react'
import type { Area, Mountain, Target } from '../lib/types'
import { samePick } from '../lib/types'
import { regionName } from '../lib/regions'
import { tripCount, years } from '../lib/format'

interface Props {
  mountains: Mountain[]
  areas: Area[] // background, already minus Jake's
  selected: Target | null
  onSelect: (pick: Target, fly: boolean) => void
  signedIn: boolean
  editing: boolean
  onSignOut: () => void
  loadError: string | null
}

const STATUS_ORDER = { skied: 0, planned: 1, wishlist: 2 } as const
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export default function Rail({ mountains, areas, selected, onSelect, signedIn, editing, onSignOut, loadError }: Props) {
  const skied = mountains.filter((m) => m.status === 'skied')
  const trips = skied.reduce((n, m) => n + m.trips.length, 0)
  const regions = new Set(skied.map((m) => `${m.country}-${m.region}`)).size
  const hasWishlist = mountains.some((m) => m.status === 'wishlist')

  // Groups by region, west to east by the group's average longitude.
  const groups = useMemo(() => {
    const by = new Map<string, Mountain[]>()
    for (const m of mountains) {
      const k = `${m.country}-${m.region}`
      if (!by.has(k)) by.set(k, [])
      by.get(k)!.push(m)
    }
    return [...by.values()]
      .map((ms) => ({
        name: regionName(ms[0].region, ms[0].country),
        lon: ms.reduce((a, m) => a + m.lon, 0) / ms.length,
        skied: ms.filter((m) => m.status === 'skied').length,
        rows: ms.slice().sort((a, b) =>
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || tripCount(b) - tripCount(a) || a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.lon - b.lon)
  }, [mountains])

  return (
    <aside className="rail">
      <div className="stats">
        <div className="stat"><b>{skied.length}</b><span>Mountains</span></div>
        <div className="stat"><b>{trips}</b><span>Trips</span></div>
        <div className="stat"><b>{regions}</b><span>States &amp; prov.</span></div>
      </div>
      <div className="bar">
        <div className="legend">
          <span><i style={{ background: 'var(--pin)' }} />Skied</span>
          <span><i style={{ background: 'var(--plan)' }} />Planned</span>
          {hasWishlist && <span><i className="hollow" />Wishlist</span>}
        </div>
      </div>
      <Search mountains={mountains} areas={areas} onSelect={onSelect} />
      <div className="list">
        {loadError && <p className="err pad">Couldn’t load the map’s mountains: {loadError}</p>}
        {groups.map((g) => (
          <section key={g.name}>
            <div className="grp"><span>{g.name}</span><span>{g.skied}</span></div>
            {g.rows.map((m) => {
              const ys = years(m), n = tripCount(m)
              const isSel = samePick(selected, { kind: 'mine', id: m.id })
              return (
                <button key={m.id} id={`row${m.id}`} className={`row ${m.status}${isSel ? ' sel' : ''}`}
                  onClick={() => onSelect({ kind: 'mine', id: m.id }, true)}>
                  <span className="n">{m.name}</span>
                  <span className="meta">
                    {m.status === 'skied' ? (
                      <>
                        <span className="yrs">{ys.length ? ys.join(' · ') : <span className="tbd">Year TBD</span>}</span>
                        {n > 1 && <span className="cnt">{n}×</span>}
                      </>
                    ) : (
                      <span className={`tag ${m.status}`}>{m.status === 'planned' ? 'Planned' : 'Wishlist'}</span>
                    )}
                  </span>
                </button>
              )
            })}
          </section>
        ))}
      </div>
      <footer className="foot">
        {signedIn && (
          <p className="auth-line">{editing ? 'Editing' : 'Signed in'} · <button className="link" onClick={onSignOut}>Sign out</button></p>
        )}
        <p>Map data © OpenStreetMap contributors, OpenSkiMap, Natural Earth</p>
      </footer>
    </aside>
  )
}

function Search({ mountains, areas, onSelect }: Pick2) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const results = useMemo(() => {
    const needle = fold(q.trim())
    if (needle.length < 2) return []
    const mine = mountains.filter((m) => fold(m.name).includes(needle))
      .map((m) => ({ pick: { kind: 'mine', id: m.id } as Target, name: m.name, region: m.region, country: m.country, mine: true }))
    const bg = areas.filter((a) => fold(a.name).includes(needle))
      .map((a) => ({ pick: { kind: 'area', id: a.id } as Target, name: a.name, region: a.region, country: a.country, mine: false }))
    const starts = (s: string) => (fold(s).startsWith(needle) ? 0 : 1)
    return [...mine, ...bg].sort((a, b) => Number(b.mine) - Number(a.mine) || starts(a.name) - starts(b.name) || a.name.localeCompare(b.name)).slice(0, 8)
  }, [q, mountains, areas])

  const choose = (i: number) => {
    const r = results[i]
    if (!r) return
    onSelect(r.pick, true)
    setQ('')
  }

  return (
    <div className="search">
      <input
        type="search" placeholder="Find a ski area" value={q} aria-label="Find a ski area"
        role="combobox" aria-expanded={results.length > 0} aria-controls="search-results" aria-autocomplete="list"
        onChange={(e) => { setQ(e.target.value); setActive(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
          else if (e.key === 'Enter') { e.preventDefault(); choose(active) }
          else if (e.key === 'Escape') setQ('')
        }}
      />
      {results.length > 0 && (
        <ul className="results" id="search-results" role="listbox">
          {results.map((r, i) => (
            <li key={`${r.pick.kind}${r.pick.id}`} role="option" aria-selected={i === active}
              className={i === active ? 'active' : ''} onMouseDown={(e) => { e.preventDefault(); choose(i) }}>
              <span className={r.mine ? 'n mine' : 'n'}>{r.name}</span>
              <span className="r">{regionName(r.region, r.country)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type Pick2 = Pick<Props, 'mountains' | 'areas' | 'onSelect'>
