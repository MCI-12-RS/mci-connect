import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, type FocusEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateRangeFilter } from "@/components/filters/DateRangeFilter";
import { MultiChoiceFilter } from "@/components/filters/MultiChoiceFilter";
import { PersonMultiFilter } from "@/components/filters/PersonMultiFilter";
import { SingleChoiceFilter } from "@/components/filters/SingleChoiceFilter";
import { FILTER_LABEL_CLASS, type FilterOption } from "@/components/filters/filter-options";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { isDateRangeInverted } from "@/lib/filters/dates";
import type { SelectOption } from "@/lib/selectors";
import {
  FILTER_TEXT_MAX_LENGTH,
  MAX_LEADERS,
  MEMBER_BAPTIZED_OPTIONS,
  MEMBER_CELL_LINK_OPTIONS,
  MEMBER_LEADERSHIP_OPTIONS,
  MEMBER_LEVEL_OPTIONS,
  MEMBER_STATUS_OPTIONS,
  normalizeFilterText,
  type MemberFilters as Filters,
} from "@/lib/members/filters";
import {
  MEMBER_BAPTIZED_LABELS,
  MEMBER_CELL_LINK_HINTS,
  MEMBER_CELL_LINK_LABELS,
  MEMBER_FILTER_LABELS as LABELS,
  MEMBER_FILTER_TEXTS as TEXTS,
  MEMBER_LEADERSHIP_LABELS,
  MEMBER_LEVEL_LABELS,
  MEMBER_STATUS_LABELS,
} from "@/lib/members/filter-texts";

const STATUS_OPTIONS = MEMBER_STATUS_OPTIONS.map((value) => ({ value, label: MEMBER_STATUS_LABELS[value] }));
const BAPTIZED_OPTIONS = MEMBER_BAPTIZED_OPTIONS.map((value) => ({ value, label: MEMBER_BAPTIZED_LABELS[value] }));
const LEADERSHIP_OPTIONS = MEMBER_LEADERSHIP_OPTIONS.map((value) => ({ value, label: MEMBER_LEADERSHIP_LABELS[value] }));
const LEVEL_OPTIONS = MEMBER_LEVEL_OPTIONS.map((value) => ({ value, label: MEMBER_LEVEL_LABELS[value] }));
const CELL_LINK_OPTIONS: FilterOption<(typeof MEMBER_CELL_LINK_OPTIONS)[number]>[] = MEMBER_CELL_LINK_OPTIONS.map((value) => ({
  value,
  label: MEMBER_CELL_LINK_LABELS[value],
  hint: MEMBER_CELL_LINK_HINTS[value],
}));

/** O que o `Sheet` pede antes de aplicar: as datas conferidas (P54). */
export interface MemberFiltersHandle {
  /** Confere as datas; com erro, mostra a mensagem, põe o foco no campo e devolve `false`. */
  validateDates: () => boolean;
}

interface MemberFiltersProps {
  /** No `Sheet` (rascunho, aplicado em "Aplicar filtros") ou no painel do computador (vale na hora). */
  variant: "sheet" | "panel";
  value: Filters;
  onChange: (changes: Partial<Filters>) => void;
  /** As pessoas escolhidas na Liderança, já com o rótulo (P53). */
  leaders: readonly SelectOption[];
  /** As pessoas escolhidas agora no seletor, com o nome, para o rótulo não passar por "Carregando…". */
  onLeadersPicked: (options: readonly SelectOption[]) => void;
  unavailableCount: number;
  /** A busca sem resultado no seletor (P11). */
  noResultsLabel: string;
}

/** Um campo de texto do filtro (Bairro, Cidade): no painel, vale 300 ms depois da última tecla. */
function TextFilter({
  label,
  value,
  onChange,
  debounced,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  debounced: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(value ?? "");
  const settled = useDebouncedValue(text, 300);

  // A URL mudou por fora (chip, "Limpar filtros", voltar): o campo acompanha.
  useEffect(() => {
    if (normalizeFilterText(text) !== value) setText(value ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // No painel, só a digitação aplica: a URL mudando por fora não pode devolver o texto antigo.
  useEffect(() => {
    if (debounced && normalizeFilterText(settled) !== value) onChange(normalizeFilterText(settled));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);

  return (
    <div className="min-w-0">
      <Label htmlFor={id} className={FILTER_LABEL_CLASS}>
        {label}
      </Label>
      <Input
        id={id}
        value={text}
        maxLength={FILTER_TEXT_MAX_LENGTH}
        autoComplete="off"
        enterKeyHint="search"
        onChange={(event) => {
          setText(event.target.value);
          if (!debounced) onChange(normalizeFilterText(event.target.value));
        }}
        className="h-11 md:h-10"
      />
    </div>
  );
}

/**
 * Os 9 filtros de Membros (E2.07, T2 e T3), na ordem do legado (UXD-3): Liderança, Bairro, Cidade,
 * Situação, Situação de liderança, Batizado, Nível, Vínculo celular e as datas de cadastro.
 */
export const MemberFilters = forwardRef<MemberFiltersHandle, MemberFiltersProps>(function MemberFilters(
  { variant, value, onChange, leaders, onLeadersPicked, unavailableCount, noResultsLabel },
  ref,
) {
  const panel = variant === "panel";
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const [fromInvalid, setFromInvalid] = useState(false);
  const [toInvalid, setToInvalid] = useState(false);
  const inverted = isDateRangeInverted(value.from, value.to);

  // Data que não existe ou incompleta: o campo nativo fica vazio com `badInput` (P54). Conferida ao
  // sair do campo e ao aplicar, nunca durante a digitação.
  const checkOnBlur = (setInvalid: (invalid: boolean) => void) => (event: FocusEvent<HTMLInputElement>) =>
    setInvalid(event.currentTarget.validity.badInput);

  useImperativeHandle(
    ref,
    () => ({
      validateDates: () => {
        const badFrom = fromRef.current?.validity.badInput === true;
        const badTo = toRef.current?.validity.badInput === true;
        setFromInvalid(badFrom);
        setToInvalid(badTo);
        if (badFrom) fromRef.current?.focus();
        else if (badTo || inverted) toRef.current?.focus();
        return !badFrom && !badTo && !inverted;
      },
    }),
    [inverted],
  );

  const changeDate = (key: "from" | "to", raw: string, setInvalid: (invalid: boolean) => void) => {
    if (raw) setInvalid(false);
    onChange({ [key]: raw || null });
  };

  const leaderField = (
    <PersonMultiFilter
      texts={TEXTS.leaders}
      value={leaders}
      onChange={(options) => {
        onLeadersPicked(options.filter((option) => !leaders.some((leader) => leader.value === option.value)));
        onChange({ leaders: options.map((option) => option.value) });
      }}
      unavailableCount={unavailableCount}
      noResultsLabel={noResultsLabel}
      max={MAX_LEADERS}
    />
  );

  const dates = (
    <DateRangeFilter
      legend={LABELS.dates}
      legendSrOnly
      fromLabel={LABELS.from}
      toLabel={LABELS.to}
      from={value.from ?? ""}
      to={value.to ?? ""}
      onFromChange={(raw) => changeDate("from", raw, setFromInvalid)}
      onToChange={(raw) => changeDate("to", raw, setToInvalid)}
      onFromBlur={checkOnBlur(setFromInvalid)}
      onToBlur={checkOnBlur(setToInvalid)}
      fromError={fromInvalid ? TEXTS.invalidDate : null}
      toError={toInvalid ? TEXTS.invalidDate : null}
      invertedMessage={inverted ? TEXTS.invertedDates : null}
      hint={TEXTS.datesHint}
      fromRef={fromRef}
      toRef={toRef}
      inline={panel}
    />
  );

  const fields = {
    neighborhood: (
      <TextFilter
        label={LABELS.neighborhood}
        value={value.neighborhood}
        onChange={(neighborhood) => onChange({ neighborhood })}
        debounced={panel}
      />
    ),
    city: <TextFilter label={LABELS.city} value={value.city} onChange={(city) => onChange({ city })} debounced={panel} />,
    status: (
      <SingleChoiceFilter
        legend={LABELS.status}
        options={STATUS_OPTIONS}
        value={value.status}
        onChange={(status) => onChange({ status })}
        variant={panel ? "select" : "radio"}
      />
    ),
    leadership: (
      <MultiChoiceFilter
        legend={LABELS.leadership}
        options={LEADERSHIP_OPTIONS}
        values={value.leadership}
        onChange={(leadership) => onChange({ leadership })}
        variant={panel ? "popover" : "checkboxes"}
      />
    ),
    baptized: (
      <SingleChoiceFilter
        legend={LABELS.baptized}
        options={BAPTIZED_OPTIONS}
        value={value.baptized}
        onChange={(baptized) => onChange({ baptized })}
        variant={panel ? "select" : "radio"}
      />
    ),
    level: (
      <MultiChoiceFilter
        legend={LABELS.level}
        options={LEVEL_OPTIONS}
        values={value.levels}
        onChange={(levels) => onChange({ levels })}
        variant={panel ? "popover" : "checkboxes"}
        groupHint={TEXTS.levelHint}
        groupHintPosition="after"
      />
    ),
    cellLink: (
      <MultiChoiceFilter
        legend={LABELS.cellLink}
        options={CELL_LINK_OPTIONS}
        values={value.cellLinks}
        onChange={(cellLinks) => onChange({ cellLinks })}
        variant={panel ? "popover" : "checkboxes"}
        groupHint={TEXTS.cellLinkHint}
        groupHintPosition="before"
      />
    ),
  };

  if (panel) {
    return (
      <>
        <div className="col-span-2 min-w-0">{leaderField}</div>
        {fields.neighborhood}
        {fields.city}
        {fields.status}
        {fields.leadership}
        {fields.baptized}
        {fields.level}
        {fields.cellLink}
        <div className="col-span-2 min-w-0">{dates}</div>
      </>
    );
  }

  return (
    <>
      {leaderField}
      {fields.neighborhood}
      {fields.city}
      {fields.status}
      {fields.leadership}
      {fields.baptized}
      {fields.level}
      {fields.cellLink}
      {dates}
    </>
  );
});
