import type { ReactNode } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { AlertCircle, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import AsyncMemberSelect from "@/components/AsyncMemberSelect";
import { FieldError, FieldHint } from "@/components/members/FormFieldParts";
import type { MemberStatus } from "@/hooks/use-member-statuses";
import type { HostAddressStatus } from "@/hooks/use-host-address";
import { CELL_FORM_TEXTS as TEXTS } from "@/lib/cells/texts";
import { CELL_FORM_TEXTS as SCOPE_TEXTS } from "@/lib/access/texts";
import { describedBy } from "@/lib/a11y";
import type { HostAddressOutcome } from "@/lib/cells/host-address";
import type { CellFormValues } from "@/lib/cells/write";
import { FIELD_BLOCK, LEGEND, type CellFieldsUi } from "./cell-form-ui";

type PersonField = "leader_id" | "timothy_id" | "host_id";

const SCOPE_HINT_ID = "cell-people-hint";
const HOST_NOTICE_ID = "host_id-address";

/** O endereço do anfitrião embaixo do Anfitrião (P61). */
export interface HostAddressUi {
  status: HostAddressStatus;
  /** O resultado da última escolha; some na escolha seguinte. */
  outcome: HostAddressOutcome | null;
  onRetry: () => void;
  onGoToAddress: () => void;
}

interface CellPeopleFieldsetProps {
  ui: CellFieldsUi;
  /** Os nomes gravados, da `cells_view` (DT-23): valem fora do escopo de quem edita. */
  savedNames: Partial<Record<PersonField, string | null>>;
  /** A situação de quem está gravado (P63): `undefined` carregando, `null` fora do escopo. */
  statusOf: (field: PersonField) => MemberStatus | null | undefined;
  /** Quem vê só o ministério (E2.02, T7): a dica de alcance acima do Líder. */
  showScopeHint: boolean;
  noResultsLabel: string;
  /** Uma escolha no seletor de Anfitrião, inclusive a volta ao gravado (UXD-8). */
  onHostPicked: (hostId: string) => void;
  hostAddress: HostAddressUi;
}

const HOST_OUTCOME_TEXT: Readonly<Record<HostAddressOutcome, string>> = {
  full: TEXTS.hostAddress.full,
  partial: TEXTS.hostAddress.partial,
  unavailable: TEXTS.hostAddress.unavailable,
};

/** O aviso do endereço do anfitrião (P61): status, resultado ou falha, e o atalho. */
function HostAddressNotice({ status, outcome, onRetry, onGoToAddress }: HostAddressUi) {
  const showGoTo = status === "idle" && (outcome === "partial" || outcome === "unavailable");
  return (
    <>
      <div id={HOST_NOTICE_ID} role="status" className="text-sm text-foreground empty:hidden">
        {status === "loading" && (
          <p className="flex items-start gap-1.5">
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            <span>{TEXTS.hostAddress.loading}</span>
          </p>
        )}
        {status === "failed" && (
          <p className="flex items-start gap-1.5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            <span>{TEXTS.hostAddress.failed}</span>
          </p>
        )}
        {status === "idle" && outcome && (
          <p className="flex items-start gap-1.5">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{HOST_OUTCOME_TEXT[outcome]}</span>
          </p>
        )}
      </div>
      {status === "failed" && (
        <Button type="button" variant="link" className="min-h-11 h-auto px-0 md:min-h-0" onClick={onRetry}>
          {TEXTS.hostAddress.retry}
        </Button>
      )}
      {showGoTo && (
        <Button type="button" variant="link" className="min-h-11 h-auto px-0 md:min-h-0" onClick={onGoToAddress}>
          {TEXTS.hostAddress.goToAddress}
        </Button>
      )}
    </>
  );
}

/**
 * "Pessoas da célula" (E2.08, T2): Líder, Timóteo e Anfitrião, obrigatórios,
 * sem "✕" de limpar (P64), com as dicas entre o rótulo e o campo e a marca
 * "(inativo)" (P63). Nenhum seletor esconde quem já está em outro papel (RN-03).
 */
export function CellPeopleFieldset({
  ui,
  savedNames,
  statusOf,
  showScopeHint,
  noResultsLabel,
  onHostPicked,
  hostAddress,
}: CellPeopleFieldsetProps) {
  const { control } = useFormContext<CellFormValues>();
  const hostNoticeShown = hostAddress.status !== "idle" || !!hostAddress.outcome;

  const person = (field: PersonField, label: string, placeholder: string, hint: string | null, extra?: ReactNode) => {
    const error = ui.errors[field] ?? null;
    const describedIds = describedBy(
      error && `${field}-error`,
      field === "host_id" && hostNoticeShown && HOST_NOTICE_ID,
      hint && `${field}-hint`,
      showScopeHint && SCOPE_HINT_ID,
    );
    return (
      <div className={FIELD_BLOCK}>
        <Label htmlFor={field}>{label}</Label>
        {hint && <FieldHint id={`${field}-hint`}>{hint}</FieldHint>}
        <Controller
          name={field}
          control={control}
          render={({ field: input }) => (
            <AsyncMemberSelect
              inputId={field}
              focusRef={input.ref}
              value={input.value}
              onChange={(id) => {
                input.onChange(id);
                if (field === "host_id" && id) onHostPicked(id);
              }}
              placeholder={placeholder}
              savedLabel={savedNames[field]}
              noResultsLabel={noResultsLabel}
              isClearable={false}
              aria-required
              aria-invalid={error ? true : undefined}
              aria-describedby={describedIds}
              markInactive
              valueStatus={statusOf(field)}
            />
          )}
        />
        {error && <FieldError id={`${field}-error`}>{error}</FieldError>}
        {extra}
      </div>
    );
  };

  return (
    <fieldset className="min-w-0 space-y-4">
      <legend className={LEGEND}>{TEXTS.groups.people}</legend>
      {showScopeHint && <FieldHint id={SCOPE_HINT_ID}>{SCOPE_TEXTS.peopleHint}</FieldHint>}
      {person("leader_id", TEXTS.labels.leader, TEXTS.placeholders.leader, null)}
      {person("timothy_id", TEXTS.labels.timothy, TEXTS.placeholders.timothy, TEXTS.hints.timothy)}
      {person("host_id", TEXTS.labels.host, TEXTS.placeholders.host, TEXTS.hints.host, <HostAddressNotice {...hostAddress} />)}
    </fieldset>
  );
}
