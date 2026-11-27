import { useEffect, useRef } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/members/FormFieldParts";
import type { FocusTarget, ShownReportErrors } from "@/hooks/use-report-form-state";
import { fieldA11yProps } from "@/lib/a11y";
import { OBSERVATIONS_TEXTS } from "@/lib/cell-reports/texts";
import type { ReportFormField, ReportFormValues } from "@/lib/cell-reports/validation";
import { cn } from "@/lib/utils";
import { OfferingInput } from "./OfferingInput";
import { ParticipantsFieldset, type ParticipantsFieldsetProps } from "./ParticipantsFieldset";
import { VisitorsFieldset } from "./VisitorsFieldset";

interface HeldFieldsProps {
  values: Pick<ReportFormValues, "visitors" | "offering" | "observations">;
  errors: ShownReportErrors;
  participants: Omit<ParticipantsFieldsetProps, "registerFocus" | "error" | "disabled">;
  disabled?: boolean;
  onVisitorsChange: (names: string[]) => void;
  onOfferingChange: (value: string) => void;
  onObservationsChange: (value: string) => void;
  registerFocus: (field: ReportFormField, target: FocusTarget | null) => void;
}

/**
 * Só na célula realizada (E2.11, T1 ordem 6; UXD-8): Participantes,
 * Visitantes, Oferta e Observações. Em "Não houve célula", nada disto fica no
 * DOM (RN-09).
 */
export function HeldFields({
  values,
  errors,
  participants,
  disabled,
  onVisitorsChange,
  onOfferingChange,
  onObservationsChange,
  registerFocus,
}: HeldFieldsProps) {
  const offeringRef = useRef<HTMLInputElement>(null);
  const observationsRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    registerFocus("offering", () => offeringRef.current?.focus());
    registerFocus("observations", () => observationsRef.current?.focus());
    return () => {
      registerFocus("offering", null);
      registerFocus("observations", null);
    };
  }, [registerFocus]);

  return (
    <>
      <ParticipantsFieldset {...participants} error={errors.participant_ids} disabled={disabled} registerFocus={registerFocus} />
      <VisitorsFieldset
        names={values.visitors}
        onChange={onVisitorsChange}
        error={errors.visitors}
        disabled={disabled}
        registerFocus={registerFocus}
      />
      <OfferingInput
        ref={offeringRef}
        value={values.offering}
        onChange={onOfferingChange}
        error={errors.offering}
        disabled={disabled}
      />
      <div className="min-w-0 space-y-2">
        <Label htmlFor="report-observations">{OBSERVATIONS_TEXTS.label}</Label>
        <Textarea
          id="report-observations"
          ref={observationsRef}
          rows={3}
          value={values.observations}
          onChange={(event) => onObservationsChange(event.target.value)}
          autoComplete="off"
          autoCapitalize="sentences"
          disabled={disabled}
          className={cn("min-h-0 text-base md:text-sm", errors.observations && "border-destructive")}
          {...fieldA11yProps("report-observations", {
            error: errors.observations,
          })}
        />
        {errors.observations && <FieldError id="report-observations-error">{errors.observations}</FieldError>}
      </div>
    </>
  );
}
