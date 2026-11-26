import { Circle, CircleCheck } from "lucide-react";
import { meetsMinLength } from "@/lib/auth/password-policy";
import { PASSWORD_CHANGE_TEXTS } from "@/lib/auth/password-texts";

interface PasswordRulesProps {
  id: string;
  /** A senha digitada: a primeira regra muda de ícone ao chegar a 8 caracteres. */
  password: string;
}

/**
 * As regras da senha nova (E2.03, P16, UXD-1), entre o rótulo e o campo e no
 * `aria-describedby` dele. Só o tamanho é conferido ao vivo, pela forma do
 * ícone e por "(regra atendida)" para o leitor de tela, sem `aria-live`.
 */
export function PasswordRules({ id, password }: PasswordRulesProps) {
  const met = meetsMinLength(password);
  const Icon = met ? CircleCheck : Circle;
  return (
    <div id={id} className="space-y-1 text-sm text-muted-foreground" data-testid="password-rules">
      <p className="flex items-start gap-1.5">
        <Icon
          className={met ? "mt-0.5 h-4 w-4 shrink-0 text-foreground" : "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"}
          aria-hidden="true"
          data-rule-met={met}
        />
        <span>
          {PASSWORD_CHANGE_TEXTS.rulesMinLength}
          {met && <span className="sr-only"> {PASSWORD_CHANGE_TEXTS.ruleMet}</span>}
        </span>
      </p>
      <p>{PASSWORD_CHANGE_TEXTS.rulesRest}</p>
    </div>
  );
}

export default PasswordRules;
