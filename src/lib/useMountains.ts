import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import type { Area, Mountain, Status, Trip } from './types'

// Every write is optimistic: state changes at once, the write goes to
// Supabase, and if it's refused the previous state comes back with an error
// for the card to show. RLS decides who may write; the UI only hides controls.

let tempId = -1
const nextTemp = () => tempId--

export function useMountains() {
  const [mountains, setMountains] = useState<Mountain[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [writeError, setWriteError] = useState<string | null>(null)
  const current = useRef(mountains)
  useEffect(() => { current.current = mountains }, [mountains])

  useEffect(() => {
    let live = true
    Promise.all([
      supabase.from('ski_mountains').select('id,name,region,country,lat,lon,status,openskimap_id'),
      supabase.from('ski_trips').select('id,mountain_id,year'),
    ]).then(([m, t]) => {
      if (!live) return
      const err = m.error || t.error
      if (err) { setLoadError(err.message); setLoaded(true); return }
      const byMountain = new Map<number, Trip[]>()
      for (const trip of t.data as Trip[]) {
        if (!byMountain.has(trip.mountain_id)) byMountain.set(trip.mountain_id, [])
        byMountain.get(trip.mountain_id)!.push(trip)
      }
      setMountains((m.data as Omit<Mountain, 'trips'>[]).map((row) => ({ ...row, trips: byMountain.get(row.id) ?? [] })))
      setLoaded(true)
    })
    return () => { live = false }
  }, [])

  /** Apply `change` now; run `write`; restore the snapshot if it fails. */
  const optimistic = useCallback(
    async <T,>(change: (ms: Mountain[]) => Mountain[], write: () => PromiseLike<{ data: T | null; error: { message: string } | null }>) => {
      const snapshot = current.current
      setWriteError(null)
      setMountains(change(snapshot))
      const { data, error } = await write()
      if (error) {
        setMountains(snapshot)
        setWriteError(error.message || 'Save failed.')
        return null
      }
      return data
    },
    [],
  )

  const patchMountain = (id: number, f: (m: Mountain) => Mountain) => (ms: Mountain[]) =>
    ms.map((m) => (m.id === id ? f(m) : m))
  const patchTrip = (mountainId: number, tripId: number, f: (t: Trip) => Trip) =>
    patchMountain(mountainId, (m) => ({ ...m, trips: m.trips.map((t) => (t.id === tripId ? f(t) : t)) }))

  const setYear = (mountainId: number, tripId: number, year: number | null) =>
    optimistic(patchTrip(mountainId, tripId, (t) => ({ ...t, year })), () =>
      supabase.from('ski_trips').update({ year }).eq('id', tripId).select('id').single(),
    )

  /** Adds a trip with no year; resolves to its real id once saved. */
  const addTrip = async (mountainId: number, year: number | null = null): Promise<number | null> => {
    const temp = nextTemp()
    const row = await optimistic<{ id: number }>(
      patchMountain(mountainId, (m) => ({ ...m, trips: [...m.trips, { id: temp, mountain_id: mountainId, year }] })),
      () => supabase.from('ski_trips').insert({ mountain_id: mountainId, year }).select('id').single(),
    )
    if (!row) return null
    setMountains((ms) => patchTrip(mountainId, temp, (t) => ({ ...t, id: row.id }))(ms))
    return row.id
  }

  const deleteTrip = (mountainId: number, tripId: number) =>
    optimistic(patchMountain(mountainId, (m) => ({ ...m, trips: m.trips.filter((t) => t.id !== tripId) })), () =>
      supabase.from('ski_trips').delete().eq('id', tripId).select('id').single(),
    )

  const setStatus = (mountainId: number, status: Status) =>
    optimistic(patchMountain(mountainId, (m) => ({ ...m, status })), () =>
      supabase.from('ski_mountains').update({ status }).eq('id', mountainId).select('id').single(),
    )

  /** Planned/wishlist → skied, with its first trip. */
  const markSkied = async (mountainId: number, year: number | null) => {
    const ok = await setStatus(mountainId, 'skied')
    if (ok) await addTrip(mountainId, year)
  }

  const removeMountain = (mountainId: number) =>
    optimistic((ms) => ms.filter((m) => m.id !== mountainId), () =>
      supabase.from('ski_mountains').delete().eq('id', mountainId).select('id').single(),
    )

  /** A background ski area becomes one of Jake's, copying its OpenSkiMap fields. */
  const addFromArea = async (area: Area, status: Status, year: number | null = null): Promise<number | null> => {
    const temp = nextTemp()
    const fields = {
      name: area.name, region: area.region, country: area.country,
      lat: area.lat, lon: area.lon, status, openskimap_id: area.id,
    }
    const row = await optimistic<{ id: number }>(
      (ms) => [...ms, { ...fields, id: temp, trips: [] }],
      () => supabase.from('ski_mountains').insert(fields).select('id').single(),
    )
    if (!row) return null
    setMountains((ms) => ms.map((m) => (m.id === temp ? { ...m, id: row.id } : m)))
    if (status === 'skied') await addTrip(row.id, year)
    return row.id
  }

  return {
    mountains, loaded, loadError, writeError, clearWriteError: () => setWriteError(null),
    setYear, addTrip, deleteTrip, setStatus, markSkied, removeMountain, addFromArea,
  }
}

export type MountainsApi = ReturnType<typeof useMountains>
