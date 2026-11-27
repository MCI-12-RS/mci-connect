import { forwardRef } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fieldA11yProps } from "@/lib/a11y";
import { dayOption } from "@/lib/cell-reports/dates";
import { MEETING_TEXTS, REPORT_FORM_TEXTS } from "@/lib/cell-reports/texts";
import { cn } from "@/lib/utils";

interface DateSelectProps {
  id: string;
  value: string;
  /** Os dias possíveis, do servidor (P104); o valor atual entra se faltar. */
  dates: string[];
  today: string;
  error?: string;
  /** Ids extras do `aria-describedby` (a dica e o erro do par Data e Horário). */
  describedBy?: string;
  onChange: (date: string) => void;
  disabled?: boolean;
}

/**
 * A data num intervalo curto (E2.11, P104, UXD-6): um `Select` com um dia por
 * opção, "Quarta, 25/11/2026", com " (hoje)". Com um dia só, ele aparece como
 * texto (P12), com o rótulo "Data", sem "*".
 */
export const DateSelect = forwardRef<HTMLButtonElement, DateSelectProps>(
  ({ id, value, dates, today, error, describedBy, onChange, disabled }, ref) => {
    const options = value && !dates.includes(value) ? [...dates, value].sort() : dates;
    if (options.length === 1) {
      return (
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-medium leading-none">{MEETING_TEXTS.date}</p>
          <p className="text-sm" id={id}>
            {dayOption(options[0], today, MEETING_TEXTS.today)}
          </p>
        </div>
      );
    }
    const a11y = fieldA11yProps(id, { error });
    return (
      <div className="min-w-0 space-y-2">
        <Label htmlFor={id} className="block">
          {MEETING_TEXTS.date}
          {REPORT_FORM_TEXTS.required}
        </Label>
        <Select value={value} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger
            id={id}
            ref={ref}
            aria-required="true"
            aria-invalid={a11y["aria-invalid"]}
            aria-describedby={[a11y["aria-describedby"], describedBy].filter(Boolean).join(" ") || undefined}
            className={cn(error && "border-destructive")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((date) => (
              <SelectItem key={date} value={date}>
                {dayOption(date, today, MEETING_TEXTS.today)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  },
);
DateSelect.displayName = "DateSelect";
