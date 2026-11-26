// O que a gravação devolve sobre a mudança (E2.05, AQ-7). Sem React e sem Supabase.

/**
 * A edição não mudou nada no servidor? O PATCH devolve o `updated_at` da
 * linha, que só o carimbo do banco muda, e só numa mudança real de dado
 * (RN-04, DT-02). Igual ao carregado ao abrir o formulário: nada mudou (o
 * banco normalizou o valor, por exemplo o celular escrito de outro jeito).
 *
 * `loaded` indefinido (a linha que abriu o formulário não trouxe a coluna) não
 * permite comparar: conta como mudança, e a tela mostra o toast de sucesso.
 * Os dois nulos querem dizer "só o cadastro, antes e depois": nada mudou.
 */
export function unchangedOnServer(loaded: string | null | undefined, returned: string | null | undefined): boolean {
  if (loaded === undefined || returned === undefined) return false;
  if (loaded === null || returned === null) return loaded === returned;
  if (loaded === returned) return true;
  // O mesmo instante escrito de outro jeito (a view e a tabela passam pelo mesmo
  // formato hoje, mas a comparação não depende disso).
  const before = Date.parse(loaded);
  const after = Date.parse(returned);
  return !Number.isNaN(before) && before === after && sameFraction(loaded, returned);
}

/** Os microssegundos que o `Date` descarta: "…:00.123456" e "…:00.123457" são instantes diferentes. */
function sameFraction(a: string, b: string): boolean {
  const fraction = (value: string) => (/\.(\d+)/.exec(value)?.[1] ?? "").padEnd(6, "0");
  return fraction(a) === fraction(b);
}
