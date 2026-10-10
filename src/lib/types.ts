export type Status = 'skied' | 'planned' | 'wishlist'

export interface Trip {
  id: number // negative while an insert is in flight
  mountain_id: number
  year: number | null
}

export interface Mountain {
  id: number // negative while an insert is in flight
  name: string
  region: string
  country: string
  lat: number
  lon: number
  status: Status
  openskimap_id: string | null
  trips: Trip[]
}

/** A ski area from public/data/ski-areas.json (OpenSkiMap). */
export interface Area {
  id: string
  name: string
  lat: number
  lon: number
  region: string
  country: string
}

/** What the map and card point at: one of Jake's mountains, or a background area. */
export type Target = { kind: 'mine'; id: number } | { kind: 'area'; id: string }

export const samePick = (a: Target | null, b: Target | null) =>
  !!a && !!b && a.kind === b.kind && a.id === b.id
