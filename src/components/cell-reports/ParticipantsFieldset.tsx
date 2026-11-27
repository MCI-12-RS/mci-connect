import { useEffect, useRef } from "react";
import { Label } from "@/components/ui/label";
import { PaginatedSelect, type PaginatedSelectHandle } from "@/components/select/PaginatedSelect";
import { FieldError, FieldHint } from "@/components/members/FormFieldParts";
import { toMarkedMemberOption, useMemberOptions } from "@/hooks/use-member-options";
import { useOptionsPagination, useSelectSearch } from "@/hooks/use-paginated-select";
import type { FocusTarget } from "@/hooks/use-report-form-state";
import { describedBy } from "@/lib/a11y";
import { withFixedDisabled, type FixedParticipant } from "@/lib/cell-reports/participants";
import { REPORT_LIMITS } from "@/lib/cell-reports/limits";
import { PARTICIPANTS_TEXTS, REPORT_RULE_TEXTS } from "@/lib/cell-reports/texts";
import type { ReportFormField } from "@/lib/cell-reports/validation";
import type { SelectOption } from "@/lib/selectors";

export interface ParticipantsFieldsetProps {
  /** Os automáticos (lançamento) ou os registrados (edição): texto, sem ✕ (P103). */
  fixed: FixedParticipant[];
  /** A dica acima da lista fixa. */
  fixedHint: string;
  chosen: SelectOption[];
  onChosenChange: (options: SelectOption[]) => void;
  /** "Continuam no relatório (cadastros excluídos): …" (E2.01). */
  keptLine: string | null;
  /** "Aparecem só as pessoas do seu ministério." (E2.02, P11). */
  scopeHint: string | null;
  /** O aviso de quem quem edita não vê (E2.02, T8). */
  hiddenWarning: string | null;
  noResultsLabel: string;
  total: number;
  error?: string;
  disabled?: boolean;
  registerFocus: (field: ReportFormField, target: FocusTarget | null) => void;
}

const removeLabel = (label: string) => PARTICIPANTS_TEXTS.remove(label);

/**
 * O grupo "Participantes" (E2.11, T5, P103): os fixos como texto, o seletor
 * "Outros participantes" com os inativos marcados (P63) e os fixos
 * desabilitados com o motivo (P5), e o total, que é o que o servidor grava.
 */
export function ParticipantsFieldset(props: ParticipantsFieldsetProps) {
  const { registerFocus } = props;
  const search = useSelectSearch();
  const query = useMemberOptions({
    search: search.term,
    enabled: search.isMenuOpen,
  });
  const pagination = useOptionsPagination(query, toMarkedMemberOption);
  const atLimit = props.total >= REPORT_LIMITS.participants;
  const fixedIds = props.fixed.map((p) => p.id);
  const options = atLimit
    ? pagination.options.map((option) => ({
        ...option,
        disabledReason: REPORT_RULE_TEXTS.too_many_participants,
      }))
    : withFixedDisabled(pagination.options, fixedIds, PARTICIPANTS_TEXTS.alreadyIn);
  const selectRef = useRef<PaginatedSelectHandle>(null);

  useEffect(() => {
    registerFocus("participant_ids", () => selectRef.current?.focus());
    return () => registerFocus("participant_ids", null);
  }, [registerFocus]);

  return (
    <fieldset className="min-w-0 space-y-3">
      <legend className="mb-3 text-base font-semibold">{PARTICIPANTS_TEXTS.legend}</legend>
      <FieldHint id="participants-fixed-hint">{props.fixedHint}</FieldHint>
      {props.fixed.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {props.fixed.map((person) => (
            <li key={person.id} className="break-words">
              {person.name}
            </li>
          ))}
        </ul>
      )}
      <div className="min-w-0 space-y-2">
        <Label htmlFor="report-participants">{PARTICIPANTS_TEXTS.others}</Label>
        <PaginatedSelect
          isMulti
          inputId="report-participants"
          focusRef={selectRef}
          search={search}
          pagination={{ ...pagination, options }}
          value={props.chosen}
          onChange={(selected) => props.onChosenChange([...selected])}
          placeholder={PARTICIPANTS_TEXTS.placeholder}
          noResultsLabel={props.noResultsLabel}
          isDisabled={props.disabled}
          removeLabel={removeLabel}
          aria-invalid={!!props.error}
          aria-errormessage={props.error ? "participants-error" : undefined}
          aria-describedby={describedBy(
            props.error && "participants-error",
            props.keptLine && "participants-kept",
            props.hiddenWarning && "participants-hidden",
            props.scopeHint && "participants-scope",
            atLimit && "participants-limit",
          )}
        />
        {props.error && <FieldError id="participants-error">{props.error}</FieldError>}
        {props.hiddenWarning && <FieldHint id="participants-hidden">{props.hiddenWarning}</FieldHint>}
        {props.keptLine && <FieldHint id="participants-kept">{props.keptLine}</FieldHint>}
        {props.scopeHint && <FieldHint id="participants-scope">{props.scopeHint}</FieldHint>}
        {atLimit && (
          <p id="participants-limit" role="status" className="text-sm text-foreground">
            {REPORT_RULE_TEXTS.too_many_participants}
          </p>
        )}
      </div>
      <p role="status" className="text-sm font-medium">
        {PARTICIPANTS_TEXTS.total(props.total)}
      </p>
    </fieldset>
  );
}
