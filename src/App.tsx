import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import MapView from './components/MapView'
import Rail from './components/Rail'
import Card from './components/Card'
import Login from './components/Login'
import { supabase, OWNER_EMAIL } from './lib/supabase'
import { useMountains } from './lib/useMountains'
import type { Area, Target } from './lib/types'

function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])
  return session
}

function useAreas() {
  const [areas, setAreas] = useState<Area[]>([])
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/ski-areas.json`).then((r) => r.json()).then(setAreas).catch(() => setAreas([]))
  }, [])
  return areas
}

export default function App() {
  if (window.location.pathname.replace(/\/$/, '') === '/login') return <Login />
  return <SkiMap />
}

function SkiMap() {
  const session = useSession()
  const editing = session?.user.email === OWNER_EMAIL
  const api = useMountains()
  const allAreas = useAreas()
  const [selected, setSelected] = useState<Target | null>(null)
  const [flyNonce, setFlyNonce] = useState(0)

  // Background ski areas: everything OpenSkiMap knows, minus Jake's.
  const areas = useMemo(() => {
    const linked = new Set(api.mountains.map((m) => m.openskimap_id).filter(Boolean))
    return allAreas.filter((a) => !linked.has(a.id))
  }, [allAreas, api.mountains])

  const select = useCallback((t: Target | null, fly: boolean) => {
    setSelected(t)
    if (t && fly) setFlyNonce((n) => n + 1)
    if (t?.kind === 'mine') requestAnimationFrame(() => document.getElementById(`row${t.id}`)?.scrollIntoView({ block: 'nearest' }))
  }, [])

  const mountain = selected?.kind === 'mine' ? api.mountains.find((m) => m.id === selected.id) ?? null : null
  const area = selected?.kind === 'area' ? allAreas.find((a) => a.id === selected.id) ?? null : null
  // A selection that no longer exists (a removed mountain) counts as none.
  const shown = mountain || area ? selected : null

  return (
    <div className="app">
      <MapView mountains={api.mountains} areas={areas} selected={shown} flyNonce={flyNonce} onSelect={select}>
        <Card mountain={mountain} area={area} editing={editing} api={api}
          onClose={() => setSelected(null)} onAdopted={(id) => setSelected({ kind: 'mine', id })} />
      </MapView>
      <Rail mountains={api.mountains} areas={areas} selected={shown} onSelect={select}
        signedIn={!!session} editing={editing} onSignOut={() => supabase.auth.signOut()} loadError={api.loadError} />
    </div>
  )
}
