import type { ChangeEvent } from "react";
import type { FieldPath, FieldValues, RegisterOptions, UseFormRegister, UseFormRegisterReturn } from "react-hook-form";
import { applyMask } from "@/lib/masks";

interface MaskOptions {
  /** A máscara enquanto a pessoa digita (nunca corta dígitos, P23). */
  typing: (value: string) => string;
  /** A forma ao colar (o celular lido, sem o +55 e sem o zero, T3). Padrão: a de digitar. */
  pasted?: (value: string) => string;
}

const isPaste = (event: ChangeEvent<HTMLInputElement>): boolean =>
  typeof InputEvent !== "undefined" && event.nativeEvent instanceof InputEvent && event.nativeEvent.inputType === "insertFromPaste";

/**
 * O `register` do react-hook-form com uma máscara (P23): formata o campo a
 * cada mudança, com o cursor depois do mesmo dígito em que estava (UX-06), e
 * então avisa o formulário.
 */
export function maskedRegister<T extends FieldValues>(
  register: UseFormRegister<T>,
  name: FieldPath<T>,
  mask: MaskOptions,
  options?: RegisterOptions<T, FieldPath<T>>,
): UseFormRegisterReturn<FieldPath<T>> {
  const registered = register(name, options);
  return {
    ...registered,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.target;
      const format = isPaste(event) ? (mask.pasted ?? mask.typing) : mask.typing;
      const caret = input.selectionStart ?? input.value.length;
      const masked = applyMask(input.value, caret, format);
      if (masked.value !== input.value) {
        input.value = masked.value;
        input.setSelectionRange(masked.caret, masked.caret);
      }
      return registered.onChange(event);
    },
  };
}
