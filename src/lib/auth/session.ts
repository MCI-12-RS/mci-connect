// Textos da tela de login e da sessão (E1.04, "Textos" da UX e "Textos de tela"
// do Negócio; T10 do E2.01). É a única fonte desses textos (DT-17, AQ-8): a
// tela não escreve mensagem nenhuma por conta própria, e nenhuma mensagem do
// servidor é exibida como veio.
//
// Evitar aqui (UX-09): "bloquead", "suspens", "não encontrad", "senha
// incorreta" e qualquer texto do Auth em inglês.

import type { SignInOutcome } from "@/lib/auth/sign-in-result";

/** Os tipos de identificação, com os mesmos códigos do banco (`metadata.identifier_type`). */
export type IdentifierType = "email" | "mobile" | "cpf" | "cpf_or_mobile";

/** Indicador de tipo na tela (UXD-5) e tipo de identificação na Auditoria (RN-15). */
export const IDENTIFIER_TYPE_LABELS: Record<IdentifierType, string> = {
  email: "E-mail",
  mobile: "Celular",
  cpf: "CPF",
  cpf_or_mobile: "CPF ou celular",
};

export const LOGIN_TEXTS = {
  title: "Entrar",
  logoAlt: "Logotipo da MCI",
  churchName: "Missão Carismática Internacional",
  churchCity: "Alvorada / RS",
  identifierLabel: "Identificação",
  identifierPlaceholder: "CPF, celular ou e-mail",
  passwordLabel: "Senha",
  showPassword: "Mostrar senha",
  hidePassword: "Ocultar senha",
  submit: "Entrar",
  submitting: "Entrando…",
  emptyFields: "Informe a identificação e a senha.",
  invalidFormat: "Confira a identificação: use o CPF, o celular com DDD ou o e-mail.",
  invalidCredentials: "Usuário ou senha inválidos. Confira os dados e tente de novo.",
  connection: "Não foi possível entrar. Verifique a conexão e tente de novo.",
  sessionEnded: "Sua sessão terminou. Entre de novo para continuar.",
} as const;

/** "{N} minutos", com "1 minuto" no singular. */
export function minutesLabel(minutes: number): string {
  return minutes === 1 ? "1 minuto" : `${minutes} minutos`;
}

/** A mensagem do bloqueio por tentativas (RN-12), com {N} da resposta. */
export function lockedMessage(minutes: number): string {
  return `Muitas tentativas sem sucesso. Aguarde ${minutesLabel(minutes)} e tente de novo. Se esqueceu a senha, fale com o seu líder.`;
}

/** As mensagens do espaço único no topo do formulário (UXD-1). */
export type LoginNotice =
  | { kind: "session_ended" }
  | { kind: "empty_fields" }
  | { kind: "invalid_format" }
  | { kind: "invalid_credentials" }
  | { kind: "locked"; minutes: number }
  | { kind: "connection" };

export function loginNoticeText(notice: LoginNotice): string {
  switch (notice.kind) {
    case "session_ended":
      return LOGIN_TEXTS.sessionEnded;
    case "empty_fields":
      return LOGIN_TEXTS.emptyFields;
    case "invalid_format":
      return LOGIN_TEXTS.invalidFormat;
    case "invalid_credentials":
      return LOGIN_TEXTS.invalidCredentials;
    case "locked":
      return lockedMessage(notice.minutes);
    case "connection":
      return LOGIN_TEXTS.connection;
  }
}

/** A mensagem de uma resposta da `sign-in`; `null` no sucesso. */
export function noticeForOutcome(outcome: SignInOutcome): LoginNotice | null {
  switch (outcome.result) {
    case "ok":
      return null;
    case "empty_fields":
      return { kind: "empty_fields" };
    case "invalid_credentials":
      return { kind: "invalid_credentials" };
    case "locked":
      return { kind: "locked", minutes: outcome.minutes };
    case "server_error":
      return { kind: "connection" };
  }
}

/**
 * Motivo da navegação para o login quando a sessão foi encerrada pelo sistema
 * (E2.01, PR 6): `navigate("/login", { state: { reason: SESSION_ENDED_REASON } })`.
 */
export const SESSION_ENDED_REASON = "session_ended";

export interface SessionEndedState {
  reason: typeof SESSION_ENDED_REASON;
}

/** O estado da navegação pede o aviso de sessão encerrada? */
export function isSessionEndedState(state: unknown): state is SessionEndedState {
  return (
    typeof state === "object" && state !== null && "reason" in state && state.reason === SESSION_ENDED_REASON
  );
}

/** O resultado da releitura do próprio cadastro na `members_view` (`{ data, error }` do supabase-js). */
export interface OwnMemberReadResult {
  data: unknown;
  error: unknown;
}

/**
 * A sessão deve ser encerrada (E2.01, RN-14 e DT-20)? Só quando a releitura
 * do próprio cadastro respondeu sem erro e sem linha: o cadastro foi excluído
 * (as views ignoram quem consulta com o cadastro excluído). Qualquer erro
 * (queda de conexão, 5xx, token recusado, 42501) não encerra: a resposta não
 * prova que o cadastro sumiu.
 */
export function shouldEndSession(result: OwnMemberReadResult): boolean {
  return (result.error === null || result.error === undefined) && (result.data === null || result.data === undefined);
}
