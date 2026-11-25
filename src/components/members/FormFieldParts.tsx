import { AlertCircle } from "lucide-react";

/** Dica embaixo de um campo, ligada a ele por `aria-describedby` (P11). */
export function FieldHint({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} className="text-sm text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * Erro embaixo de um campo: ícone e texto, nunca só a cor (Acessibilidade).
 * O texto fica em `text-foreground` e o vermelho só no ícone: o
 * `text-destructive` sobre o fundo do diálogo não chega a 4,5:1 (UX-29).
 */
export function FieldError({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-sm text-foreground">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

interface ReadOnlyValueProps {
  label: string;
  /** O valor; sem ele, o rótulo já é o valor ("Pastor(a)", "Sem liderança"). */
  value?: string;
  /** O motivo ou a dica, embaixo. */
  note?: string | null;
}

/**
 * Valor que a pessoa precisa conhecer, mas não pode mudar (P12): rótulo,
 * valor e motivo em texto, sem `Input disabled`.
 */
export function ReadOnlyValue({ label, value, note }: ReadOnlyValueProps) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{label}</p>
      {value !== undefined && <p className="text-base break-words">{value}</p>}
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
    </div>
  );
}
