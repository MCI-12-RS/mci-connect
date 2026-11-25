import { useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { NO_ACCESS, accessFingerprint, type Access } from "@/lib/access/access";
import { ACCESS_TEXTS } from "@/lib/access/texts";
import { retryUnlessPermissionDenied } from "@/lib/errors";

// O acesso de quem está logado (E2.02, RN-08, UXD-11, P13): a linha de
// `my_access()`, relida sem sair e entrar:
//   - quando a aba volta a ficar visível;
//   - a cada navegação (troca de tela; a busca e a página da lista não contam);
//   - depois de uma recusa 42501 de qualquer leitura ou gravação (App.tsx);
//   - quando a sessão é renovada (AuthContext).
// Sem consulta periódica. Quando o acesso muda, aparece uma vez "Seu acesso
// foi atualizado." e as consultas abertas recarregam. Uma falha ao reler
// mantém o último acesso (o TanStack Query guarda os dados) e nunca encerra a
// sessão.

/** Prefixo da chave do acesso. A chave completa leva o usuário: `["access", userId]`. */
export const ACCESS_QUERY_KEY = ["access"] as const;

/** A consulta é a do acesso? (Para a recusa 42501 dela mesma não pedir outra releitura.) */
export function isAccessQueryKey(queryKey: QueryKey | undefined): boolean {
  return queryKey?.[0] === ACCESS_QUERY_KEY[0];
}

/**
 * Pede a releitura do acesso. Uma releitura já em voo é aproveitada (várias
 * recusas ao mesmo tempo geram uma só).
 */
export function refreshAccess(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: ACCESS_QUERY_KEY }, { cancelRefetch: false });
}

async function fetchAccess(): Promise<Access> {
  const { data, error } = await supabase.rpc("my_access");
  if (error) throw error;
  // A função sempre devolve uma linha; sem ela, nada liberado (RN-07).
  return data?.[0] ?? NO_ACCESS;
}

export interface AccessQueryResult {
  /** O último acesso lido. `null` sem sessão ou antes da primeira leitura. */
  access: Access | null;
  /** A primeira leitura falhou e não há acesso nenhum para mostrar (T12). */
  loadFailed: boolean;
  /** "Tentar de novo" do aviso de falha. */
  retry: () => void;
}

/**
 * Lê e relê o acesso de `userId` (o usuário da sessão). Usado só pelo
 * `AuthProvider`; as telas leem o acesso pelo `useAuth()`.
 */
export function useAccessQuery(userId: string | null): AccessQueryResult {
  const queryClient = useQueryClient();
  const { pathname } = useLocation();

  const query = useQuery({
    queryKey: [...ACCESS_QUERY_KEY, userId],
    queryFn: fetchAccess,
    enabled: !!userId,
    retry: retryUnlessPermissionDenied,
    // A volta da aba é tratada abaixo, pela visibilidade.
    refetchOnWindowFocus: false,
  });

  // Navegação: a cada troca de tela (a primeira leitura já vem da montagem).
  const lastPathname = useRef(pathname);
  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    if (userId) void refreshAccess(queryClient);
  }, [pathname, userId, queryClient]);

  // Volta para a aba.
  useEffect(() => {
    if (!userId) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshAccess(queryClient);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [userId, queryClient]);

  // O acesso mudou (não na primeira leitura de cada usuário): avisa uma vez e
  // recarrega as consultas abertas, que passam a ter outro alcance.
  const data = query.data;
  const seen = useRef<{ userId: string; fingerprint: string } | null>(null);
  useEffect(() => {
    // Sem sessão: o próximo login começa sem leitura anterior (sem aviso).
    if (!userId) seen.current = null;
    if (!data || !userId) return;
    const fingerprint = accessFingerprint(data);
    const previous = seen.current;
    seen.current = { userId, fingerprint };
    if (!previous || previous.userId !== userId || previous.fingerprint === fingerprint) return;
    toast({ title: ACCESS_TEXTS.updated });
    void queryClient.invalidateQueries({ predicate: (other) => !isAccessQueryKey(other.queryKey) });
  }, [data, userId, queryClient]);

  const { refetch } = query;
  const retry = useCallback(() => void refetch(), [refetch]);

  return {
    access: userId ? (data ?? null) : null,
    loadFailed: !!userId && query.isError && data === undefined,
    retry,
  };
}
