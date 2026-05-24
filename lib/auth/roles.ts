export const ROLES = ['photographer', 'surfer'] as const
export type Role = (typeof ROLES)[number]

export function parseRole(value: unknown): Role | null {
  return ROLES.includes(value as Role) ? (value as Role) : null
}

export function assertRole(userRole: Role, required: Role): boolean {
  return userRole === required
}
