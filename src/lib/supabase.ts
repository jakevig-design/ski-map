import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)

/** The one account the database lets write (see 001_ski_schema.sql). */
export const OWNER_EMAIL = 'jakevig@gmail.com'

/** Where sign-in returns to. Set VITE_SITE_URL when the app moves hosts. */
export const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined) || window.location.origin
