import { Controller, useFormContext } from "react-hook-form";
import { Info } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TimeInput } from "@/components/form/TimeInput";
import { FieldError, FieldHint } from "@/components/members/FormFieldParts";
import { fieldA11yProps } from "@/lib/a11y";
import { CELL_TYPES } from "@/lib/cells/cell-types";
import { situationHint, situationNotice } from "@/lib/cells/situation";
import { CELL_FORM_TEXTS as TEXTS } from "@/lib/cells/texts";
import { WEEKDAY_OPTIONS } from "@/lib/cells/weekdays";
import type { CellFormValues } from "@/lib/cells/write";
import { cn } from "@/lib/utils";
import { FIELD_BLOCK, LEGEND, invalidBorder, type CellFieldsUi } from "./cell-form-ui";

interface CellMeetingFieldsetProps {
  ui: CellFieldsUi;
  /** A situação gravada; `null` na célula nova, que não tem "Célula ativa" (RN-11). */
  storedActive: boolean | null;
  /** Ao sair do Horário: só o formato (P22). */
  onTimeBlur: () => void;
}

/**
 * "Reunião" (E2.08, T3): Tipo, Dia da semana, Horário (P62) e, só na edição,
 * "Célula ativa" com a dica pela situação gravada e o aviso do que muda (P60).
 */
export function CellMeetingFieldset({ ui, storedActive, onTimeBlur }: CellMeetingFieldsetProps) {
  const { control, watch } = useFormContext<CellFormValues>();
  const active = watch("is_active");
  const typeError = ui.errors.type ?? null;
  const dayError = ui.errors.meeting_day ?? null;
  const timeError = ui.errors.meeting_time ?? null;
  const notice = storedActive === null ? null : situationNotice(storedActive, active);

  return (
    <fieldset className="min-w-0">
      <legend className={LEGEND}>{TEXTS.groups.meeting}</legend>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className={FIELD_BLOCK}>
          <Label htmlFor="type">{TEXTS.labels.type}</Label>
          <Controller
            name="type"
            control={control}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger
                  id="type"
                  ref={field.ref}
                  aria-required="true"
                  className={invalidBorder(!!typeError)}
                  {...fieldA11yProps("type", { error: typeError })}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CELL_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {typeError && <FieldError id="type-error">{typeError}</FieldError>}
        </div>
        {/* Tipo ocupa meia linha; Dia da semana e Horário ficam em par (T1). */}
        <div className="hidden md:block" aria-hidden="true" />

        <div className={FIELD_BLOCK}>
          <Label htmlFor="meeting_day">{TEXTS.labels.meetingDay}</Label>
          <Controller
            name="meeting_day"
            control={control}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger
                  id="meeting_day"
                  ref={field.ref}
                  aria-required="true"
                  className={invalidBorder(!!dayError)}
                  {...fieldA11yProps("meeting_day", { error: dayError })}
                >
                  <SelectValue placeholder={TEXTS.placeholders.meetingDay} />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {dayError && <FieldError id="meeting_day-error">{dayError}</FieldError>}
        </div>

        <div className={FIELD_BLOCK}>
          <Label htmlFor="meeting_time">{TEXTS.labels.meetingTime}</Label>
          <Controller
            name="meeting_time"
            control={control}
            render={({ field }) => (
              <TimeInput
                id="meeting_time"
                name={field.name}
                ref={field.ref}
                value={field.value}
                onValueChange={field.onChange}
                onBlur={() => {
                  field.onBlur();
                  onTimeBlur();
                }}
                placeholder={TEXTS.placeholders.meetingTime}
                required
                className={invalidBorder(!!timeError)}
                {...fieldA11yProps("meeting_time", { error: timeError })}
              />
            )}
          />
          {timeError && <FieldError id="meeting_time-error">{timeError}</FieldError>}
        </div>

        {storedActive !== null && (
          <div className="min-w-0 space-y-2 md:col-span-2">
            <Controller
              name="is_active"
              control={control}
              render={({ field }) => (
                <Label
                  htmlFor="is_active"
                  className={cn("flex min-h-11 flex-1 cursor-pointer items-center justify-between gap-3 rounded-md border p-3")}
                >
                  <span>{TEXTS.labels.isActive}</span>
                  <Switch
                    id="is_active"
                    ref={field.ref}
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    aria-describedby={notice ? "is_active-notice is_active-hint" : "is_active-hint"}
                  />
                </Label>
              )}
            />
            <FieldHint id="is_active-hint">{situationHint(storedActive)}</FieldHint>
            <p id="is_active-notice" role="status" className="flex items-start gap-1.5 text-sm text-foreground empty:hidden">
              {notice && (
                <>
                  <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{notice}</span>
                </>
              )}
            </p>
          </div>
        )}
      </div>
    </fieldset>
  );
}
