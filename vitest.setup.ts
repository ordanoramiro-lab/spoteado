import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'
import React from 'react'

// Mock next/image to avoid URL validation errors in jsdom
vi.mock('next/image', () => ({
  default: ({ src, alt, width, height, className }: { src: string; alt: string; width?: number; height?: number; className?: string }) =>
    React.createElement('img', { src, alt, width, height, className }),
}))

// Mock next/link to render a plain anchor in jsdom
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    React.createElement('a', { href, className }, children),
}))

// Env dummy para que los módulos que importan `lib/env` (que valida al cargar)
// no crasheen en los tests. Los tests de parseEnv pasan sus propios fixtures.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://test.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service'
process.env.JINA_API_KEY ??= 'test-jina'
process.env.QDRANT_URL ??= 'https://test.qdrant.io'
process.env.QDRANT_API_KEY ??= 'test-qdrant'
process.env.MP_ACCESS_TOKEN ??= 'test-mp'
process.env.MP_WEBHOOK_SECRET ??= 'test-mp-secret'
process.env.NEXT_PUBLIC_SITE_URL ??= 'http://localhost:3000'
process.env.CRON_SECRET ??= 'test-cron'
