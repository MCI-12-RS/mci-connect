// Textos da senha (E2.03, "Textos de tela" do Negócio e "Textos" da UX). É a
// única fonte desses textos: a tela não escreve mensagem nenhuma por conta
// própria, e nenhuma mensagem do servidor é exibida como veio (UX-09, UX-38).
//
// Evitar aqui (UX-38): "resetar", "reset", "password" e o rótulo antigo
// "Alterar Senha".

import { minutesLabel } from "@/lib/auth/session";
import type { PasswordChangeCode, PasswordChangeField, PasswordPolicyCode } from "@/lib/auth/password-policy";

/** "Mostrar senha" de cada campo (P15). Com um campo só, o rótulo curto. */
export interface RevealLabels {
  show: string;
  hide: string;
}

export const REVEAL_LABELS = {
  single: { show: "Mostrar senha", hide: "Ocultar senha" },
  current_password: { show: "Mostrar senha atual", hide: "Ocultar senha atual" },
  new_password: { show: "Mostrar nova senha", hide: "Ocultar nova senha" },
  confirmation: { show: "Mostrar confirmação da nova senha", hide: "Ocultar confirmação da nova senha" },
} as const satisfies Record<string, RevealLabels>;

/** Os textos das duas trocas (T2 e T3). */
export const PASSWORD_CHANGE_TEXTS = {
  labels: {
    current_password: "Senha atual",
    new_password: "Nova senha",
    confirmation: "Confirmar nova senha",
  } satisfies Record<PasswordChangeField, string>,
  rulesMinLength: "Use pelo menos 8 caracteres.",
  rulesRest:
    "Evite sequências (12345678), repetições (11111111) e senhas comuns, e não use o seu CPF, celular ou data de nascimento.",
  ruleMet: "(regra atendida)",
  empty: {
    current_password: "Informe a senha atual.",
    new_password: "Informe a nova senha.",
    confirmation: "Confirme a nova senha.",
  } satisfies Record<PasswordChangeField, string>,
  currentInvalid: "A senha atual não confere.",
  currentHelp: "Se não lembra a senha atual, fale com o seu líder.",
  submit: "Salvar nova senha",
  submitting: "Salvando…",
  cancel: "Cancelar",
  connection: "Não foi possível salvar a nova senha. Verifique a conexão e tente de novo.",
} as const;

/** "Muitas tentativas sem sucesso. Aguarde {N} minutos e tente de novo." (RN-12). */
export function changeBlockedMessage(minutes: number): string {
  return `Muitas tentativas sem sucesso. Aguarde ${minutesLabel(minutes)} e tente de novo.`;
}

/** As mensagens dos erros da senha nova, em segunda pessoa (RN-13). */
const CHANGE_ERROR_MESSAGES: Record<PasswordChangeCode, string> = {
  password_too_short: "A senha precisa ter pelo menos 8 caracteres.",
  password_too_long: "A senha é longa demais.",
  password_weak: "Esta senha é fácil de adivinhar. Escolha outra.",
  password_personal_data:
    "A senha não pode conter o seu CPF, o seu celular ou a sua data de nascimento, nem ser o seu e-mail.",
  password_same_as_current: "A nova senha precisa ser diferente da atual.",
  password_mismatch: "As senhas não conferem.",
};

export function changeErrorMessage(code: PasswordChangeCode): string {
  return CHANGE_ERROR_MESSAGES[code];
}

/** A troca obrigatória (T2). */
export const FORCED_CHANGE_TEXTS = {
  title: "Crie uma nova senha",
  intro: "Para continuar, crie uma nova senha. Ela substitui a senha que você usou para entrar.",
  signOut: "Sair",
  success: "Senha alterada. Use a nova senha da próxima vez que entrar.",
  logoAlt: "Logotipo da MCI",
} as const;

/** "Alterar minha senha" (T3, T4 e T5). */
export const OWN_CHANGE_TEXTS = {
  title: "Alterar minha senha",
  action: "Alterar minha senha",
  close: "Fechar",
  success: "Senha alterada. Nos outros aparelhos, será preciso entrar de novo.",
} as const;

/** O login (T1, RN-15). */
export const LOGIN_PASSWORD_TEXTS = {
  forgot: "Esqueceu a senha? Fale com o seu líder.",
} as const;

/** A senha inicial no cadastro novo (T5, RN-07), sobre o membro. */
export const INITIAL_PASSWORD_TEXTS = {
  label: "Senha inicial (opcional)",
  defaultHint: "Se ficar em branco, a senha inicial é 123456. No primeiro acesso, o membro cria a própria senha.",
  rules:
    "Use pelo menos 8 caracteres. Evite sequências (12345678), repetições (11111111) e senhas comuns, e não use o CPF, o celular ou a data de nascimento do membro.",
} as const;

const INITIAL_ERROR_MESSAGES: Record<PasswordPolicyCode, string> = {
  password_too_short: CHANGE_ERROR_MESSAGES.password_too_short,
  password_too_long: CHANGE_ERROR_MESSAGES.password_too_long,
  password_weak: CHANGE_ERROR_MESSAGES.password_weak,
  password_personal_data:
    "A senha não pode conter o CPF, o celular ou a data de nascimento do membro, nem ser o e-mail do cadastro.",
};

/** As mensagens da senha inicial: as da senha nova, com os dados pessoais sobre o membro (P-SEN-21). */
export function initialPasswordErrorMessage(code: PasswordPolicyCode): string {
  return INITIAL_ERROR_MESSAGES[code];
}

/** O primeiro nome, para o corpo dos textos da redefinição. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** A linha "Senha" do cadastro e a ação da lista (T5). */
export const PASSWORD_ROW_TEXTS = {
  label: "Senha",
  reset: "Redefinir senha",
  noAccount: "Este membro não tem acesso ao sistema.",
  roleNotCovered: "Você não tem permissão para redefinir a senha deste membro.",
  resetAt: (time: string): string => `Senha redefinida às ${time}. Não é preciso salvar o cadastro.`,
  /** Rótulo do botão de ícone na linha da tabela. */
  resetRowLabel: (name: string): string => `Redefinir a senha de ${name}`,
} as const;

/** A redefinição (T6). */
export const RESET_TEXTS = {
  confirmTitle: (name: string): string => `Redefinir a senha de ${name}?`,
  confirmTopics: (name: string, gender: string | null): string[] => {
    const first = firstName(name);
    const connected = gender === "F" ? "conectada" : "conectado";
    return [
      `A senha atual de ${first} deixa de funcionar agora.`,
      `Se ${first} estiver ${connected}, terá que entrar de novo.`,
      `Você vai receber uma senha temporária, válida por 7 dias, para passar a ${first}.`,
      `No próximo acesso, ${first} cria uma nova senha.`,
    ];
  },
  confirm: "Redefinir senha",
  confirming: "Redefinindo…",
  cancel: "Cancelar",
  connection: "Não foi possível redefinir a senha. Verifique a conexão e tente de novo.",
  resultTitle: (name: string): string => `Senha temporária de ${name}`,
  onlyLowercase: "Só letras minúsculas e números.",
  validUntil: (when: string): string => `Válida até ${when}.`,
  passOn: (name: string): string => `Passe esta senha a ${firstName(name)} pessoalmente ou por mensagem direta.`,
  notShownAgain: "Ela não será mostrada de novo.",
  howToEnter: (name: string): string =>
    `${firstName(name)} entra com o CPF, o celular ou o e-mail do cadastro e esta senha, e cria uma nova senha em seguida.`,
  copy: "Copiar senha",
  copied: "Senha copiada",
  copiedStatus: "Senha copiada.",
  copyFailed: "Não foi possível copiar. Selecione a senha para copiá-la.",
  share: "Compartilhar senha",
  done: "Concluir",
  refusedTitle: "Não foi possível redefinir a senha",
  close: "Fechar",
  /** A senha soletrada para o leitor de tela (UX-29). */
  spelled: (chars: readonly string[]): string => `Senha: ${chars.join(", ")}.`,
} as const;

export type ResetRefusalCode = "no_permission" | "rate_limited" | "not_found" | "self" | "role_not_covered" | "no_account";

/** As mensagens das recusas da redefinição (RN-02, RN-06), com {N} do limite. */
export function resetRefusalMessage(code: ResetRefusalCode, minutes?: number): string {
  switch (code) {
    case "no_permission":
      return "Você não tem permissão para redefinir senhas.";
    case "rate_limited":
      return `Você redefiniu muitas senhas na última hora. Aguarde ${minutesLabel(minutes ?? 1)} e tente de novo.`;
    case "not_found":
      return "Este cadastro não existe ou já foi excluído.";
    case "self":
      return 'Para trocar a sua senha, use "Alterar minha senha".';
    case "role_not_covered":
      return PASSWORD_ROW_TEXTS.roleNotCovered;
    case "no_account":
      return PASSWORD_ROW_TEXTS.noAccount;
  }
}
