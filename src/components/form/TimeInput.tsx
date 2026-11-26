import { forwardRef, type ChangeEvent, type FocusEvent, type InputHTMLAttributes } from "react";
import { Input } from "@/components/ui/input";
import { maskHhmm, readHhmmOnBlur } from "@/lib/time/hhmm";

interface TimeInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value: string;
  onValueChange: (value: string) => void;
}

const isDeleting = (event: ChangeEvent<HTMLInputElement>): boolean =>
  typeof InputEvent !== "undefined" && event.nativeEvent instanceof InputEvent && event.nativeEvent.inputType.startsWith("delete");

/**
 * Horário digitado "HH:mm", sempre em 24 h (E2.08, P62, UXD-5): texto com
 * máscara e teclado numérico, e não o `type="time"`. A máscara põe os
 * dois-pontos depois do 2º dígito; ao sair do campo, "20" vira "20:00" e
 * "7" vira "07:00" (`readHhmmOnBlur`). O que não se lê fica como está, para o
 * erro aparecer sobre o que foi digitado.
 */
export const TimeInput = forwardRef<HTMLInputElement, TimeInputProps>(({ value, onValueChange, onBlur, ...props }, ref) => (
  <Input
    ref={ref}
    {...props}
    type="text"
    inputMode="numeric"
    autoComplete="off"
    maxLength={5}
    value={value}
    onChange={(event) => onValueChange(maskHhmm(event.target.value, { deleting: isDeleting(event) }))}
    onBlur={(event: FocusEvent<HTMLInputElement>) => {
      const read = readHhmmOnBlur(value);
      if (read !== value) onValueChange(read);
      onBlur?.(event);
    }}
  />
));
TimeInput.displayName = "TimeInput";
