import { useEffect, useRef, useState } from 'react'
import type { Area, Mountain, Status } from '../lib/types'
import type { MountainsApi } from '../lib/useMountains'
import { regionName } from '../lib/regions'
import { sortedTrips } from '../lib/format'

interface Props {
  mountain: Mountain | null
  area: Area | null // a background ski area, when that's what's selected
  editing: boolean
  api: MountainsApi
  onClose: () => void
  /** After a background area becomes one of Jake's, select the new mountain. */
  onAdopted: (id: number) => void
}

const thisYear = () => new Date().getFullYear()
const validYear = (v: string) => { const n = parseInt(v, 10); return n >= 1970 && n <= 2100 ? n : null }

export default function Card({ mountain, area, editing, api, onClose, onAdopted }: Props) {
  // Reset transient UI whenever the card switches to another mountain.
  const key = mountain ? `m${mountain.id}` : area ? `a${area.id}` : ''
  return key ? <CardBody key={key} {...{ mountain, area, editing, api, onClose, onAdopted }} /> : null
}

function CardBody({ mountain: m, area, editing, api, onClose, onAdopted }: Props) {
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [skiedYear, setSkiedYear] = useState<string | null>(null) // open = "Mark as skied" year input
  const [focusTrip, setFocusTrip] = useState<number | null>(null)
  const yearInputs = useRef(new Map<number, HTMLInputElement>())

  useEffect(() => {
    if (focusTrip == null) return
    yearInputs.current.get(focusTrip)?.focus()
  }, [focusTrip, m?.trips])

  useEffect(() => () => api.clearWriteError(), []) // eslint-disable-line react-hooks/exhaustive-deps

  const name = m?.name ?? area!.name
  const region = regionName(m?.region ?? area!.region, m?.country ?? area!.country)
  const status: Status | 'none' = m?.status ?? 'none'

  async function addTrip() {
    if (!m) return
    const id = await api.addTrip(m.id)
    if (id != null) setFocusTrip(id)
  }

  async function confirmSkied() {
    const year = skiedYear ? validYear(skiedYear) : null
    if (m) await api.markSkied(m.id, year)
    else if (area) { const id = await api.addFromArea(area, 'skied', year); if (id != null) onAdopted(id) }
    setSkiedYear(null)
  }

  async function adopt(s: Status) {
    if (!area) return
    const id = await api.addFromArea(area, s)
    if (id != null) onAdopted(id)
  }

  const markSkiedControl = skiedYear != null ? (
    <form className="inline-year" onSubmit={(e) => { e.preventDefault(); confirmSkied() }}>
      <label>
        <span>Year</span>
        <input className="yin" type="number" inputMode="numeric" min={1970} max={2100} autoFocus
          value={skiedYear} onChange={(e) => setSkiedYear(e.target.value)} aria-label="Year skied" />
      </label>
      <button className="btn" type="submit">Save</button>
      <button className="btn ghost" type="button" onClick={() => setSkiedYear(null)}>Cancel</button>
    </form>
  ) : (
    <button className="btn" onClick={() => setSkiedYear(String(thisYear()))}>Mark as skied</button>
  )

  return (
    <div className={`card ${status}${editing ? ' edit' : ''}`} onClick={(e) => e.stopPropagation()}>
      <button className="close" aria-label="Close" onClick={onClose}>&times;</button>
      <h2>{name}</h2>
      <div className="sub">{region}</div>

      {status === 'skied' && m && (
        <>
          <div className="big"><b>{m.trips.length}×</b><span>{m.trips.length === 1 ? 'trip' : 'trips'}</span></div>
          <ul className="trips">
            {sortedTrips(m).map((t, j) => (
              <li key={t.id}>
                <span className="ord">Trip {j + 1}</span>
                {editing ? (
                  <span className="trip-edit">
                    {confirmDelete === t.id ? (
                      <>
                        <span className="confirm-q">Delete?</span>
                        <button className="btn danger small" onClick={() => { setConfirmDelete(null); api.deleteTrip(m.id, t.id) }}>Delete</button>
                        <button className="btn ghost small" onClick={() => setConfirmDelete(null)}>Keep</button>
                      </>
                    ) : (
                      <>
                        <input
                          className="yin" type="number" inputMode="numeric" min={1970} max={2100} placeholder="Year"
                          defaultValue={t.year ?? ''} disabled={t.id < 0} aria-label={`Year of trip ${j + 1}`}
                          ref={(el) => { if (el) yearInputs.current.set(t.id, el); else yearInputs.current.delete(t.id) }}
                          onChange={(e) => {
                            const v = e.target.value
                            const y = v === '' ? null : validYear(v)
                            if ((v === '' || y != null) && y !== t.year) api.setYear(m.id, t.id, y)
                          }}
                        />
                        <button className="icon-btn" aria-label={`Delete trip ${j + 1}`} onClick={() => setConfirmDelete(t.id)} disabled={t.id < 0}>&times;</button>
                      </>
                    )}
                  </span>
                ) : (
                  <span className={`yr${t.year ? '' : ' tbd'}`}>{t.year ?? 'Year TBD'}</span>
                )}
              </li>
            ))}
          </ul>
          {editing && (
            <div className="actions">
              <button className="btn" onClick={addTrip}>Add trip</button>
              {/* With its last trip deleted, a mountain can go back on a list. */}
              {m.trips.length === 0 && (
                <>
                  <button className="btn ghost" onClick={() => api.setStatus(m.id, 'planned')}>Move to planned</button>
                  <button className="btn ghost" onClick={() => api.setStatus(m.id, 'wishlist')}>Move to wishlist</button>
                  {confirmRemove ? (
                    <span className="trip-edit">
                      <span className="confirm-q">Remove?</span>
                      <button className="btn danger small" onClick={() => { api.removeMountain(m.id); onClose() }}>Remove</button>
                      <button className="btn ghost small" onClick={() => setConfirmRemove(false)}>Keep</button>
                    </span>
                  ) : (
                    <button className="btn ghost" onClick={() => setConfirmRemove(true)}>Remove</button>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}

      {(status === 'planned' || status === 'wishlist') && m && (
        <>
          <div className="big"><b>0×</b><span>{status === 'planned' ? 'On the list' : 'On the wishlist'}</span></div>
          {editing && (
            <div className="actions">
              {markSkiedControl}
              {skiedYear == null && (
                <>
                  <button className="btn ghost" onClick={() => api.setStatus(m.id, status === 'planned' ? 'wishlist' : 'planned')}>
                    {status === 'planned' ? 'Move to wishlist' : 'Move to planned'}
                  </button>
                  {confirmRemove ? (
                    <span className="trip-edit">
                      <span className="confirm-q">Remove?</span>
                      <button className="btn danger small" onClick={() => { api.removeMountain(m.id); onClose() }}>Remove</button>
                      <button className="btn ghost small" onClick={() => setConfirmRemove(false)}>Keep</button>
                    </span>
                  ) : (
                    <button className="btn ghost" onClick={() => setConfirmRemove(true)}>Remove</button>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}

      {status === 'none' && area && (
        <>
          <div className="big none"><span>Not skied yet</span></div>
          {editing && (
            <div className="actions">
              {markSkiedControl}
              {skiedYear == null && (
                <>
                  <button className="btn plan" onClick={() => adopt('planned')}>Add to planned</button>
                  <button className="btn ghost" onClick={() => adopt('wishlist')}>Add to wishlist</button>
                </>
              )}
            </div>
          )}
        </>
      )}

      {api.writeError && <p className="err" role="alert">Couldn’t save: {api.writeError}</p>}
    </div>
  )
}
