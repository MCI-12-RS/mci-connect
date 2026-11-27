import { useCallback, useEffect, useRef, useState, type FocusEvent, type RefObject } from "react";
import { isCompleteIsoDate } from "@/lib/dates/sao-paulo";
import { isDateRangeInverted } from "@/lib/filters/dates";

interface FilterDatesOptions {
  from: string | null;
  to: string | null;
  /** No painel do computador o filtro aplica a cada alteração, mas só a data completa. */
  panel: boolean;
  onChange: (changes: { from?: string | null; to?: string | null }) => void;
}

export interface FilterDatesState {
  fromText: string;
  toText: string;
  fromInvalid: boolean;
  toInvalid: boolean;
  inverted: boolean;
  fromRef: RefObject<HTMLInputElement>;
  toRef: RefObject<HTMLInputElement>;
  onFromChange: (raw: string) => void;
  onToChange: (raw: string) => void;
  onFromBlur: (event: FocusEvent<HTMLInputElement>) => void;
  onToBlur: (event: FocusEvent<HTMLInputElement>) => void;
  /** Confere as datas; com erro, mostra a mensagem, põe o foco no campo e devolve `false`. */
  validate: () => boolean;
}

/**
 * As datas de cadastro de um painel de filtros (E2.07 e E2.10, P54). O texto de cada campo fica
 * aqui: no painel do computador, só a data completa (ano com 4 dígitos) vai para a URL, e o ano a
 * meio caminho fica no campo, sem piscar; no `Sheet`, tudo vai para o rascunho. Data que não existe,
 * incompleta ou fora do formato é conferida ao sair do campo e ao aplicar, nunca durante a digitação.
 */
// O campo nativo fica vazio com `badInput`, ou guarda um ano que não tem 4 dígitos.
const isBadDate = (input: HTMLInputElement | null): boolean =>
  !!input && (input.validity.badInput || (input.value !== "" && !isCompleteIsoDate(input.value)));

export function useFilterDates({ from, to, panel, onChange }: FilterDatesOptions): FilterDatesState {
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const [fromInvalid, setFromInvalid] = useState(false);
  const [toInvalid, setToInvalid] = useState(false);
  const [fromText, setFromText] = useState(from ?? "");
  const [toText, setToText] = useState(to ?? "");
  const inverted = isDateRangeInverted(from, to);

  // A URL mudou por fora (chip, "Limpar filtros", voltar): o campo acompanha.
  useEffect(() => setFromText(from ?? ""), [from]);
  useEffect(() => setToText(to ?? ""), [to]);

  const change =
    (key: "from" | "to", setText: (text: string) => void, setInvalid: (invalid: boolean) => void) => (raw: string) => {
      setText(raw);
      if (raw) setInvalid(false);
      if (!panel || raw === "" || isCompleteIsoDate(raw)) onChange({ [key]: raw || null });
    };

  const blur = (setInvalid: (invalid: boolean) => void) => (event: FocusEvent<HTMLInputElement>) =>
    setInvalid(isBadDate(event.currentTarget));

  // Estável entre renders (só muda com `inverted`), para o `useImperativeHandle` dos painéis.
  const validate = useCallback(() => {
    const badFrom = isBadDate(fromRef.current);
    const badTo = isBadDate(toRef.current);
    setFromInvalid(badFrom);
    setToInvalid(badTo);
    if (badFrom) fromRef.current?.focus();
    else if (badTo || inverted) toRef.current?.focus();
    return !badFrom && !badTo && !inverted;
  }, [inverted]);

  return {
    fromText,
    toText,
    fromInvalid,
    toInvalid,
    inverted,
    fromRef,
    toRef,
    onFromChange: change("from", setFromText, setFromInvalid),
    onToChange: change("to", setToText, setToInvalid),
    onFromBlur: blur(setFromInvalid),
    onToBlur: blur(setToInvalid),
    validate,
  };
}
