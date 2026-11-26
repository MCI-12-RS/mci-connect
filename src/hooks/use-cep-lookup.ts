import { useCallback, useEffect, useRef, useState } from "react";
import { cepDigits, parseCepLookup, type CepLookup } from "@/lib/address/cep";

/** Tempo-limite da busca de CEP (E2.08, DT-12): passou disso, é falha. */
export const CEP_LOOKUP_TIMEOUT_MS = 8_000;

/** O endereço de um CEP no serviço (só o CEP sai do navegador, risco 9). */
async function fetchCep(digits: string, signal: AbortSignal): Promise<CepLookup> {
  const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`, { signal });
  // O serviço responde 400 para um CEP mal formado: para a pessoa, é "não encontrado".
  if (response.status === 400) return { kind: "not_found" };
  if (!response.ok) return { kind: "failed" };
  const body: unknown = await response.json();
  return parseCepLookup(body);
}

export type CepLookupStatus = "idle" | "loading" | CepLookup["kind"];

/**
 * A busca do CEP (E2.08, DT-12): `lookup(cep)` devolve o resultado, ou `null`
 * quando uma busca mais nova a substituiu (só a última vale). A busca nova
 * cancela a anterior; com 8 s sem resposta, é falha. `reset` cancela a busca
 * em curso e apaga o aviso (o CEP mudou).
 */
export function useCepLookup() {
  const [status, setStatus] = useState<CepLookupStatus>("idle");
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);

  const reset = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    sequence.current += 1;
    setStatus("idle");
  }, []);

  const lookup = useCallback(async (cep: string): Promise<CepLookup | null> => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    sequence.current += 1;
    const id = sequence.current;
    setStatus("loading");
    const timer = window.setTimeout(() => current.abort(), CEP_LOOKUP_TIMEOUT_MS);
    let result: CepLookup;
    try {
      result = await fetchCep(cepDigits(cep), current.signal);
    } catch {
      result = { kind: "failed" };
    } finally {
      window.clearTimeout(timer);
    }
    if (id !== sequence.current) return null;
    controller.current = null;
    setStatus(result.kind);
    return result;
  }, []);

  useEffect(() => () => controller.current?.abort(), []);

  return { status, lookup, reset };
}
