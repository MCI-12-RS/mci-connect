import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ChangePasswordResult } from "@/lib/auth/password-results";
import { requestPasswordChange, type PasswordChangeRequest } from "@/services/auth/change-own-password";

export type OwnPasswordInput = Omit<PasswordChangeRequest, "mode" | "requestId">;

/**
 * A troca da própria senha (E2.03, RN-10 e RN-11) pela `change-own-password`.
 * O `request_id` nasce com a tela ou o diálogo e se repete nos reenvios (AQ-5,
 * DA-13): uma resposta perdida reenviada vale como sucesso, sem gastar
 * tentativa. Um envio por vez: o toque duplo não envia duas vezes.
 */
export function useChangeOwnPassword(mode: PasswordChangeRequest["mode"]) {
  const [requestId] = useState(() => crypto.randomUUID());
  const sending = useRef(false);
  const [isPending, setPending] = useState(false);

  /** Envia; com outro envio em andamento, nada acontece (`null`). */
  const submit = async (input: OwnPasswordInput): Promise<ChangePasswordResult | null> => {
    if (sending.current) return null;
    sending.current = true;
    setPending(true);
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) return { result: "session_ended" };
      return await requestPasswordChange({ ...input, mode, requestId }, { accessToken });
    } catch {
      return { result: "server_error" };
    } finally {
      sending.current = false;
      setPending(false);
    }
  };

  return { submit, isPending };
}
