import { useState } from 'react'
import { supabase, SITE_URL } from '../lib/supabase'

// /login: the only way into the editor, and not linked from anywhere.
// Google sign-in, like the other apps on this Supabase project (see
// DECISIONS.md); only jakevig@gmail.com can write, whoever signs in.
export default function Login() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signIn() {
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${SITE_URL}/` } })
    if (error) { setError(error.message); setBusy(false) }
  }

  return (
    <main className="login">
      <h1>SKI AREAS</h1>
      <p>Sign in to edit.</p>
      <button className="btn" onClick={signIn} disabled={busy}>{busy ? 'Redirecting…' : 'Sign in with Google'}</button>
      {error && <p className="err" role="alert">{error}</p>}
      <p><a href="/">Back to the map</a></p>
    </main>
  )
}
