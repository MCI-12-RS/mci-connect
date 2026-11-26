import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { RESET_SERVER_ERROR, parseResetResult, type ResetResult } from "@/lib/auth/password-results";

/** Tempo-limite da redefinição (AQ-1), o mesmo do login. */
export const PASSWORD_RESET_TIMEOUT_MS = 20_000;

/** Chama a RPC; a resposta fora do contrato vira `server_error`. O erro do banco sobe (o `MutationCache` trata o portão). */
async function resetPassword(memberId: string): Promise<ResetResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PASSWORD_RESET_TIMEOUT_MS);
  try {
    const { data, error } = await supabase.rpc("reset_member_password", { _member_id: memberId }).abortSignal(controller.signal);
    if (error) throw error;
    return parseResetResult(data);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A redefinição de senha de outro membro (E2.03, RN-01 a RN-06, T6). A senha
 * temporária não fica no cache do React Query (`gcTime: 0`, P17): quem chama
 * copia o resultado para o estado do diálogo e chama `reset()`. Rede, tempo-
 * limite e erro do banco voltam como `server_error` (o diálogo mostra a
 * mensagem de conexão). Um pedido por vez.
 */
export function usePasswordReset() {
  const queryClient = useQueryClient();
  const sending = useRef(false);
  const mutation = useMutation({
    mutationFn: resetPassword,
    gcTime: 0,
    onSuccess: (result) => {
      // A lista e o cadastro releem a linha (a `password_reset_status` pode ter mudado).
      if (result.result !== "server_error") void queryClient.invalidateQueries({ queryKey: ["members"] });
    },
  });

  /** Redefine; com outro pedido em andamento, nada acontece (`null`). */
  const reset = async (memberId: string): Promise<ResetResult | null> => {
    if (sending.current) return null;
    sending.current = true;
    try {
      return await mutation.mutateAsync(memberId).catch(() => RESET_SERVER_ERROR);
    } finally {
      sending.current = false;
      // Nada da resposta (a senha) fica guardado na mutação.
      mutation.reset();
    }
  };

  return { reset, isPending: mutation.isPending };
}
