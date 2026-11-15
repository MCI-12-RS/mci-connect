// Busca no servidor (E1.08, RN-04). O banco guarda a coluna `search_text` já
// normalizada por `public.search_normalize` (sem acento, minúsculas); aqui o
// texto digitado passa pela mesma normalização e vira um padrão ILIKE por
// palavra. Todas as palavras precisam aparecer.

export const SEARCH_MAX_LENGTH = 100;
export const SEARCH_MAX_TERMS = 5;

/** Sem acento e em minúsculas, como `public.search_normalize`. */
export function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Termo formado só por dígitos e pontuação de documento/telefone, como
// "123.456.789-09" ou "(51)99999-0000": vale pelos dígitos.
const NUMERIC_TERM = /^[\d.\-/()]+$/;

// Pontuação nas pontas da palavra não conta: "(Silva)" busca "silva". No meio
// da palavra, vale como texto ("a,b").
const EDGE_PUNCTUATION = /^[()[\]{}"'“”‘’,;:!?]+|[()[\]{}"'“”‘’,;:!?]+$/g;

function toTerm(word: string): string {
  if (NUMERIC_TERM.test(word) && /\d/.test(word)) return word.replace(/\D/g, "");
  return word.replace(EDGE_PUNCTUATION, "");
}

/** Escapa os curingas do LIKE. O `*` é curinga do PostgREST e é removido. */
function escapeLike(term: string): string {
  return term.replace(/\*/g, "").replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Converte o texto digitado em padrões `%termo%` para `.ilike("search_text", …)`.
 * Ignora maiúsculas e acentos, trata qualquer caractere como texto, remove
 * repetições e usa no máximo 5 palavras dos primeiros 100 caracteres.
 */
export function toSearchPatterns(input: string | null | undefined): string[] {
  if (!input) return [];
  const terms = normalizeSearch(input.slice(0, SEARCH_MAX_LENGTH))
    .split(/\s+/)
    .map(toTerm)
    .map(escapeLike)
    .filter((term) => term.length > 0);
  return Array.from(new Set(terms))
    .slice(0, SEARCH_MAX_TERMS)
    .map((term) => `%${term}%`);
}
