// A rota da troca obrigatória (E2.03, T2, P18 e AQ-3). Sem React.

/** Com a marca, qualquer rota protegida (e o login) leva para cá, com `replace`. */
export const CHANGE_PASSWORD_PATH = "/change-password";

/** O estado da navegação do login para a troca: a identificação usada, para o gerenciador de senhas. */
export interface ChangePasswordState {
  username: string;
}

/** A identificação vinda do login, ou `null` (sem ela, o campo oculto não existe). */
export function usernameFromState(state: unknown): string | null {
  if (typeof state !== "object" || state === null || !("username" in state)) return null;
  const { username } = state;
  return typeof username === "string" && username !== "" ? username : null;
}
