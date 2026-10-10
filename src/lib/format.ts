import type { Mountain, Trip } from './types'

/** Trips by year, entered years first, oldest first. */
export const sortedTrips = (m: Mountain): Trip[] =>
  [...m.trips].sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.id - b.id)

export const years = (m: Mountain): number[] =>
  m.trips.map((t) => t.year).filter((y): y is number => y != null).sort((a, b) => a - b)

/** Trip count shown on the map, list and card: only skied mountains have trips. */
export const tripCount = (m: Mountain) => (m.status === 'skied' ? m.trips.length : 0)
