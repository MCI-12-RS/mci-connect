// A linha "Senha" do cadastro de membro e a ação da lista (E2.03, T5, UXD-7,
// P-SEN-20). A regra vale no banco (`reset_member_password`); a tela só
// antecipa a recusa previsível pela `members_view.password_reset_status`
// (AQ-2, DT-15). Sem React e sem Supabase.

/** O que a `password_reset_status` diz, na ordem da RN-02 e sem o limite. */
export type PasswordResetStatus = "allowed" | "self" | "role_not_covered" | "no_account";

export function isPasswordResetStatus(value: unknown): value is PasswordResetStatus {
  return value === "allowed" || value === "self" || value === "role_not_covered" || value === "no_account";
}

export type PasswordRowView =
  /** Nem o rótulo "Senha": sem a permissão, no cadastro de outra pessoa. */
  | { kind: "hidden" }
  /** A tela ainda não sabe (o acesso não chegou): `Skeleton`. */
  | { kind: "loading" }
  /** O próprio cadastro: "Alterar minha senha" (UXD-6). */
  | { kind: "change_own" }
  /** "Redefinir senha". */
  | { kind: "reset" }
  /** A recusa previsível vira texto (P12). */
  | { kind: "no_account" }
  | { kind: "role_not_covered" };

export interface PasswordRowInput {
  /** O cadastro é o de quem está logado. */
  isSelf: boolean;
  /** O acesso de quem está logado já foi lido. */
  accessLoaded: boolean;
  /** Quem está logado tem "Redefinir Senha de Membros". */
  canReset: boolean;
  /** A coluna da view; `undefined` quando a linha não a trouxe. */
  status: string | null | undefined;
  /** O cadastro tem conta de acesso (`auth_user_id`). */
  hasAccount: boolean;
  /** A recusa recebida nesta abertura, que vale mais que a linha (T6). */
  refusal?: "no_account" | "role_not_covered" | null;
}

/** Qual linha "Senha" o cadastro mostra (T5). */
export function passwordRowView(input: PasswordRowInput): PasswordRowView {
  if (input.isSelf) return { kind: "change_own" };
  if (!input.accessLoaded) return { kind: "loading" };
  if (!input.canReset) return { kind: "hidden" };
  if (input.refusal) return { kind: input.refusal };
  const status = isPasswordResetStatus(input.status) ? input.status : null;
  if (status === "self") return { kind: "change_own" };
  if (status === "role_not_covered") return { kind: "role_not_covered" };
  if (status === "no_account" || !input.hasAccount) return { kind: "no_account" };
  // Sem a coluna, o padrão da AQ-2: o botão, e a função não coberta só depois de confirmar.
  return { kind: "reset" };
}

/**
 * "Redefinir senha" na lista de Membros (UX-39): só para quem tem a
 * permissão (a coluna vem nula sem ela), fora da própria linha, de quem não
 * tem conta e de função não coberta.
 */
export function canResetFromList(status: string | null | undefined): boolean {
  return status === "allowed";
}
