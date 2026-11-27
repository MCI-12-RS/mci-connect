import { forwardRef, useImperativeHandle } from "react";
import { DateRangeFilter } from "@/components/filters/DateRangeFilter";
import { GroupedMultiChoiceFilter } from "@/components/filters/GroupedMultiChoiceFilter";
import { MultiChoiceFilter } from "@/components/filters/MultiChoiceFilter";
import { PersonMultiFilter } from "@/components/filters/PersonMultiFilter";
import { SingleChoiceFilter } from "@/components/filters/SingleChoiceFilter";
import { TextFilter } from "@/components/filters/TextFilter";
import { useCellG12Options, useCellLeaderOptions } from "@/hooks/use-cell-filter-options";
import { useFilterDates } from "@/hooks/use-filter-dates";
import type { SelectOption } from "@/lib/selectors";
import {
  CELL_DAY_OPTIONS,
  CELL_FILTER_TEXT_MAX_LENGTH,
  CELL_STATUS_OPTIONS,
  CELL_TYPE_OPTIONS,
  MAX_FILTER_PEOPLE,
  cellDayOf,
  cellTypeOf,
  normalizeCellFilterText,
  type CellFilters as Filters,
} from "@/lib/cells/filters";
import { CELL_FILTER_LABELS as LABELS, CELL_FILTER_TEXTS as TEXTS, CELL_STATUS_LABELS } from "@/lib/cells/filter-texts";
import { REPORT_STATUS_FILTER, reportStatusFilterLabel } from "@/lib/cells/report-status";

const TYPE_OPTIONS = CELL_TYPE_OPTIONS.map((value) => ({ value, label: cellTypeOf(value) }));
const DAY_OPTIONS = CELL_DAY_OPTIONS.map((value) => ({ value, label: cellDayOf(value).label }));
const STATUS_OPTIONS = CELL_STATUS_OPTIONS.map((value) => ({ value, label: CELL_STATUS_LABELS[value] }));

/** O que o `Sheet` pede antes de aplicar: as datas conferidas (P54). */
export interface CellFiltersHandle {
  /** Confere as datas; com erro, mostra a mensagem, põe o foco no campo e devolve `false`. */
  validateDates: () => boolean;
}

/** As pessoas escolhidas num campo de pessoa, já com o rótulo (P53), e quantas estão indisponíveis. */
export interface PersonFieldValue {
  options: readonly SelectOption[];
  unavailableCount: number;
}

interface CellFiltersProps {
  /** No `Sheet` (rascunho, aplicado em "Aplicar filtros") ou no painel do computador (vale na hora). */
  variant: "sheet" | "panel";
  value: Filters;
  onChange: (changes: Partial<Filters>) => void;
  leaders: PersonFieldValue;
  g12: PersonFieldValue;
  /** As pessoas escolhidas agora num seletor, com o nome, para o rótulo não passar por "Carregando…". */
  onPeoplePicked: (options: readonly SelectOption[]) => void;
}

/**
 * Os 10 filtros de Células (E2.10, T2 e T3), na ordem da UXD-1: Líder, G12, Rua, Bairro, Cidade,
 * Tipo, Dia da semana, Situação, Situação do relatório e as datas de cadastro.
 */
export const CellFilters = forwardRef<CellFiltersHandle, CellFiltersProps>(function CellFilters(
  { variant, value, onChange, leaders, g12, onPeoplePicked },
  ref,
) {
  const panel = variant === "panel";
  const dates = useFilterDates({ from: value.from, to: value.to, panel, onChange });
  const validateDates = dates.validate;
  useImperativeHandle(ref, () => ({ validateDates }), [validateDates]);

  const personField = (field: "leaders" | "g12") => {
    const current = field === "leaders" ? leaders : g12;
    return (
      <PersonMultiFilter
        texts={TEXTS[field]}
        value={current.options}
        onChange={(options) => {
          onPeoplePicked(options.filter((option) => !current.options.some((chosen) => chosen.value === option.value)));
          onChange({ [field]: options.map((option) => option.value) });
        }}
        unavailableCount={current.unavailableCount}
        noResultsLabel={TEXTS[field].noResults}
        max={MAX_FILTER_PEOPLE}
        useOptions={field === "leaders" ? useCellLeaderOptions : useCellG12Options}
      />
    );
  };

  const text = (key: "street" | "neighborhood" | "city") => (
    <TextFilter
      label={LABELS[key]}
      value={value[key]}
      onChange={(next) => onChange({ [key]: next })}
      debounced={panel}
      normalize={normalizeCellFilterText}
      maxLength={CELL_FILTER_TEXT_MAX_LENGTH}
    />
  );

  const fields = {
    leaders: personField("leaders"),
    g12: personField("g12"),
    street: text("street"),
    neighborhood: text("neighborhood"),
    city: text("city"),
    type: (
      <MultiChoiceFilter
        legend={LABELS.type}
        options={TYPE_OPTIONS}
        values={value.types}
        onChange={(types) => onChange({ types })}
        variant={panel ? "popover" : "checkboxes"}
      />
    ),
    day: (
      <MultiChoiceFilter
        legend={LABELS.day}
        options={DAY_OPTIONS}
        values={value.days}
        onChange={(days) => onChange({ days })}
        variant={panel ? "popover" : "checkboxes"}
        twoColumns
      />
    ),
    status: (
      <SingleChoiceFilter
        legend={LABELS.status}
        options={STATUS_OPTIONS}
        value={value.status}
        onChange={(status) => onChange({ status })}
        variant={panel ? "select" : "radio"}
        allLabel={TEXTS.allFeminine}
      />
    ),
    reportStatus: (
      <GroupedMultiChoiceFilter
        legend={REPORT_STATUS_FILTER.legend}
        groups={REPORT_STATUS_FILTER.groups}
        values={value.reportStatuses}
        onChange={(reportStatuses) => onChange({ reportStatuses })}
        variant={panel ? "popover" : "checkboxes"}
        hint={REPORT_STATUS_FILTER.hint}
        fullLabel={reportStatusFilterLabel}
        allLabel={REPORT_STATUS_FILTER.all}
      />
    ),
    dates: (
      <DateRangeFilter
        legend={LABELS.dates}
        legendSrOnly
        fromLabel={LABELS.from}
        toLabel={LABELS.to}
        from={dates.fromText}
        to={dates.toText}
        onFromChange={dates.onFromChange}
        onToChange={dates.onToChange}
        onFromBlur={dates.onFromBlur}
        onToBlur={dates.onToBlur}
        fromError={dates.fromInvalid ? TEXTS.invalidDate : null}
        toError={dates.toInvalid ? TEXTS.invalidDate : null}
        invertedMessage={dates.inverted ? TEXTS.invertedDates : null}
        hint={TEXTS.datesHint}
        fromRef={dates.fromRef}
        toRef={dates.toRef}
        inline={panel}
      />
    ),
  };

  if (panel) {
    return (
      <>
        <div className="col-span-2 min-w-0">{fields.leaders}</div>
        <div className="col-span-2 min-w-0">{fields.g12}</div>
        {fields.street}
        {fields.neighborhood}
        {fields.city}
        {fields.type}
        {fields.day}
        {fields.status}
        <div className="col-span-2 min-w-0">{fields.reportStatus}</div>
        <div className="col-span-2 min-w-0">{fields.dates}</div>
      </>
    );
  }

  return (
    <>
      {fields.leaders}
      {fields.g12}
      {fields.street}
      {fields.neighborhood}
      {fields.city}
      {fields.type}
      {fields.day}
      {fields.status}
      {fields.reportStatus}
      {fields.dates}
    </>
  );
});
