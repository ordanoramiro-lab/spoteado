import { z } from 'zod'

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  JINA_API_KEY: z.string().min(1),
})

export type Env = z.infer<typeof schema>

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source)
  if (!result.success) {
    throw new Error(`Variables de entorno inválidas: ${result.error.message}`)
  }
  return result.data
}

// Validado una sola vez al importar desde el servidor.
export const env = parseEnv(process.env)
