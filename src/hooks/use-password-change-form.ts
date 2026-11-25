import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import { useChangeOwnPassword } from "@/hooks/use-change-own-password";
import { requestGate, requestSessionCheck } from "@/lib/auth/session-check";
import {
  checkPasswordChange,
  passwordPolicyViolation,
  type PasswordChangeCode,
  type PasswordChangeField,
  type PasswordPersonalData,
} from "@/lib/auth/password-policy";
import { fieldForCode, type ChangePasswordResult } from "@/lib/auth/password-results";
import { PASSWORD_CHANGE_TEXTS, changeErrorMessage } from "@/lib/auth/password-texts";

export type PasswordChangeValues = Record<PasswordChangeField, string>;
export type PasswordChangeErrors = Partial<Record<PasswordChangeField, string>>;

/** O espaço de mensagens do topo: conexão (com `role="alert"`) ou bloqueio (com o foco, RN-12). */
export type PasswordChangeNotice = { kind: "connection" } | { kind: "blocked"; minutes: number };

export interface PasswordChangeFormOptions {
  mode: "forced" | "voluntary";
  /** O próprio cadastro, na voluntária (AQ-6); `null` na obrigatória. */
  personal: PasswordPersonalData | null;
  /** A troca foi feita (ou o reenvio confirmou, DA-13). */
  onSuccess: () => void;
  /** Só na obrigatória: `not_flagged` (DA-14). */
  onNotFlagged?: () => void;
}

const EMPTY_VALUES: PasswordChangeValues = { current_password: "", new_password: "", confirmation: "" };

type FocusTarget = PasswordChangeField | "notice" | null;

/**
 * O formulário das duas trocas (T2 e T3): os valores, a conferência da tela
 * (P16, UX-06 a UX-08) e o que fazer com cada resposta do servidor (UX-09,
 * UX-17, UX-18). A regra é a de `password-policy.ts`; os textos, os de
 * `password-texts.ts`. As senhas ficam só no estado deste hook.
 */
export function usePasswordChangeForm({ mode, personal, onSuccess, onNotFlagged }: PasswordChangeFormOptions) {
  const fields: PasswordChangeField[] =
    mode === "voluntary" ? ["current_password", "new_password", "confirmation"] : ["new_password", "confirmation"];
  const change = useChangeOwnPassword(mode);
  const [values, setValues] = useState<PasswordChangeValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<PasswordChangeErrors>({});
  const [notice, setNotice] = useState<PasswordChangeNotice | null>(null);
  // A ajuda "Se não lembra a senha atual…" aparece a partir do primeiro erro (PO-UX-6).
  const [showCurrentHelp, setShowCurrentHelp] = useState(false);
  // A cada envio, os "Mostrar senha" voltam a ocultar (P15).
  const [hideSignal, setHideSignal] = useState(0);
  // Monta a mensagem de novo a cada resposta, para ser anunciada mesmo com o mesmo texto.
  const [attempt, setAttempt] = useState(0);
  const [focusTarget, setFocusTarget] = useState<FocusTarget>(null);

  const refs: Record<PasswordChangeField, RefObject<HTMLInputElement>> = {
    current_password: useRef<HTMLInputElement>(null),
    new_password: useRef<HTMLInputElement>(null),
    confirmation: useRef<HTMLInputElement>(null),
  };
  const noticeRef = useRef<HTMLDivElement>(null);

  // O foco vai para o que a pessoa faz em seguida, depois de a mensagem estar na tela.
  useEffect(() => {
    if (!focusTarget) return;
    const target = focusTarget === "notice" ? noticeRef.current : refs[focusTarget].current;
    target?.focus();
    setFocusTarget(null);
    // `refs` são estáveis: só a mudança do alvo (ou uma nova resposta) leva o foco.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTarget, attempt]);

  // O bloqueio some sozinho, sem anúncio, depois dos {N} minutos (UX-18).
  useEffect(() => {
    if (notice?.kind !== "blocked") return;
    const timer = setTimeout(() => setNotice(null), notice.minutes * 60_000);
    return () => clearTimeout(timer);
  }, [notice, attempt]);

  const setValue = (field: PasswordChangeField, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const showFieldError = (field: PasswordChangeField, code: PasswordChangeCode) => {
    if (field === "confirmation") {
      // Só a confirmação é limpa e recebe o foco (P16).
      setValues((current) => ({ ...current, confirmation: "" }));
    } else {
      // A política: a nova senha e a confirmação são limpas, e o foco vai para a nova (P16).
      setValues((current) => ({ ...current, new_password: "", confirmation: "" }));
    }
    setErrors({ [field]: changeErrorMessage(code) });
    setNotice(null);
    setFocusTarget(field);
  };

  /** Ao sair do campo (P16): a política na nova senha e a confirmação, sem limpar nada e sem o servidor. */
  const handleBlur = (field: PasswordChangeField) => {
    if (field === "new_password" && values.new_password !== "") {
      const policy = passwordPolicyViolation(values.new_password, personal ?? {});
      const code: PasswordChangeCode | null =
        policy ??
        (mode === "voluntary" && values.current_password !== "" && values.new_password === values.current_password
          ? "password_same_as_current"
          : null);
      if (code) setErrors((current) => ({ ...current, new_password: changeErrorMessage(code) }));
    }
    if (field === "confirmation" && values.confirmation !== "" && values.new_password !== "" && values.confirmation !== values.new_password) {
      setErrors((current) => ({ ...current, confirmation: changeErrorMessage("password_mismatch") }));
    }
  };

  /** Enter com algum campo seguinte vazio leva ao primeiro vazio, sem mensagem e sem envio (UX-06). */
  const handleKeyDown = (field: PasswordChangeField, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    const nextEmpty = fields.slice(fields.indexOf(field) + 1).find((other) => values[other] === "");
    if (!nextEmpty) return;
    event.preventDefault();
    refs[nextEmpty].current?.focus();
  };

  const handleResult = (result: ChangePasswordResult) => {
    setAttempt((n) => n + 1);
    switch (result.result) {
      case "ok":
        setValues(EMPTY_VALUES);
        onSuccess();
        return;
      case "invalid":
        showFieldError(fieldForCode(result.code), result.code);
        return;
      case "current_password_invalid":
        setValues((current) => ({ ...current, current_password: "" }));
        setErrors({ current_password: PASSWORD_CHANGE_TEXTS.currentInvalid });
        setShowCurrentHelp(true);
        setNotice(null);
        setFocusTarget("current_password");
        return;
      case "change_blocked":
        setValues((current) => ({ ...current, current_password: "" }));
        setErrors({});
        setNotice({ kind: "blocked", minutes: result.minutes });
        setFocusTarget("notice");
        return;
      case "session_ended":
        requestGate("session_ended");
        return;
      case "not_flagged":
        if (mode === "forced" && onNotFlagged) {
          onNotFlagged();
          return;
        }
        setNotice({ kind: "connection" });
        return;
      case "forbidden":
        // Cadastro excluído no meio: a releitura do próprio cadastro encerra a sessão (E2.01).
        requestSessionCheck();
        setNotice({ kind: "connection" });
        return;
      case "empty_fields":
      case "server_error":
        // Os campos ficam, e o foco não muda; o botão serve de "Tentar de novo" (AQ-5).
        setNotice({ kind: "connection" });
    }
  };

  const handleSubmit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (change.isPending) return;
    setHideSignal((n) => n + 1);

    const check = checkPasswordChange({
      mode,
      currentPassword: values.current_password,
      newPassword: values.new_password,
      confirmation: values.confirmation,
      personal,
    });
    if (check?.kind === "empty") {
      setErrors(Object.fromEntries(check.fields.map((field) => [field, PASSWORD_CHANGE_TEXTS.empty[field]])));
      setFocusTarget(check.fields[0]);
      setAttempt((n) => n + 1);
      return;
    }
    if (check?.kind === "invalid") {
      setAttempt((n) => n + 1);
      showFieldError(check.field, check.code);
      return;
    }

    setErrors({});
    setNotice(null);
    const result = await change.submit({
      currentPassword: mode === "voluntary" ? values.current_password : undefined,
      newPassword: values.new_password,
      confirmation: values.confirmation,
    });
    if (result) handleResult(result);
  };

  return {
    fields,
    values,
    errors,
    notice,
    attempt,
    showCurrentHelp,
    hideSignal,
    submitting: change.isPending,
    refs,
    noticeRef,
    setValue,
    handleBlur,
    handleKeyDown,
    handleSubmit,
  };
}

export type PasswordChangeForm = ReturnType<typeof usePasswordChangeForm>;
