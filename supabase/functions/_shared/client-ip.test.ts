// Vitest (o Deno não é usado nesta máquina). E1.04: RN-11, DT-06, DA-1, DA-2.
import { describe, expect, it } from 'vitest'
import { clientIpFrom, LOCAL_FALLBACK_IP, normalizeIp } from './client-ip.ts'

const headers = (values: Record<string, string>) => new Headers(values)

describe('normalizeIp', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    [' 203.0.113.7 ', '203.0.113.7'],
    ['0.0.0.0', '0.0.0.0'],
    ['255.255.255.255', '255.255.255.255'],
  ])('aceita o IPv4 %j', (raw, expected) => {
    expect(normalizeIp(raw)).toBe(expected)
  })

  it.each([
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['::FFFF:203.0.113.7', '203.0.113.7'],
    ['::ffff:cb00:7107', '203.0.113.7'],
    ['0:0:0:0:0:ffff:cb00:7107', '203.0.113.7'],
  ])('IPv4 mapeado em IPv6 %j vira o IPv4', (raw, expected) => {
    expect(normalizeIp(raw)).toBe(expected)
  })

  it.each([
    ['2001:db8::1', '2001:db8:0:0:0:0:0:1'],
    ['2001:DB8:0000:0000:0000:0000:0000:0001', '2001:db8:0:0:0:0:0:1'],
    ['::1', '0:0:0:0:0:0:0:1'],
    ['::', '0:0:0:0:0:0:0:0'],
    ['fe80::', 'fe80:0:0:0:0:0:0:0'],
    ['1:2:3:4:5:6:7::', '1:2:3:4:5:6:7:0'],
    ['::2:3:4:5:6:7:8', '0:2:3:4:5:6:7:8'],
    ['64:ff9b::192.0.2.33', '64:ff9b:0:0:0:0:c000:221'],
  ])('aceita o IPv6 %j, por inteiro', (raw, expected) => {
    expect(normalizeIp(raw)).toBe(expected)
  })

  it.each([
    '',
    'abc',
    '256.1.1.1',
    '1.2.3',
    '1.2.3.4.5',
    '01.2.3.4',
    '1.2.3.4/24',
    '1.2.3.4:443',
    '203.0.113.7, 198.51.100.1',
    'fe80::1%eth0',
    '2001:db8::1/64',
    '1::2::3',
    ':1:2:3:4:5:6:7',
    '1:2:3:4:5:6:7:8:9',
    '1:2:3:4:5:6:7',
    '12345::1',
    '1.2.3.4::1',
    'g::1',
    'localhost',
  ])('recusa %j', (raw) => {
    expect(normalizeIp(raw)).toBeNull()
  })
})

describe('clientIpFrom', () => {
  it('usa só o CF-Connecting-IP', () => {
    const forged = headers({
      'CF-Connecting-IP': '203.0.113.7',
      'X-Forwarded-For': '198.51.100.1, 10.0.0.1',
      'X-Real-IP': '198.51.100.2',
      'True-Client-IP': '198.51.100.3',
      Forwarded: 'for=198.51.100.4',
    })
    expect(clientIpFrom(forged, { hosted: true })).toBe('203.0.113.7')
    expect(clientIpFrom(forged, { hosted: false })).toBe('203.0.113.7')
  })

  it('normaliza o IPv4 mapeado vindo do cabeçalho', () => {
    expect(clientIpFrom(headers({ 'CF-Connecting-IP': '::ffff:203.0.113.7' }), { hosted: true })).toBe('203.0.113.7')
  })

  it('hospedado sem CF-Connecting-IP: null, mesmo com X-Forwarded-For e afins (DA-1)', () => {
    const others = headers({
      'X-Forwarded-For': '198.51.100.1',
      'X-Real-IP': '198.51.100.2',
      'True-Client-IP': '198.51.100.3',
      Forwarded: 'for=198.51.100.4',
      'Sb-Forwarded-For': '198.51.100.5',
    })
    expect(clientIpFrom(others, { hosted: true })).toBeNull()
  })

  it('hospedado com CF-Connecting-IP inválido: null', () => {
    expect(clientIpFrom(headers({ 'CF-Connecting-IP': 'nao-e-ip' }), { hosted: true })).toBeNull()
    expect(clientIpFrom(headers({ 'CF-Connecting-IP': '' }), { hosted: true })).toBeNull()
  })

  it('local sem cabeçalho válido: 127.0.0.1', () => {
    expect(clientIpFrom(headers({}), { hosted: false })).toBe(LOCAL_FALLBACK_IP)
    expect(clientIpFrom(headers({ 'CF-Connecting-IP': 'nao-e-ip', 'X-Forwarded-For': '198.51.100.1' }), { hosted: false }))
      .toBe('127.0.0.1')
  })

  it('local com cabeçalho válido: o cabeçalho (o QA testa a origem de ponta a ponta)', () => {
    expect(clientIpFrom(headers({ 'CF-Connecting-IP': '2001:db8::7' }), { hosted: false })).toBe('2001:db8:0:0:0:0:0:7')
  })
})
