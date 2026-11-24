// Identificadores dos registros do banco.

// A forma canônica do UUID (8-4-4-4-12 dígitos hexadecimais), a que o banco
// devolve. Não exige versão nem variante: o tipo `uuid` do Postgres aceita qualquer uma.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O texto é um UUID, o formato do id de todo registro? Um id da URL fora desse
 * formato é descartado sem consultar o banco, que só responderia com erro.
 */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
