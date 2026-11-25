// Erros do banco que a tela trata de um jeito específico.

/**
 * SQLSTATE de permissão negada (`insufficient_privilege`). É o código que as
 * funções do banco usam para recusar quem não tem a permissão exigida (por
 * exemplo, as RPCs do dashboard, RN-09 do E1.08).
 */
export const PERMISSION_DENIED = "42501";

/** O erro tem o código de permissão negada? Aceita qualquer valor lançado. */
export function isPermissionDenied(error: unknown): error is { code: typeof PERMISSION_DENIED } {
  return typeof error === "object" && error !== null && "code" in error && error.code === PERMISSION_DENIED;
}

/** Novas tentativas do padrão do TanStack Query. */
const DEFAULT_QUERY_RETRIES = 3;

/**
 * `retry` do TanStack Query: tenta de novo como o padrão, menos quando a
 * permissão foi negada. Repetir não muda a resposta e só atrasaria a mensagem
 * de acesso negado.
 */
export function retryUnlessPermissionDenied(failureCount: number, error: unknown): boolean {
  return !isPermissionDenied(error) && failureCount < DEFAULT_QUERY_RETRIES;
}

/** Um objeto JSON: chaves de texto e valores ainda não conferidos. */
export type JsonObject = { readonly [key: string]: unknown };

/** O valor é um objeto JSON (e não `null` nem uma lista)? */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `HINT` dos erros de regra do banco (E2.01, "Formato dos erros"): SQLSTATE
 * 22023, `MESSAGE` com o texto pronto para a tela e `DETAIL` com um JSON
 * `{ "code": …, … }`.
 */
export const APP_ERROR_HINT = "app_error";

/** Recusa de uma regra do banco, pronta para a tela. */
export interface AppError {
  /** O código da regra (`member_has_links`, `self_delete`…). Vazio se o banco não mandou os detalhes. */
  code: string;
  /** O texto do Negócio, como veio do banco. */
  message: string;
  /** O JSON dos detalhes, com o `code` e o que cada regra acrescenta. Vazio sem detalhes. */
  detail: JsonObject;
}

/**
 * Lê uma recusa já em JSON, no formato `{ code, message, … }`, como a da
 * pré-checagem da exclusão (`check_member_deletion`). `null` se faltar o
 * código ou a mensagem.
 */
export function toAppError(value: unknown): AppError | null {
  if (!isJsonObject(value)) return null;
  const { code, message } = value;
  if (typeof code !== "string" || code === "" || typeof message !== "string") return null;
  return { code, message, detail: value };
}

function parseDetail(details: unknown): JsonObject | null {
  if (typeof details !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(details);
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Lê um erro de regra do banco (`hint: "app_error"`), como o PostgREST o
 * devolve: `{ code: "22023", message, details: "<json>", hint }`. `null` para
 * qualquer outro erro (permissão, rede, erro técnico).
 *
 * Se os detalhes não vierem ou não forem um JSON com `code`, a recusa volta
 * com o código vazio: a tela mostra a mensagem como veio (UX-11).
 */
export function parseAppError(error: unknown): AppError | null {
  if (!isJsonObject(error) || error.hint !== APP_ERROR_HINT || typeof error.message !== "string") return null;
  const detail = parseDetail(error.details);
  const code = detail && typeof detail.code === "string" ? detail.code : "";
  return { code, message: error.message, detail: code ? detail : {} };
}

// O supabase-js não lança quando o fetch falha: devolve um erro sem código,
// com a mensagem "<nome do erro>: <mensagem>" (por exemplo, "TypeError: Failed
// to fetch" ou "AbortError: …" quando o tempo esgota).
const FETCH_FAILURE = /^(TypeError|FetchError|AbortError): /;

/**
 * A requisição não chegou ao servidor ou não teve resposta (queda de
 * conexão, tempo esgotado). Vale para o erro do PostgREST (tabelas e RPCs) e
 * para o das Edge Functions (`FunctionsFetchError`).
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) return error.name === "FunctionsFetchError";
  if (!isJsonObject(error)) return false;
  return error.code === "" && typeof error.message === "string" && FETCH_FAILURE.test(error.message);
}

/**
 * `retry` do TanStack Query para uma leitura que a pessoa espera olhando (o
 * painel "Ver relatório"): uma nova tentativa só, e só na queda de conexão.
 * Uma resposta de erro do servidor se repetiria. Com as 3 novas tentativas do
 * padrão, o erro e o "Tentar de novo" levariam cerca de 7 s para aparecer.
 */
export function retryOnceOnNetworkError(failureCount: number, error: unknown): boolean {
  return failureCount < 1 && isNetworkError(error);
}

/**
 * O corpo JSON da resposta de erro de uma Edge Function. O supabase-js guarda
 * a `Response` em `error.context` (`FunctionsHttpError`). `null` se não houver
 * resposta (queda de conexão) ou se o corpo não for JSON.
 */
export async function readFunctionErrorBody(error: unknown): Promise<unknown> {
  if (!(error instanceof Error) || !("context" in error)) return null;
  const { context } = error;
  if (!(context instanceof Response)) return null;
  try {
    const body: unknown = await context.json();
    return body;
  } catch {
    return null;
  }
}

/** Código da falha no recálculo da hierarquia (E2.06, AQ-5 e DT-14). */
export const RECALC_FAILURE_CODE = "hierarchy_update_failed";

/**
 * SQLSTATEs de falha transitória numa gravação que recalcula a hierarquia
 * (E2.06, "Formato dos erros"): *deadlock*, serialização, trava indisponível,
 * tempo-limite e erro interno. A classe 53 (recursos) entra inteira.
 */
const TRANSIENT_RECALC_STATES: ReadonlySet<string> = new Set(["40P01", "40001", "55P03", "57014", "XX000"]);

/**
 * A gravação falhou no recálculo da hierarquia ou por uma falha transitória
 * (E2.06, RN-08 e DT-14): a tela mostra "Não foi possível salvar as
 * alterações. Tente de novo.", nunca o texto técnico. A queda de conexão não
 * entra: continua com o texto do E2.04.
 */
export function isRecalcFailure(error: unknown): boolean {
  if (parseAppError(error)?.code === RECALC_FAILURE_CODE) return true;
  if (!isJsonObject(error) || typeof error.code !== "string") return false;
  return TRANSIENT_RECALC_STATES.has(error.code) || error.code.startsWith("53");
}
