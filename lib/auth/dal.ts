import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { assertRole, parseRole, type Role } from '@/lib/auth/roles'

export async function getUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

export async function requireUser() {
  const user = await getUser()
  if (!user) redirect('/login')
  return user
}

/** Devuelve el rol del usuario logueado, o null si no hay sesión. */
export async function getRole(): Promise<Role | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  return parseRole(profile?.role)
}

/** Exige sesión + rol específico; si no, redirige. */
export async function requireRole(required: Role) {
  const role = await getRole()
  if (!role) redirect('/login')
  if (!assertRole(role, required)) redirect('/')
  return role
}
