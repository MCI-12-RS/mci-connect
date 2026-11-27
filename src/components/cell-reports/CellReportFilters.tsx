import { forwardRef, useId, useImperativeHandle } from "react";
import { DateRangeFilter } from "@/components/filters/DateRangeFilter";
import { MultiChoiceFilter } from "@/components/filters/MultiChoiceFilter";
import { PersonMultiFilter } from "@/components/filters/PersonMultiFilter";
import { RecordFilterChip, type RecordFilterChipState } from "@/components/filters/RecordFilterChip";
import { SingleChoiceFilter } from "@/components/filters/SingleChoiceFilter";
import { FILTER_LABEL_CLASS } from "@/components/filters/filter-options";
import { useCellReportG12Options, useCellReportLeaderOptions } from "@/hooks/use-cell-report-filter-options";
import { useFilterDates } from "@/hooks/use-filter-dates";
import type { SelectOption } from "@/lib/selectors";
import {
  CELL_TYPE_OPTIONS,
  HELD_OPTIONS,
  MAX_FILTER_PEOPLE,
  cellTypeOf,
  type CellReportFilters as Filters,
} from "@/lib/cell-reports/filters";
import { CELL_REPORT_FILTER_LABELS as LABELS, CELL_REPORT_FILTER_TEXTS as TEXTS, HELD_LABELS } from "@/lib/cell-reports/filter-texts";

const TYPE_OPTIONS = CELL_TYPE_OPTIONS.map((value) => ({ value, label: cellTypeOf(value) }));
const HELD_CHOICES = HELD_OPTIONS.map((value) => ({ value, label: HELD_LABELS[value] }));

/** O que o `Sheet` pede antes de aplicar: as datas conferidas (T7). */
export interface CellReportFiltersHandle {
  /** Confere as datas; com erro, mostra a mensagem, põe o foco no campo e devolve `false`. */
  validateDates: () => boolean;
}

/** As pessoas escolhidas num campo de pessoa, já com o rótulo (P53), e quantas estão indisponíveis. */
export interface PersonFieldValue {
  options: readonly SelectOption[];
  unavailableCount: number;
}

interface CellReportFiltersProps {
  /** No `Sheet` (rascunho, aplicado em "Aplicar filtros") ou no painel do computador (vale na hora). */
  variant: "sheet" | "panel";
  value: Filters;
  onChange: (changes: Partial<Filters>) => void;
  /** O chip da Célula (P84), quando há Célula no valor. */
  cellChip: RecordFilterChipState;
  leaders: PersonFieldValue;
  g12: PersonFieldValue;
  /** As pessoas escolhidas agora num seletor, com o nome, para o rótulo não passar por "Carregando…". */
  onPeoplePicked: (options: readonly SelectOption[]) => void;
}

/**
 * Os filtros de Relatórios (E2.12, T4 e T5), na ordem da UXD-2: a Célula (só vinda de link, P93),
 * Líder, G12, Período, Tipo e Reunião.
 */
export const CellReportFilters = forwardRef<CellReportFiltersHandle, CellReportFiltersProps>(function CellReportFilters(
  { variant, value, onChange, cellChip, leaders, g12, onPeoplePicked },
  ref,
) {
  const panel = variant === "panel";
  const baseId = useId();
  const cellLabelId = `${baseId}-cell`;
  const leadersFieldId = `${baseId}-leaders`;
  const dates = useFilterDates({ from: value.from, to: value.to, panel, onChange });
  const validateDates = dates.validate;
  useImperativeHandle(ref, () => ({ validateDates }), [validateDates]);

  // O "✕" da Célula leva o foco ao campo do Líder (P93): o bloco some com ele.
  const removeCell = () => {
    onChange({ cellId: null });
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`#${CSS.escape(leadersFieldId)} input`)?.focus());
  };

  const personField = (field: "leaderIds" | "g12Ids") => {
    const current = field === "leaderIds" ? leaders : g12;
    const texts = field === "leaderIds" ? TEXTS.leaders : TEXTS.g12;
    return (
      <PersonMultiFilter
        texts={texts}
        value={current.options}
        onChange={(options) => {
          onPeoplePicked(options.filter((option) => !current.options.some((chosen) => chosen.value === option.value)));
          onChange({ [field]: options.map((option) => option.value) });
        }}
        unavailableCount={current.unavailableCount}
        noResultsLabel={texts.noResults}
        max={MAX_FILTER_PEOPLE}
        useOptions={field === "leaderIds" ? useCellReportLeaderOptions : useCellReportG12Options}
      />
    );
  };

  const cell = value.cellId !== null && (
    <div role="group" aria-labelledby={cellLabelId} className="min-w-0 space-y-1">
      <p id={cellLabelId} className={FILTER_LABEL_CLASS}>
        {LABELS.cell}
      </p>
      <RecordFilterChip state={cellChip} texts={TEXTS.cell} onRemove={removeCell} />
    </div>
  );

  const fields = {
    leaders: <div id={leadersFieldId} className="min-w-0">{personField("leaderIds")}</div>,
    g12: personField("g12Ids"),
    dates: (
      <DateRangeFilter
        legend={LABELS.dates}
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
        fromRef={dates.fromRef}
        toRef={dates.toRef}
        inline={panel}
      />
    ),
    type: (
      <MultiChoiceFilter
        legend={LABELS.type}
        options={TYPE_OPTIONS}
        values={value.types}
        onChange={(types) => onChange({ types })}
        variant={panel ? "popover" : "checkboxes"}
        groupHint={TEXTS.typeHint}
        groupHintPosition="before"
      />
    ),
    held: (
      <SingleChoiceFilter
        legend={LABELS.held}
        options={HELD_CHOICES}
        value={value.held}
        onChange={(held) => onChange({ held })}
        variant={panel ? "select" : "radio"}
        allLabel={TEXTS.allFeminine}
        layout="stacked"
      />
    ),
  };

  if (panel) {
    return (
      <>
        {cell && <div className="col-span-4 min-w-0">{cell}</div>}
        <div className="col-span-2 min-w-0">{fields.leaders}</div>
        <div className="col-span-2 min-w-0">{fields.g12}</div>
        <div className="col-span-2 min-w-0">{fields.dates}</div>
        {fields.type}
        {fields.held}
      </>
    );
  }

  return (
    <>
      {cell}
      {fields.leaders}
      {fields.g12}
      {fields.dates}
      {fields.type}
      {fields.held}
    </>
  );
});
