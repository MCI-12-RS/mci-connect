import { useEffect, useId, useRef, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useRoleOptions } from "@/hooks/use-role-options";
import { useMemberSave } from "@/hooks/use-member-save";
import { useMemberFormErrors } from "@/hooks/use-member-form-errors";
import DeletedMatchesDialog, { type RestoredFromWarning } from "@/components/DeletedMatchesDialog";
import { MemberFormDialog } from "@/components/members/MemberFormDialog";
import { MemberPersonalSection } from "@/components/members/MemberPersonalSection";
import { MemberMinistrySection } from "@/components/members/MemberMinistrySection";
import { MemberAddressSection } from "@/components/members/MemberAddressSection";
import { MemberAccessSection, type MemberPasswordRowProps } from "@/components/members/MemberAccessSection";
import type { ResetPasswordOutcome } from "@/components/members/ResetPasswordDialog";
import { refreshAccess } from "@/hooks/use-access";
import { nextStepForRefusal } from "@/lib/auth/temporary-password";
import { passwordRowView } from "@/lib/members/password-row";
import { memberSearchEmptyLabel } from "@/lib/access/access";
import { MEMBER_FORM_TEXTS, OWN_DATA_TEXTS } from "@/lib/access/texts";
import {
  initialLeaderId,
  memberSaveFailureMessage,
  ministryFieldsView,
  needsRoleOptions,
  roleFieldView,
} from "@/lib/access/member-form";
import { spToday } from "@/lib/dates/sao-paulo";
import { DELETED_MATCHES_TEXTS, DELETION_TEXTS, MEMBER_DELETION_TEXTS } from "@/lib/deletion/texts";
import { memberRestoreNotices } from "@/lib/deletion/restore";
import { changedMemberFields } from "@/lib/members/changes";
import { deletedMatchesWarning, type DeletedMatchesDialogModel } from "@/lib/members/deleted-matches";
import { toMemberWritePayload, type MemberRow } from "@/lib/members/fields";
import { refusalFieldsShown, shownErrorCount } from "@/lib/members/form-errors";
import { effectiveRoleId, memberFormResolver, type MemberFormContext } from "@/lib/members/form-resolver";
import {
  initialMemberFormFields,
  isMemberFormDirty,
  memberWriteValues,
  storedMemberValues,
  storedRuleValues,
  switchFields,
  switchesOf,
  type MemberFormFields,
} from "@/lib/members/form-values";
import { setLeader } from "@/lib/members/leadership";
import { MEMBER_FORM_LAYOUT_TEXTS as TEXTS } from "@/lib/members/texts";
import { legacyWarnings, visibleLegacyWarnings } from "@/lib/members/validation";
import type { MemberSaveResult } from "@/hooks/use-member-save";

interface MemberFormProps {
  member: MemberRow | null;
  onClose: () => void;
  /** Ao fechar, leva o foco a quem abriu o formulário (`useReturnFocus`). */
  onCloseAutoFocus?: (event: Event) => void;
  /** O título; sem ele, "Novo membro" ou "Editar membro" (T1). */
  title?: string;
  /**
   * "Definir líder" depois de restaurar um cadastro sem líder (E2.01, T5 e
   * UX-22): abre com "Tem Liderança?" ligado e o foco no campo Líder.
   */
  defineLeader?: boolean;
  /** Cadastro novo com dados de um excluído (E2.01, RN-18): restaurado pelo aviso, a tela passa a editá-lo (UX-32). */
  onRestored?: (restored: RestoredFromWarning) => void;
  /** Aberto logo depois de restaurar pelo aviso: o `Alert` de restauração, com o foco (UX-32). */
  restoredFrom?: RestoredFromWarning;
  /** "Meus dados" só para leitura (E2.02, UXD-13): campos `readOnly`, sem avisos e só "Fechar". */
  readOnly?: boolean;
}

/**
 * O formulário de membro (E2.04, T1 a T7): o diálogo, as seções, a
 * conferência ao salvar e a gravação. A regra fica em `src/lib/members`, e a
 * gravação, no `useMemberSave`.
 */
const MemberForm = ({
  member,
  onClose,
  onCloseAutoFocus,
  title,
  defineLeader = false,
  onRestored,
  restoredFrom,
  readOnly = false,
}: MemberFormProps) => {
  const { toast } = useToast();
  const { hasPermission, access, member: ownMember, user } = useAuth();
  const queryClient = useQueryClient();
  const isEditing = !!member;
  const formId = `${useId()}-member-form`;

  // Na edição, a members_view diz se os dados sensíveis deste membro estão
  // visíveis; no cadastro, quem tem create_member preenche todos (E1.08).
  const sensitiveVisible = !isEditing || member.sensitive_visible === true;
  const canEditMinistry = !readOnly && hasPermission(isEditing ? "edit_member" : "create_member");
  const isAdmin = hasPermission("manage_roles");
  const seesWholeChurch = access?.sees_whole_church === true;

  const restoredNotices = restoredFrom ? memberRestoreNotices(restoredFrom.outcome) : null;
  const focusLeader = defineLeader || (restoredNotices?.withoutLeader === true && canEditMinistry);

  // Campo Função (E2.02, RN-18, UXD-12): nunca a `role_id` da linha do membro.
  const isSelf = isEditing && !!access?.member_id && member.id === access.member_id;
  const roleInput = {
    isNew: !isEditing,
    isSelf: readOnly || isSelf,
    canAssignRoles: !readOnly && access?.can_assign_roles === true,
    ownRoleName: access?.role_name ?? null,
  };
  const roleOptions = useRoleOptions(member?.id ?? null, { enabled: !readOnly && needsRoleOptions(roleInput) });
  const roleView = roleFieldView({ ...roleInput, options: roleOptions.data });
  // O cadastro novo espera as opções: sem elas, quem atribui funções criaria o membro sem função.
  const awaitingRoleOptions = !isEditing && roleView.kind === "pending" && !roleOptions.isError;

  const ministryView = ministryFieldsView({ seesWholeChurch, isNew: !isEditing, saved: member });
  const [today] = useState(() => spToday());

  // Os dados entram na montagem (o diálogo monta o formulário a cada abertura).
  const prefillLeaderId = !isEditing && canEditMinistry ? initialLeaderId(ministryView, true, access?.member_id ?? null) : null;
  const [initialFields] = useState(() =>
    initialMemberFormFields(member, {
      prefilledLeader: prefillLeaderId ? { id: prefillLeaderId, name: ownMember?.name ?? "" } : null,
      defineLeader: focusLeader,
    }),
  );
  // A referência do "algo mudou?" (UX-26): a abertura, com o Líder preenchido depois, se o acesso chegou tarde.
  const openingFields = useRef(initialFields);

  const context: MemberFormContext = {
    validation: {
      stored: member ? storedRuleValues(member) : null,
      memberId: member?.id ?? null,
      today,
      sensitiveVisible,
      canEditMinistry,
      seesWholeChurch,
      leaderAlwaysRequired: ministryView.leader === "required",
    },
    view: ministryView,
    role: { required: roleView.kind === "select", initial: roleView.kind === "select" ? roleView.initialValue : null },
    initialPassword: !isEditing,
  };
  const form = useForm<MemberFormFields, MemberFormContext>({
    defaultValues: initialFields,
    resolver: memberFormResolver,
    context,
    reValidateMode: "onSubmit",
    shouldFocusError: false,
  });
  const errors = useMemberFormErrors(form, context);
  const values = form.watch();

  // O acesso chegou depois de o cadastro novo abrir (E2.02, AQ-1): preenche o Líder uma vez, se ainda vazio.
  const leaderPrefilled = useRef(!!initialFields.leader_id);
  useEffect(() => {
    if (leaderPrefilled.current || !prefillLeaderId) return;
    leaderPrefilled.current = true;
    if (form.getValues("leader_id")) return;
    const next = switchFields(setLeader(switchesOf(form.getValues()), { id: prefillLeaderId, name: ownMember?.name ?? "" }));
    const prefilled = { leader_id: next.leader_id, leader_name: next.leader_name, has_leadership: next.has_leadership };
    form.setValue("leader_id", prefilled.leader_id);
    form.setValue("leader_name", prefilled.leader_name);
    form.setValue("has_leadership", prefilled.has_leadership);
    openingFields.current = { ...openingFields.current, ...prefilled };
  }, [prefillLeaderId, ownMember?.name, form]);

  // "Definir líder": o foco vai para o Líder; restaurado pelo aviso, para o `Alert` (E2.01, UX-22 e UX-32).
  const restoredAlertRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = (event: Event) => {
    if (focusLeader) {
      event.preventDefault();
      form.setFocus("leader_id");
    } else if (restoredFrom) {
      event.preventDefault();
      restoredAlertRef.current?.focus();
    }
  };

  // Avisos de dado antigo (T6, P24): pelo gravado, enquanto a pessoa não mexe no campo.
  const [storedWarnings] = useState(() =>
    member ? legacyWarnings(storedRuleValues(member), { sensitiveVisible, readOnly, today }) : {},
  );
  const warnings = member ? visibleLegacyWarnings(storedWarnings, storedRuleValues(member), values) : {};

  const save = useMemberSave();
  // Identifica o cadastro na `create-user-admin` (DT-11): um por abertura, o mesmo em cada nova tentativa.
  const [attemptId] = useState(() => crypto.randomUUID());
  const [topMessage, setTopMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [deletedWhileEditing, setDeletedWhileEditing] = useState(false);
  const [deletedMatches, setDeletedMatches] = useState<DeletedMatchesDialogModel | null>(null);
  // A recusa da redefinição nesta abertura vira o texto da linha "Senha" (E2.03, T6).
  const [passwordRefusal, setPasswordRefusal] = useState<"no_account" | "role_not_covered" | null>(null);
  const topAlertRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!topMessage && !deletedWhileEditing) return;
    topAlertRef.current?.focus();
    topAlertRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [topMessage, deletedWhileEditing]);

  const writeOptions = { sensitiveVisible, canEditMinistry, includeRole: roleView.kind === "select" };
  const visibility = {
    sensitiveVisible,
    canEditMinistry,
    pastorSwitch: ministryView.pastor === "switch",
    leaderShown:
      ministryView.leadership === "switch" ? values.has_leadership && !values.is_pastor : ministryView.leader !== "hidden",
    baptismDateShown: values.is_baptized,
    roleSelect: roleView.kind === "select",
  };

  const showResult = (result: MemberSaveResult) => {
    switch (result.kind) {
      case "saved":
        toast({ title: isEditing ? TEXTS.updated : TEXTS.created });
        onClose();
        return;
      case "unchanged":
        onClose();
        return;
      case "gate":
        // O portão leva à troca de senha ou ao login; o formulário sai junto.
        return;
      case "gone":
        setDeletedWhileEditing(true);
        return;
      case "deletedMatches": {
        const warning = deletedMatchesWarning(result.matches, { isAdmin, accountEmail: result.accountEmail });
        if (warning.kind === "dialog") {
          setDeletedMatches(warning.dialog);
        } else {
          setDeletedMatches(null);
          // Depois do foco que o Radix devolve ao fechar o aviso, se ele estava aberto.
          window.setTimeout(() => errors.showServerErrors({ email: warning.message }), 0);
        }
        return;
      }
      case "refused": {
        const shown = refusalFieldsShown(result.refusal.fields, visibility);
        if (Object.keys(shown).length > 0) errors.showServerErrors(shown);
        else setTopMessage(result.refusal.message);
        return;
      }
      case "failed":
        setFailure(memberSaveFailureMessage(result.cause));
    }
  };

  const send = async (fields: MemberFormFields, confirmDeletedMatches: boolean) => {
    setTopMessage(null);
    setFailure(null);
    const writeValues = memberWriteValues(fields, ministryView, effectiveRoleId(fields, context.role));
    const result = await save.save(
      member
        ? { kind: "update", memberId: member.id, patch: changedMemberFields(storedMemberValues(member, context.role.initial), writeValues, writeOptions) }
        : {
            kind: "create",
            attemptId,
            // Sem senha, a inicial é 123456 (D11).
            password: fields.password || "123456",
            memberData: toMemberWritePayload(writeValues, writeOptions),
            confirmDeletedMatches,
          },
    );
    if (result) showResult(result);
  };

  const submit = form.handleSubmit(
    (fields) => send(fields, false),
    () => errors.focusFirstError(),
  );

  /** "Restaurar {Nome}": a tela passa a editar o cadastro restaurado (UX-32). */
  const handleRestored = (restored: RestoredFromWarning) => {
    setDeletedMatches(null);
    if (onRestored) onRestored(restored);
    else onClose();
  };

  const ui = { readOnly, errors: errors.shown, warnings, onBlurCheck: errors.checkOnBlur };

  // A linha "Senha" da edição (E2.03, T5): o próprio cadastro troca; o de outra pessoa, pela `password_reset_status`.
  const isOwnRecord = isEditing && (readOnly || isSelf || (!!user && member.auth_user_id === user.id));
  const passwordView = isEditing
    ? passwordRowView({
        isSelf: isOwnRecord,
        accessLoaded: access !== null,
        canReset: hasPermission("change_member_password"),
        status: member.password_reset_status,
        hasAccount: !!member.auth_user_id,
        refusal: passwordRefusal,
      })
    : null;

  /** Depois de uma recusa da redefinição (T6): fecha o cadastro, relê o acesso ou mostra o texto. */
  const handleResetOutcome = (outcome: ResetPasswordOutcome) => {
    if (outcome.kind !== "refused") return;
    switch (nextStepForRefusal(outcome.code)) {
      case "close_record":
        onClose();
        return;
      case "reread_access":
        void refreshAccess(queryClient);
        return;
      case "show_text":
        if (outcome.code === "no_account" || outcome.code === "role_not_covered") setPasswordRefusal(outcome.code);
    }
  };

  const passwordRow: MemberPasswordRowProps | null =
    member && passwordView && passwordView.kind !== "hidden"
      ? { view: passwordView, member: { id: member.id, name: member.name, gender: member.gender }, onResetOutcome: handleResetOutcome }
      : null;
  const busy = save.isPending;

  // Depois de uma falha de envio, o foco volta à ação primária, que serve de "Tentar de novo" (T7).
  useEffect(() => {
    if (failure && !busy) primaryRef.current?.focus();
  }, [failure, busy]);
  const dialogTitle = title ?? (isEditing ? TEXTS.titles.edit : TEXTS.titles.create);

  return (
    <MemberFormDialog
      title={dialogTitle}
      onClose={onClose}
      onOpenAutoFocus={focusOnOpen}
      onCloseAutoFocus={onCloseAutoFocus}
      actions={
        readOnly
          ? undefined
          : {
              formId,
              primaryLabel: awaitingRoleOptions ? MEMBER_FORM_TEXTS.createMemberLoading : isEditing ? TEXTS.buttons.save : TEXTS.buttons.create,
              busyLabel: isEditing ? TEXTS.buttons.saving : TEXTS.buttons.creating,
              busy,
              disabled: deletedWhileEditing || awaitingRoleOptions,
              errorCount: shownErrorCount(errors.shown),
              failure,
              primaryRef,
              isDirty: () => isMemberFormDirty(openingFields.current, form.getValues(), ministryView, writeOptions),
            }
      }
    >
      <FormProvider {...form}>
        <form id={formId} noValidate onSubmit={readOnly ? (event) => event.preventDefault() : submit} className="space-y-6">
          {readOnly ? (
            <Alert>
              <Info className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{OWN_DATA_TEXTS.readOnlyNotice}</AlertDescription>
            </Alert>
          ) : (
            <p className="text-sm text-muted-foreground">{TEXTS.requiredNote}</p>
          )}
          {restoredFrom && (
            <Alert ref={restoredAlertRef} role="status" tabIndex={-1} className="focus:outline-none">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              <AlertDescription className="space-y-2">
                <p>{DELETED_MATCHES_TEXTS.restoredFromForm(restoredFrom.name)}</p>
                {restoredNotices?.messages.map((message) => <p key={message}>{message}</p>)}
              </AlertDescription>
            </Alert>
          )}
          {(topMessage || deletedWhileEditing) && (
            <Alert ref={topAlertRef} role="alert" tabIndex={-1} variant="destructive" className="focus:outline-none">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription className="space-y-3 text-foreground">
                {deletedWhileEditing ? (
                  <>
                    <p>{MEMBER_DELETION_TEXTS.deletedWhileEditing}</p>
                    <Button type="button" variant="outline" className="h-11 md:h-9" onClick={onClose}>
                      {DELETION_TEXTS.close}
                    </Button>
                  </>
                ) : (
                  <p>{topMessage}</p>
                )}
              </AlertDescription>
            </Alert>
          )}

          <MemberPersonalSection
            ui={ui}
            today={today}
            sensitiveVisible={sensitiveVisible}
            spouse={
              canEditMinistry
                ? {
                    memberId: member?.id,
                    savedLabel: member?.spouse_name,
                    noResultsLabel: memberSearchEmptyLabel(access),
                    hint: ministryView.spouseHint,
                  }
                : null
            }
          />

          {canEditMinistry && (
            <>
              <Separator />
              <MemberMinistrySection ui={ui} view={ministryView} memberId={member?.id} noResultsLabel={memberSearchEmptyLabel(access)} />
            </>
          )}

          {sensitiveVisible && (
            <>
              <Separator />
              <MemberAddressSection readOnly={readOnly} />
            </>
          )}

          {/* Acesso: some sem Função (UXD-12) e sem a linha "Senha" (E2.03, T5); no cadastro novo, a senha inicial. */}
          {(roleView.kind !== "hidden" || !isEditing || passwordRow) && (
            <>
              <Separator />
              <MemberAccessSection
                ui={ui}
                roleView={roleView}
                roleLoadFailed={roleOptions.isError}
                isNew={!isEditing}
                passwordRow={passwordRow}
                onPasswordBlur={errors.checkPasswordOnBlur}
              />
            </>
          )}
        </form>
      </FormProvider>

      {deletedMatches && (
        <DeletedMatchesDialog
          dialog={deletedMatches}
          registering={busy}
          onRegisterAnyway={() => void send(form.getValues(), true)}
          onClose={() => setDeletedMatches(null)}
          onRestored={handleRestored}
        />
      )}
    </MemberFormDialog>
  );
};

export default MemberForm;
