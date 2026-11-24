// Vitest. E1.04: DT-06 (ambiente), DA-1, DT-10 e risco 7 (chave secreta nova).
import { describe, expect, it } from 'vitest'
import { defaultSecretKey, isHostedSupabaseUrl, resolveServiceKey } from './env.ts'

describe('isHostedSupabaseUrl', () => {
  it.each([
    'http://kong:8000',
    'http://localhost:54321',
    'http://127.0.0.1:54321',
    'http://host.docker.internal:54321',
    'http://LOCALHOST:54321',
  ])('%s é local', (url) => {
    expect(isHostedSupabaseUrl(url)).toBe(false)
  })

  it.each([
    'https://abcdefghijklmnopqrst.supabase.co',
    'https://kong.example.com',
    'https://localhost.example.com',
    'http://[::1]:54321',
    'http://10.0.0.5:8000',
    'nao-e-url',
    '',
    undefined,
    null,
  ])('%j conta como hospedado (falha fechada)', (url) => {
    expect(isHostedSupabaseUrl(url)).toBe(true)
  })
})

describe('defaultSecretKey', () => {
  it('lê a chave default do JSON', () => {
    expect(defaultSecretKey('{"default":"sb_secret_abc"}')).toBe('sb_secret_abc')
  })

  it.each([undefined, null, '', 'nao-e-json', '[]', '{}', '{"default":""}', '{"default":1}', '"sb_secret_abc"'])(
    '%j não tem chave',
    (value) => {
      expect(defaultSecretKey(value)).toBeNull()
    },
  )
})

describe('resolveServiceKey', () => {
  const secretKeysJson = '{"default":"sb_secret_abc"}'

  it('usa a chave secreta nova quando existe, hospedado ou local', () => {
    expect(resolveServiceKey({ secretKeysJson, serviceRoleKey: 'legada', hosted: true })).toBe('sb_secret_abc')
    expect(resolveServiceKey({ secretKeysJson, serviceRoleKey: 'legada', hosted: false })).toBe('sb_secret_abc')
  })

  it('hospedado, recusa a chave legada: sem a secreta nova não há chave', () => {
    expect(resolveServiceKey({ secretKeysJson: undefined, serviceRoleKey: 'legada', hosted: true })).toBeNull()
    expect(resolveServiceKey({ secretKeysJson: '{}', serviceRoleKey: 'legada', hosted: true })).toBeNull()
  })

  it('local, cai na service role', () => {
    expect(resolveServiceKey({ secretKeysJson: undefined, serviceRoleKey: 'legada', hosted: false })).toBe('legada')
    expect(resolveServiceKey({ secretKeysJson: undefined, serviceRoleKey: '', hosted: false })).toBeNull()
  })
})
