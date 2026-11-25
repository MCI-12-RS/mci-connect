import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { AlertCircle, Info } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import LongAlertDialogContent, { DIALOG_FOOTER_BUTTON } from "@/components/LongAlertDialogContent";
import ResponsiveDialogContent from "@/components/ResponsiveDialogContent";
import { useToast } from "@/hooks/use-toast";
import { useReloadRoles, useSaveRole } from "@/hooks/use-roles";
import { PERMISSION_CATALOG, PERMISSION_GROUPS, type ActivePermission, type PermissionGroupId } from "@/lib/access/permissions";
import { ACCESS_TEXTS, ROLE_TEXTS } from "@/lib/access/texts";
import {
  buildSaveRoleArgs,
  classifyRoleWriteError,
  defaultSwitchWarning,
  initialRoleFormValues,
  isRoleFormDirty,
  roleNameError,
  saveSuccessText,
  togglePermission,
  type Role,
  type RoleFormValues,
} from "@/lib/roles/roles";
import { cn } from "@/lib/utils";

/** Grupos da coluna da esquerda a partir de `lg` (T3); os demais vão para a direita. */
const LEFT_COLUMN: ReadonlySet<PermissionGroupId> = new Set<PermissionGroupId>(["visibility", "members"]);

const PERMISSION_INFO = new Map(PERMISSION_CATALOG.map((info) => [info.value, info]));

interface PermissionRowProps {
  idPrefix: string;
  permission: ActivePermission;
  checked: boolean;
  disabled: boolean;
  onChange: (permission: ActivePermission, checked: boolean) => void;
}

/** Uma permissão (P14): a linha inteira é clicável, com 44 px no celular e a dica ligada ao checkbox. */
const PermissionRow = ({ idPrefix, permission, checked, disabled, onChange }: PermissionRowProps) => {
  const info = PERMISSION_INFO.get(permission);
  if (!info) return null;
  const id = `${idPrefix}-${permission}`;
  const hintId = `${id}-hint`;
  return (
    <div className="relative flex min-h-11 items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50 md:min-h-0">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(permission, value === true)}
        aria-describedby={info.hint ? hintId : undefined}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        {/* O `after` estende o clique do rótulo à linha inteira, inclusive à dica. */}
        <Label htmlFor={id} className="cursor-pointer break-words font-normal leading-snug after:absolute after:inset-0">
          {info.label}
        </Label>
        {info.hint && (
          <p id={hintId} className="mt-0.5 break-words text-xs text-muted-foreground">
            {info.hint}
          </p>
        )}
      </div>
    </div>
  );
};

export interface RoleFormProps {
  /** A função editada, ou `null` para uma nova. */
  role: Role | null;
  /** As funções da lista, para o aviso de troca da padrão. */
  roles: readonly Role[];
  /** Fim do fluxo: gravou, descartou ou fechou sem alterações. */
  onClose: () => void;
  /** Ao fechar, leva o foco a quem abriu o formulário (`useReturnFocus`). */
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * Formulário de função (E2.02, T3): diálogo responsivo (P1), permissões em
 * grupos (P14), o interruptor "Função padrão" (travado na padrão, com o aviso
 * de troca nas demais) e a gravação numa chamada só (`save_role`). Monte com
 * `key`: cada abertura começa do zero.
 */
const RoleForm = ({ role, roles, onClose, onCloseAutoFocus }: RoleFormProps) => {
  const { toast } = useToast();
  const save = useSaveRole();
  const reload = useReloadRoles();
  const idPrefix = useId();
  const formId = `${idPrefix}-form`;
  const nameId = `${idPrefix}-name`;
  const nameErrorId = `${idPrefix}-name-error`;
  const descriptionId = `${idPrefix}-description`;
  const defaultId = `${idPrefix}-default`;
  const defaultHintId = `${idPrefix}-default-hint`;

  const [initial] = useState<RoleFormValues>(() => initialRoleFormValues(role));
  const [values, setValues] = useState<RoleFormValues>(initial);
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const formErrorRef = useRef<HTMLDivElement>(null);

  const saving = save.isPending;
  const defaultLocked = role?.isDefault === true;
  const warning = defaultSwitchWarning(role, values.isDefault, roles);

  // A recusa entra na tela e recebe o foco (T11, UX-22).
  useEffect(() => {
    if (!formError) return;
    formErrorRef.current?.scrollIntoView?.({ block: "nearest" });
    formErrorRef.current?.focus();
  }, [formError]);

  const showNameError = (message: string) => {
    setNameError(message);
    nameRef.current?.focus();
  };

  const requestClose = () => {
    if (saving) return;
    if (isRoleFormDirty(initial, values)) setConfirmDiscard(true);
    else onClose();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const localNameError = roleNameError(values.name);
    if (localNameError) {
      showNameError(localNameError);
      return;
    }
    setNameError(null);
    setFormError(null);
    try {
      await save.mutateAsync(buildSaveRoleArgs(role, values));
    } catch (error) {
      const failure = classifyRoleWriteError(error);
      switch (failure.kind) {
        case "forbidden":
          toast({ variant: "destructive", title: ACCESS_TEXTS.permissionDenied });
          onClose();
          return;
        case "gone":
          toast({ title: failure.message });
          void reload();
          onClose();
          return;
        case "protected":
          toast({ variant: "destructive", title: failure.message });
          onClose();
          return;
        case "name":
          showNameError(failure.message);
          return;
        case "refused":
          setFormError(failure.message);
          return;
        case "network":
          setFormError(ROLE_TEXTS.saveNetworkError);
          return;
        case "unexpected":
          setFormError(ROLE_TEXTS.saveFailed);
          return;
      }
    }
    toast({ title: saveSuccessText(role, values) });
    onClose();
  };

  const setPermission = (permission: ActivePermission, checked: boolean) =>
    setValues((current) => ({ ...current, permissions: togglePermission(current.permissions, permission, checked) }));

  const marked = new Set<ActivePermission>(values.permissions);
  const renderGroup = (group: (typeof PERMISSION_GROUPS)[number]) => (
    <fieldset key={group.id} className="min-w-0 space-y-1">
      <legend className="mb-1 text-sm font-semibold">{group.label}</legend>
      {group.permissions.map((permission) => (
        <PermissionRow
          key={permission}
          idPrefix={idPrefix}
          permission={permission}
          checked={marked.has(permission)}
          disabled={saving}
          onChange={setPermission}
        />
      ))}
    </fieldset>
  );

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <ResponsiveDialogContent
          title={role ? ROLE_TEXTS.editRole : ROLE_TEXTS.newRole}
          closeLabel={ROLE_TEXTS.close}
          aria-describedby={undefined}
          onCloseAutoFocus={onCloseAutoFocus}
          footer={
            <>
              <Button type="button" variant="outline" className="min-h-11 flex-1 md:min-h-10 md:flex-none" disabled={saving} onClick={requestClose}>
                {ROLE_TEXTS.cancel}
              </Button>
              <Button type="submit" form={formId} className="min-h-11 flex-1 md:min-h-10 md:flex-none" disabled={saving}>
                {saving ? ROLE_TEXTS.saving : role ? ROLE_TEXTS.save : ROLE_TEXTS.create}
              </Button>
            </>
          }
        >
          <form id={formId} noValidate onSubmit={handleSubmit} className="space-y-6">
            {formError && (
              <Alert ref={formErrorRef} variant="destructive" tabIndex={-1} className="focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                <AlertDescription className="text-foreground">{formError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor={nameId}>{ROLE_TEXTS.nameLabel}</Label>
                <Input
                  ref={nameRef}
                  id={nameId}
                  value={values.name}
                  disabled={saving}
                  aria-invalid={nameError ? true : undefined}
                  aria-describedby={nameError ? nameErrorId : undefined}
                  onChange={(event) => {
                    const name = event.target.value;
                    setValues((current) => ({ ...current, name }));
                    if (nameError) setNameError(null);
                  }}
                />
                {nameError && (
                  <p id={nameErrorId} className="flex items-start gap-1.5 text-sm font-medium text-foreground">
                    <AlertCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                    {nameError}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor={descriptionId}>{ROLE_TEXTS.descriptionLabel}</Label>
                <Input
                  id={descriptionId}
                  value={values.description}
                  disabled={saving}
                  onChange={(event) => {
                    const description = event.target.value;
                    setValues((current) => ({ ...current, description }));
                  }}
                />
              </div>
            </div>

            <section className="space-y-4" aria-labelledby={`${idPrefix}-permissions`}>
              <div className="space-y-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 id={`${idPrefix}-permissions`} className="text-base font-semibold">
                    {ROLE_TEXTS.permissionsLabel}
                  </h3>
                  <span className="text-sm text-muted-foreground" aria-live="polite">
                    {ROLE_TEXTS.checkedCount(values.permissions.length)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{ROLE_TEXTS.scopeNote}</p>
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="min-w-0 space-y-6">
                  {PERMISSION_GROUPS.filter((group) => LEFT_COLUMN.has(group.id)).map(renderGroup)}
                </div>
                <div className="min-w-0 space-y-6">
                  {PERMISSION_GROUPS.filter((group) => !LEFT_COLUMN.has(group.id)).map(renderGroup)}
                </div>
              </div>
            </section>

            <div className="space-y-3 rounded-md border p-3">
              {/* O `after` do rótulo cobre só esta linha (alvo de toque ≥ 44 px, como P14), nunca o aviso abaixo. */}
              <div className="relative flex min-h-11 items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <Label htmlFor={defaultId} className={cn("after:absolute after:inset-0", !defaultLocked && "cursor-pointer")}>
                    {ROLE_TEXTS.defaultLabel}
                  </Label>
                  <p id={defaultHintId} className="break-words text-sm text-muted-foreground">
                    {defaultLocked ? ROLE_TEXTS.defaultLocked : ROLE_TEXTS.defaultHint}
                  </p>
                </div>
                <Switch
                  id={defaultId}
                  checked={values.isDefault}
                  disabled={defaultLocked || saving}
                  aria-describedby={defaultHintId}
                  className="relative z-10"
                  onCheckedChange={(isDefault) => setValues((current) => ({ ...current, isDefault }))}
                />
              </div>
              {warning && (
                <Alert role="status">
                  <Info className="h-4 w-4" aria-hidden="true" />
                  <AlertDescription>{warning}</AlertDescription>
                </Alert>
              )}
            </div>
          </form>
        </ResponsiveDialogContent>
      </Dialog>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <LongAlertDialogContent aria-describedby={undefined}>
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle>{ROLE_TEXTS.discardTitle}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className={cn(DIALOG_FOOTER_BUTTON, "mt-0")}>{ROLE_TEXTS.keepEditing}</AlertDialogCancel>
            <AlertDialogAction className={DIALOG_FOOTER_BUTTON} onClick={onClose}>
              {ROLE_TEXTS.discard}
            </AlertDialogAction>
          </AlertDialogFooter>
        </LongAlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default RoleForm;
