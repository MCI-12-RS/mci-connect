// Origem do pedido de login (E1.04: RN-11, DT-06, DA-1 e DA-2).
//
// Módulo puro (sem Deno nem import remoto), testado pelo Vitest.
//
// Regra (sonda da tarefa 1 do E1.04):
// - a origem é SÓ o cabeçalho `CF-Connecting-IP`. O Cloudflare na frente do
//   `*.supabase.co` o preenche com o IP do cliente e recusa o pedido que o traz
//   forjado. `X-Forwarded-For`, `True-Client-IP`, `Forwarded` e `X-Real-IP`
//   nunca são lidos;
// - IPv4 mapeado em IPv6 (`::ffff:a.b.c.d`) vira o IPv4. O IPv6 vai inteiro;
//   o banco conta pelo prefixo /64 (`private.sign_in_origin_key`);
// - hospedado sem `CF-Connecting-IP` válido: null (a função responde 500, sem
//   contar). Na stack local: o cabeçalho, se vier válido, senão `127.0.0.1`.

/** O que a função lê dos cabeçalhos (o `Headers` do pedido satisfaz). */
export interface HeaderReader {
  get(name: string): string | null
}

/** Endereço usado na stack local quando o pedido não traz o cabeçalho. */
export const LOCAL_FALLBACK_IP = '127.0.0.1'

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const IPV6_GROUP_PATTERN = /^[0-9a-f]{1,4}$/i

/** Os 4 octetos de um IPv4 em notação decimal, sem zeros à esquerda; senão null. */
function parseIPv4(value: string): number[] | null {
  const match = IPV4_PATTERN.exec(value)
  if (!match) return null
  const octets: number[] = []
  for (const part of match.slice(1)) {
    if (part.length > 1 && part.startsWith('0')) return null
    const octet = Number(part)
    if (octet > 255) return null
    octets.push(octet)
  }
  return octets
}

/** Os grupos de 16 bits de uma parte de IPv6 (com IPv4 no fim, se houver); senão null. */
function parseIPv6Groups(part: string, allowTrailingIPv4: boolean): number[] | null {
  if (part === '') return []
  const pieces = part.split(':')
  const groups: number[] = []
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i]
    if (allowTrailingIPv4 && i === pieces.length - 1 && piece.includes('.')) {
      const octets = parseIPv4(piece)
      if (!octets) return null
      groups.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3])
    } else if (IPV6_GROUP_PATTERN.test(piece)) {
      groups.push(parseInt(piece, 16))
    } else {
      return null
    }
  }
  return groups
}

/** Os 8 grupos de 16 bits de um IPv6 (sem zona nem máscara); senão null. */
function parseIPv6(value: string): number[] | null {
  if (value.length > 45 || !value.includes(':')) return null
  const halves = value.split('::')
  if (halves.length > 2) return null

  if (halves.length === 1) {
    const groups = parseIPv6Groups(value, true)
    return groups && groups.length === 8 ? groups : null
  }

  const head = parseIPv6Groups(halves[0], false)
  const tail = parseIPv6Groups(halves[1], true)
  if (!head || !tail || head.length + tail.length > 7) return null
  return [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail]
}

/**
 * Valida e normaliza um endereço IP. IPv4: decimal com pontos. IPv4 mapeado em
 * IPv6: o IPv4. Outro IPv6: os 8 grupos em hexadecimal minúsculo. Qualquer
 * outra coisa (lista, máscara, zona, porta, nome): null.
 */
export function normalizeIp(raw: string): string | null {
  const value = raw.trim()
  const v4 = parseIPv4(value)
  if (v4) return v4.join('.')

  const v6 = parseIPv6(value)
  if (!v6) return null
  const mapped = v6.slice(0, 5).every((group) => group === 0) && v6[5] === 0xffff
  if (mapped) {
    return [v6[6] >> 8, v6[6] & 0xff, v6[7] >> 8, v6[7] & 0xff].join('.')
  }
  return v6.map((group) => group.toString(16)).join(':')
}

/**
 * A origem do pedido (DT-06). `hosted` vem de `isHostedSupabaseUrl`: hospedado
 * sem `CF-Connecting-IP` válido devolve null; local cai em `127.0.0.1`.
 */
export function clientIpFrom(headers: HeaderReader, options: { hosted: boolean }): string | null {
  const raw = headers.get('cf-connecting-ip')
  const ip = raw === null ? null : normalizeIp(raw)
  if (ip) return ip
  return options.hosted ? null : LOCAL_FALLBACK_IP
}
