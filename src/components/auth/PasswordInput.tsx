import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RevealLabels } from "@/lib/auth/password-texts";
import { cn } from "@/lib/utils";

export interface PasswordInputProps extends Omit<ComponentProps<"input">, "type"> {
  id: string;
  /** Os rótulos do botão "Mostrar senha" deste campo (P15, tabela de Textos). */
  revealLabels: RevealLabels;
  /** Muda a cada envio: a senha volta a ficar oculta (P15, UX-35). */
  hideSignal?: number;
}

/**
 * Campo de senha (E2.03, P15): `h-11 pr-12`, com "Mostrar senha" dentro, à
 * direita (44×44, `aria-pressed`, `aria-controls`). Nunca vira maiúscula nem é
 * corrigido, não tem `maxLength`, aceita colar e não faz `trim`. O
 * `autoComplete` vem de quem usa: `current-password`, `new-password` ou `off`.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ id, revealLabels, hideSignal = 0, className, ...props }, ref) => {
    const [shown, setShown] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    useImperativeHandle<HTMLInputElement | null, HTMLInputElement | null>(ref, () => inputRef.current, []);

    useEffect(() => setShown(false), [hideSignal]);

    const toggle = () => {
      setShown((value) => !value);
      inputRef.current?.focus();
    };

    return (
      <div className="relative">
        <Input
          {...props}
          id={id}
          ref={inputRef}
          type={shown ? "text" : "password"}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={cn("h-11 pr-12", className)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-0 top-0 h-11 w-11"
          onClick={toggle}
          aria-label={shown ? revealLabels.hide : revealLabels.show}
          aria-pressed={shown}
          aria-controls={id}
        >
          {shown ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </Button>
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";

export default PasswordInput;
