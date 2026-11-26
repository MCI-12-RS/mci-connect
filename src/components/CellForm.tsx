import { useEffect, useId, useRef, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useCellSave, type CellSaveResult } from "@/hooks/use-cell-save";
import { useCellFormErrors } from "@/hooks/use-cell-form-errors";
import { useHostAddress } from "@/hooks/use-host-address";
import { useMemberStatuses } from "@/hooks/use-member-statuses";
import { CellFormDialog } from "@/components/cells/CellFormDialog";
import { CellPeopleFieldset } from "@/components/cells/CellPeopleFieldset";
import { CellMeetingFieldset } from "@/components/cells/CellMeetingFieldset";
import { CellAddressFieldset } from "@/components/cells/CellAddressFieldset";
import { memberSearchEmptyLabel, peopleLimitedToMinistry } from "@/lib/access/access";
import { prefersReducedMotion } from "@/lib/a11y";
import { changedCellFields, isCellFormDirty } from "@/lib/cells/changes";
import type { CellRow } from "@/lib/cells/fields";
import { cellFormResolver } from "@/lib/cells/form-resolver";
import { applyHostAddress, type HostAddressOutcome } from "@/lib/cells/host-address";
import { saveOutcome, saveOutcomeToast } from "@/lib/cells/situation";
import { CELL_FORM_TEXTS as TEXTS } from "@/lib/cells/texts";
import { CELL_ADDRESS_COLUMNS, EMPTY_CELL_FORM, cellFormFromRow, toCellInsert, type CellFormValues } from "@/lib/cells/write";
import { CELL_DELETION_TEXTS, DELETION_TEXTS } from "@/lib/deletion/texts";
import { SAVE_TEXTS } from "@/lib/hierarchy/texts";
import type { MemberAddress } from "@/lib/members/fields";

interface CellFormProps {
  /** Célula em edição: a linha da cells_view. `null`: "Nova célula". */
  cell: CellRow | null;
  onClose: () => void;
  /** Ao fechar, leva o foco a quem abriu o formulário (`useReturnFocus`). */
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * O formulário de célula (E2.08, T1 a T6): o diálogo responsivo (P1) com os
 * grupos "Pessoas da célula", "Reunião" e "Endereço da célula", a conferência
 * ao salvar (P22) e a gravação (`useCellSave`). A regra fica em
 * `src/lib/cells`, e vale no banco; a tela só a replica.
 */
const CellForm = ({ cell, onClose, onCloseAutoFocus }: CellFormProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { access } = useAuth();
  const isEditing = !!cell;
  const storedActive = cell ? cell.is_active !== false : null;
  const formId = `${useId()}-cell-form`;

  // Os dados entram na montagem (o diálogo monta o formulário a cada abertura):
  // o seletor guarda o valor de abertura para mostrar o nome salvo (DT-23).
  const [opening] = useState<CellFormValues>(() => (cell ? cellFormFromRow(cell) : EMPTY_CELL_FORM));
  // O cadastro novo é idempotente pelo id gerado ao abrir (DT-09).
  const [attemptId] = useState(() => crypto.randomUUID());

  const form = useForm<CellFormValues>({
    defaultValues: opening,
    resolver: cellFormResolver,
    reValidateMode: "onSubmit",
    shouldFocusError: false,
  });
  const errors = useCellFormErrors(form);

  // A marca "(inativo)" de quem está gravado (P63, DA-10).
  const statuses = useMemberStatuses(cell ? [cell.leader_id, cell.timothy_id, cell.host_id] : []);
  const statusOf = (field: "leader_id" | "timothy_id" | "host_id") => {
    const id = cell?.[field];
    if (!id || statuses.isError) return null;
    if (!statuses.data) return undefined;
    return statuses.data.get(id) ?? null;
  };

  // O endereço do anfitrião, a cada escolha (RN-10, P61, UXD-8).
  const [hostOutcome, setHostOutcome] = useState<HostAddressOutcome | null>(null);
  const applyHost = (host: MemberAddress | null) => {
    const current = form.getValues();
    const { address, outcome } = applyHostAddress(current, host);
    for (const column of CELL_ADDRESS_COLUMNS) {
      if (address[column] !== current[column]) form.setValue(column, address[column], { shouldDirty: true });
    }
    setHostOutcome(outcome);
  };
  const hostAddress = useHostAddress(applyHost);
  const addressRef = useRef<HTMLFieldSetElement>(null);
  const goToAddress = () => {
    addressRef.current?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    form.setFocus("zip_code");
  };

  const save = useCellSave();
  const [topMessage, setTopMessage] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const topAlertRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const busy = save.isPending;

  // O `Alert` do topo recebe o foco, e a tela rola até ele (T5).
  useEffect(() => {
    if (!topMessage && !gone) return;
    topAlertRef.current?.focus();
    topAlertRef.current?.scrollIntoView?.({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [topMessage, gone]);

  // Depois de uma falha de envio, o foco volta à ação primária, que serve de "Tentar de novo" (T6).
  useEffect(() => {
    if (failure && !busy) primaryRef.current?.focus();
  }, [failure, busy]);

  const showResult = (result: CellSaveResult) => {
    switch (result.kind) {
      case "saved":
        toast({ title: saveOutcomeToast(result.outcome) });
        onClose();
        return;
      case "gone":
        setGone(true);
        return;
      case "failed": {
        const { failure: cause } = result;
        if (cause.kind === "field") errors.showServerError(cause.field, cause.message);
        else if (cause.kind === "top") setTopMessage(cause.message);
        else setFailure(cause.kind === "recalc" ? SAVE_TEXTS.recalcFailed : TEXTS.connectionFailed);
      }
    }
  };

  const submit = form.handleSubmit(
    async (values) => {
      if (busy) return;
      // O endereço do anfitrião que ainda não chegou não muda o que vai ao servidor.
      hostAddress.cancel();
      setTopMessage(null);
      setFailure(null);
      if (!cell) {
        showResult(await save.save({ kind: "create", insert: { ...toCellInsert(values, attemptId), id: attemptId } }));
        return;
      }
      const patch = changedCellFields(opening, values);
      const outcome = saveOutcome(storedActive, patch);
      // Sem nenhuma mudança, nada vai ao servidor (E2.05, T5).
      if (outcome === "unchanged" || outcome === "created") {
        toast({ title: saveOutcomeToast("unchanged") });
        onClose();
        return;
      }
      showResult(await save.save({ kind: "update", cellId: cell.id, patch, outcome, loadedUpdatedAt: cell.updated_at }));
    },
    () => errors.focusNextError(),
  );

  /** "Fechar" do aviso de célula excluída: volta para a lista, recarregada. */
  const closeGone = () => {
    void queryClient.invalidateQueries({ queryKey: ["cells"] });
    onClose();
  };

  const showScopeHint = peopleLimitedToMinistry(access);
  const errorCount = Object.keys(errors.shown).length;

  return (
    <CellFormDialog
      isEditing={isEditing}
      storedInactive={storedActive === false}
      onClose={onClose}
      onCloseAutoFocus={onCloseAutoFocus}
      actions={{
        formId,
        primaryLabel: isEditing ? TEXTS.buttons.save : TEXTS.buttons.create,
        busyLabel: isEditing ? TEXTS.buttons.saving : TEXTS.buttons.creating,
        busy,
        disabled: gone,
        errorCount,
        failure,
        primaryRef,
        isDirty: () => isCellFormDirty(opening, form.getValues()),
      }}
    >
      <FormProvider {...form}>
        <form id={formId} noValidate onSubmit={submit} className="space-y-6">
          {(topMessage || gone) && (
            <Alert ref={topAlertRef} role="alert" tabIndex={-1} variant="destructive" className="focus:outline-none">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription className="space-y-3 text-foreground">
                {gone ? (
                  <>
                    <p>{CELL_DELETION_TEXTS.deletedWhileEditing}</p>
                    <Button type="button" variant="outline" className="h-11 md:h-9" onClick={closeGone}>
                      {DELETION_TEXTS.close}
                    </Button>
                  </>
                ) : (
                  <p>{topMessage}</p>
                )}
              </AlertDescription>
            </Alert>
          )}

          <p className="text-sm text-muted-foreground">{TEXTS.requiredNote}</p>

          <CellPeopleFieldset
            ui={{ errors: errors.shown }}
            savedNames={{ leader_id: cell?.leader_name, timothy_id: cell?.timothy_name, host_id: cell?.host_name }}
            statusOf={statusOf}
            showScopeHint={showScopeHint}
            noResultsLabel={memberSearchEmptyLabel(access)}
            hostDisabled={busy}
            onHostPicked={(hostId) => {
              setHostOutcome(null);
              void hostAddress.request(hostId);
            }}
            hostAddress={{
              status: hostAddress.status,
              outcome: hostOutcome,
              onRetry: hostAddress.retry,
              onGoToAddress: goToAddress,
            }}
          />

          <CellMeetingFieldset ui={{ errors: errors.shown }} storedActive={storedActive} onTimeBlur={errors.checkTimeOnBlur} />

          <Separator />

          <CellAddressFieldset ref={addressRef} busy={busy} onCepFilled={() => setHostOutcome(null)} />
        </form>
      </FormProvider>
    </CellFormDialog>
  );
};

export default CellForm;
