import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { refreshAccess } from "@/hooks/use-access";
import { ROLE_OPTIONS_QUERY_KEY } from "@/hooks/use-role-options";
import { requestSessionCheck } from "@/lib/auth/session-check";
import { isJsonObject, isNetworkError, readFunctionErrorBody } from "@/lib/errors";
import {
  memberRefusalFromCreate,
  memberRefusalFromError,
  type MemberFormRefusal,
} from "@/lib/access/member-form";
import { parseCreateMemberRefusal, type DeletedMatch } from "@/lib/members/deleted-matches";
import type { MemberWrite } from "@/lib/members/fields";

/** Um cadastro novo, pela `create-user-admin` (E2.04, DT-11). */
export interface CreateMemberRequest {
  kind: "create";
  /** Gerado ao abrir o formulário e o mesmo em cada nova tentativa (AQ-5). */
  attemptId: string;
  password: string;
  memberData: MemberWrite;
  /** "Cadastrar mesmo assim" (E2.01, RN-18). */
  confirmDeletedMatches: boolean;
}

/** Uma edição: só os campos que mudaram (DT-19). */
export interface UpdateMemberRequest {
  kind: "update";
  memberId: string;
  patch: MemberWrite;
}

export type MemberSaveRequest = CreateMemberRequest | UpdateMemberRequest;

export type MemberSaveResult =
  | { kind: "saved" }
  /** Sem nenhuma mudança: nada foi enviado (DA-9). */
  | { kind: "unchanged" }
  /** A edição voltou sem linha: o cadastro foi excluído ou saiu do escopo no meio tempo (E2.01, DT-19). */
  | { kind: "gone" }
  /** O cadastro novo tem dados de um excluído (E2.01, RN-18). */
  | { kind: "deletedMatches"; matches: DeletedMatch[]; accountEmail: boolean }
  /** Recusa de regra ou de permissão: nos campos ou no `Alert` do topo (T5). */
  | { kind: "refused"; refusal: MemberFormRefusal }
  /** Queda de conexão, 40P01 (DT-25) ou erro técnico: "tente de novo" no rodapé (T7). */
  | { kind: "failed"; network: boolean };

type CreateOutcome = Extract<MemberSaveResult, { kind: "saved" | "deletedMatches" | "refused" | "failed" }>;

/**
 * Tempo-limite do cadastro, o mesmo do login (`SIGN_IN_TIMEOUT_MS`). Sem rede a
 * chamada pode nunca voltar; passado o limite, é uma queda de conexão (T7). A
 * nova tentativa repete o mesmo `attemptId`, então um envio que chegou ao
 * servidor não cria dois cadastros (DT-11).
 */
export const CREATE_MEMBER_TIMEOUT_MS = 20_000;

/** A `create-user-admin` com tempo-limite: estourado, `{ kind: "failed", network: true }`. */
async function createMemberWithTimeout(request: CreateMemberRequest): Promise<CreateOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<CreateOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "failed", network: true }), CREATE_MEMBER_TIMEOUT_MS);
  });
  try {
    return await Promise.race([createMember(request), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function createMember({ attemptId, password, memberData, confirmDeletedMatches }: CreateMemberRequest): Promise<CreateOutcome> {
  const { data, error } = await supabase.functions.invoke("create-user-admin", {
    body: { attemptId, password, memberData, confirmDeletedMatches },
  });
  if (error) {
    // As respostas 4xx/5xx da função trazem `{ error, code, field, fields, matches }`.
    const body = parseCreateMemberRefusal(await readFunctionErrorBody(error));
    if (body?.kind === "deletedMatches") return { kind: "deletedMatches", matches: body.matches, accountEmail: body.accountEmail };
    const refusal = body ? memberRefusalFromCreate(body) : null;
    if (refusal) return { kind: "refused", refusal };
    // Sem corpo legível (queda de conexão) ou com um código técnico: "tente de novo".
    return { kind: "failed", network: !body && isNetworkError(error) };
  }
  if (isJsonObject(data) && typeof data.error === "string") return { kind: "failed", network: false };
  // `replayed: true` (a mesma tentativa repetida) também é sucesso: o cadastro existe.
  return { kind: "saved" };
}

/**
 * Só o id de volta: pedir coluna sensível no RETURNING dá 42501 (E1.08, PR 5).
 * Sem linha, o cadastro não existe mais ou saiu do que a pessoa vê (DT-19,
 * AQ-6): nunca um sucesso falso. O erro sobe para o `MutationCache` (o 42501
 * relê o acesso e confere a sessão) e é classificado por quem chamou.
 */
async function updateMember({ memberId, patch }: UpdateMemberRequest): Promise<"saved" | "gone"> {
  const { data, error } = await supabase.from("members").update(patch).eq("id", memberId).select("id");
  if (error) throw error;
  return data?.length ? "saved" : "gone";
}

/** A falha de uma edição, sem nenhum texto técnico (UX-30). */
function classifyUpdateError(error: unknown): MemberSaveResult {
  const refusal = memberRefusalFromError(error);
  if (refusal) return { kind: "refused", refusal };
  return { kind: "failed", network: isNetworkError(error) };
}

/**
 * A gravação do formulário de membro (E2.04, T5 e T7): cria pela
 * `create-user-admin` e edita com um PATCH só do que mudou. Uma gravação por
 * vez: um toque duplo não envia duas vezes (UX-25). Devolve o resultado já
 * classificado; a tela decide onde mostrar.
 *
 * Efeitos:
 * - sucesso: a lista de Membros e as opções de função recarregam;
 * - "0 linhas": a lista recarrega já, e a própria sessão é conferida (um membro excluído recebe o mesmo, RN-14);
 * - recusa que pede (42501, RN-10 do E2.02): o acesso é relido.
 */
export function useMemberSave() {
  const queryClient = useQueryClient();
  const sending = useRef(false);
  const mutation = useMutation({
    mutationFn: async (request: MemberSaveRequest): Promise<MemberSaveResult> => {
      if (request.kind === "create") return createMemberWithTimeout(request);
      return { kind: await updateMember(request) };
    },
  });

  const afterSave = (result: MemberSaveResult) => {
    switch (result.kind) {
      case "saved":
        void queryClient.invalidateQueries({ queryKey: ["members"] });
        void queryClient.invalidateQueries({ queryKey: ROLE_OPTIONS_QUERY_KEY });
        return;
      case "gone":
        requestSessionCheck();
        void queryClient.invalidateQueries({ queryKey: ["members", "list"] });
        return;
      case "refused":
        if (result.refusal.rereadAccess) void refreshAccess(queryClient);
    }
  };

  /** Grava. Sem mudança na edição, nada é enviado (DA-9); com outra gravação em andamento, nada acontece (`null`). */
  const save = async (request: MemberSaveRequest): Promise<MemberSaveResult | null> => {
    if (request.kind === "update" && Object.keys(request.patch).length === 0) return { kind: "unchanged" };
    if (sending.current) return null;
    sending.current = true;
    try {
      const result = await mutation.mutateAsync(request).catch(classifyUpdateError);
      afterSave(result);
      return result;
    } finally {
      sending.current = false;
    }
  };

  return { save, isPending: mutation.isPending };
}
