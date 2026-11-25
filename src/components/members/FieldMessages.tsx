import { TriangleAlert } from "lucide-react";
import type { FieldMessageTexts } from "@/lib/a11y";
import { FieldError, FieldHint } from "./FormFieldParts";

/**
 * Aviso de dado antigo embaixo de um campo (P21, P24): outro ícone, texto em
 * `text-foreground`, sem `aria-invalid` e sem a borda de erro.
 */
export function FieldWarning({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-sm text-foreground">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/**
 * As mensagens embaixo de um campo (P21): erro, aviso e dica, nessa ordem,
 * com os ids que `fieldMessageIds` liga ao campo por `aria-describedby`.
 */
export function FieldMessages({ id, error, warning, hint }: FieldMessageTexts & { id: string }) {
  return (
    <>
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
      {warning && <FieldWarning id={`${id}-warning`}>{warning}</FieldWarning>}
      {hint && <FieldHint id={`${id}-hint`}>{hint}</FieldHint>}
    </>
  );
}
