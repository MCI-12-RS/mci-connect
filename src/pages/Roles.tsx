import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import { AlertCircle, ChevronDown, Lock, Pencil, Plus, Star, Trash2 } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import RowActionsMenu from "@/components/RowActionsMenu";
import StatusBadge from "@/components/StatusBadge";
import RoleForm from "@/components/roles/RoleForm";
import RoleDeleteFlow from "@/components/roles/RoleDeleteFlow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useMobileState } from "@/hooks/use-mobile";
import { useReturnFocus } from "@/hooks/use-return-focus";
import { useRoles } from "@/hooks/use-roles";
import { permissionLabel } from "@/lib/access/permissions";
import { ROLE_TEXTS } from "@/lib/access/texts";
import { groupRolePermissions, roleCountsLine, type Role } from "@/lib/roles/roles";

type RolesDialog = { kind: "form"; role: Role | null } | { kind: "delete"; role: Role };

interface RoleActions {
  canManage: boolean;
  onEdit: (role: Role, opener: HTMLElement | null) => void;
  onDelete: (role: Role, opener: HTMLElement | null) => void;
}

const RoleName = ({ role }: { role: Role }) => (
  <span className="flex flex-wrap items-center gap-2">
    <span className="break-words font-semibold">{role.name}</span>
    {role.isProtected && <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
    {role.isDefault && (
      <StatusBadge tone="warning" icon={Star}>
        {ROLE_TEXTS.defaultBadge}
      </StatusBadge>
    )}
  </span>
);

/** O que fica no lugar das permissões: a frase da Administrador ou a de função sem permissões (T2). */
function permissionsPlaceholder(role: Role): string | null {
  if (role.isProtected) return ROLE_TEXTS.adminDescription;
  if (role.permissions.length === 0) return ROLE_TEXTS.noPermissions;
  return null;
}

/** O chip de uma permissão (card e tabela): `bg-muted` com `text-foreground` para o contraste (UX-29). */
const PermissionChip = ({ children }: { children: ReactNode }) => (
  <Badge variant="outline" className="whitespace-normal break-words bg-muted font-normal text-foreground">
    {children}
  </Badge>
);

/** "Ver permissões" do card (T2): as permissões nos grupos da T3. */
const RolePermissionsCollapsible = ({ role }: { role: Role }) => {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleContent className="space-y-3 pb-3">
        {groupRolePermissions(role.permissions).map((group) => (
          <div key={group.id} className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{group.label}</p>
            <div className="flex flex-wrap gap-1.5">
              {group.permissions.map((permission) => (
                <PermissionChip key={permission.value}>{permission.label}</PermissionChip>
              ))}
            </div>
          </div>
        ))}
      </CollapsibleContent>
      <CollapsibleTrigger asChild>
        <Button variant="outline" className="h-11 w-full justify-between">
          {open ? ROLE_TEXTS.hidePermissions : ROLE_TEXTS.showPermissions}
          <ChevronDown
            className={`h-4 w-4 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </Button>
      </CollapsibleTrigger>
    </Collapsible>
  );
};

/** Card de uma função no celular (T2). */
const RoleCard = ({ role, canManage, onEdit, onDelete }: RoleActions & { role: Role }) => {
  const placeholder = permissionsPlaceholder(role);
  const counts = roleCountsLine(role);
  const hasActions = canManage && !role.isProtected;
  return (
    <li className="space-y-3 px-4 py-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <RoleName role={role} />
          {role.description && <p className="break-words text-sm text-muted-foreground">{role.description}</p>}
        </div>
        {hasActions && (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11"
              aria-label={ROLE_TEXTS.editLabel(role.name)}
              onClick={(event: MouseEvent<HTMLButtonElement>) => onEdit(role, event.currentTarget)}
            >
              <Pencil className="h-5 w-5" aria-hidden="true" />
            </Button>
            <RowActionsMenu
              label={ROLE_TEXTS.actionsLabel(role.name)}
              actions={[{ label: ROLE_TEXTS.deleteAction, icon: Trash2, onSelect: (trigger) => onDelete(role, trigger) }]}
            />
          </div>
        )}
      </div>
      {placeholder && <p className="break-words text-sm">{placeholder}</p>}
      {counts && <p className="text-sm text-muted-foreground">{counts}</p>}
      {!placeholder && <RolePermissionsCollapsible role={role} />}
    </li>
  );
};

/** Linha de uma função na tabela (desktop, T2). */
const RoleRow = ({ role, canManage, onEdit, onDelete }: RoleActions & { role: Role }) => {
  const placeholder = permissionsPlaceholder(role);
  return (
    <TableRow>
      <TableCell className="align-top">
        <RoleName role={role} />
      </TableCell>
      <TableCell className="align-top text-sm text-muted-foreground">{role.description}</TableCell>
      <TableCell className="align-top">
        {placeholder ? (
          <p className="text-sm">{placeholder}</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {role.permissions.map((permission) => (
              <PermissionChip key={permission}>{permissionLabel(permission)}</PermissionChip>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell className="align-top tabular-nums">{role.membersCount ?? ""}</TableCell>
      {canManage && (
        <TableCell className="align-top">
          {!role.isProtected && (
            <div className="flex items-center justify-end gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label={ROLE_TEXTS.editLabel(role.name)}
                onClick={(event: MouseEvent<HTMLButtonElement>) => onEdit(role, event.currentTarget)}
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground"
                aria-label={ROLE_TEXTS.deleteLabel(role.name)}
                onClick={(event: MouseEvent<HTMLButtonElement>) => onDelete(role, event.currentTarget)}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          )}
        </TableCell>
      )}
    </TableRow>
  );
};

const LoadingSkeleton = ({ isMobile }: { isMobile: boolean | undefined }) => (
  <div className="space-y-4 p-4" aria-busy="true">
    {[0, 1, 2].map((index) => (
      <div key={index} className="space-y-2">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
        {isMobile !== false && <Skeleton className="h-11 w-full" />}
      </div>
    ))}
  </div>
);

/**
 * Funções (E2.02, T2 a T4): a lista vem da `roles_view` (Administrador
 * primeiro, contagens, badge "Padrão"); cards no celular e tabela a partir de
 * 768 px. As ações ficam só com "Gerenciar Funções", e a Administrador nunca
 * as tem (RN-17, P12). A rota sem permissão é tratada antes, no `RouteAccess`.
 */
const Roles = () => {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("manage_roles");
  const isMobile = useMobileState();
  const { data: roles, isLoading, isError, refetch, isRefetching } = useRoles();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const returnFocus = useReturnFocus(headingRef, roles);
  const [dialog, setDialog] = useState<RolesDialog | null>(null);
  const [dialogKey, setDialogKey] = useState(0);

  const openDialog = (next: RolesDialog, opener: HTMLElement | null) => {
    returnFocus.setOpener(opener);
    setDialogKey((key) => key + 1);
    setDialog(next);
  };
  const closeDialog = () => setDialog(null);

  const actions: RoleActions = {
    canManage,
    onEdit: (role, opener) => openDialog({ kind: "form", role }, opener),
    onDelete: (role, opener) => openDialog({ kind: "delete", role }, opener),
  };

  const renderList = () => {
    if (isLoading || isMobile === undefined) return <LoadingSkeleton isMobile={isMobile} />;
    if (!roles) {
      if (!isError) return null;
      return (
        <div className="p-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription className="space-y-3 text-foreground">
              <p>{ROLE_TEXTS.loadFailed}</p>
              <Button variant="outline" className="min-h-11 md:min-h-10" disabled={isRefetching} onClick={() => void refetch()}>
                {ROLE_TEXTS.tryAgain}
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      );
    }
    if (isMobile) {
      return (
        <ul className="divide-y divide-border">
          {roles.map((role) => (
            <RoleCard key={role.id} role={role} {...actions} />
          ))}
        </ul>
      );
    }
    return (
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{ROLE_TEXTS.columns.role}</TableHead>
              <TableHead>{ROLE_TEXTS.columns.description}</TableHead>
              <TableHead>{ROLE_TEXTS.columns.permissions}</TableHead>
              <TableHead>{ROLE_TEXTS.columns.members}</TableHead>
              {canManage && (
                <TableHead className="w-24">
                  <span className="sr-only">{ROLE_TEXTS.columns.actions}</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((role) => (
              <RoleRow key={role.id} role={role} {...actions} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    );
  };

  return (
    <AppLayout>
      <div className="animate-fade-in space-y-6 motion-reduce:animate-none">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold focus:outline-none md:text-3xl">
              {ROLE_TEXTS.title}
            </h1>
            <p className="text-sm text-muted-foreground">{ROLE_TEXTS.subtitle}</p>
          </div>
          {canManage && (
            <Button
              className="h-11 w-full sm:w-auto md:h-10"
              onClick={(event: MouseEvent<HTMLButtonElement>) => openDialog({ kind: "form", role: null }, event.currentTarget)}
            >
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              {ROLE_TEXTS.newRole}
            </Button>
          )}
        </div>

        <Card>{renderList()}</Card>

        {dialog?.kind === "form" && (
          <RoleForm
            key={dialogKey}
            role={dialog.role}
            roles={roles ?? []}
            onClose={closeDialog}
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          />
        )}
        {dialog?.kind === "delete" && (
          <RoleDeleteFlow
            key={dialogKey}
            role={dialog.role}
            onClose={closeDialog}
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          />
        )}
      </div>
    </AppLayout>
  );
};

export default Roles;
