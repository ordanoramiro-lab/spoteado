import { createBrowserClient } from '@supabase/ssr'

// Usa process.env directo (Next inlinea NEXT_PUBLIC_* en el bundle del cliente).
// NO importar lib/env.ts acá: arrastraría el service role key al cliente.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
