import type { Ref } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import AsyncMemberSelect from "@/components/AsyncMemberSelect";
import type { PaginatedSelectHandle } from "@/components/select/PaginatedSelect";
import { MEMBER_FORM_TEXTS } from "@/lib/access/texts";
import type { MinistryFieldsView } from "@/lib/access/member-form";
import { FieldError, FieldHint, ReadOnlyValue } from "./FormFieldParts";
import { describedBy } from "@/lib/a11y";

export interface MinistryValues {
  is_pastor?: boolean | null;
  is_active?: boolean | null;
  has_leadership?: boolean | null;
  leader_id?: string | null;
  is_baptized?: boolean | null;
  baptism_date?: string | null;
}

type MinistryField = keyof MinistryValues;

interface MemberMinistryFieldsProps {
  view: MinistryFieldsView;
  values: MinistryValues;
  onChange: (field: MinistryField, value: string | boolean | null) => void;
  /** O próprio membro, que não pode ser o líder dele. */
  memberId?: string;
  /** O nome do líder com que o formulário abriu (DT-23). */
  leaderSavedLabel?: string | null;
  leaderRef: Ref<PaginatedSelectHandle>;
  /** "Escolha o líder." ou a recusa do servidor no campo Líder (T11). */
  leaderError: string | null;
  /** Busca sem resultado dos seletores (P11). */
  noResultsLabel: string;
}

const SWITCH_ROW = "flex items-center justify-between rounded-md border p-3";

/** "Dados Ministeriais" do cadastro (T6, RN-10, UXD-1, UXD-3, P12). */
export function MemberMinistryFields({
  view,
  values,
  onChange,
  memberId,
  leaderSavedLabel,
  leaderRef,
  leaderError,
  noResultsLabel,
}: MemberMinistryFieldsProps) {
  const showLeader = view.leader === "toggle" ? values.has_leadership === true : view.leader !== "hidden";

  const activeRow = (
    <div className={SWITCH_ROW}>
      <Label htmlFor="is_active">Ativo</Label>
      <Switch id="is_active" checked={values.is_active !== false} onCheckedChange={(v) => onChange("is_active", v)} />
    </div>
  );
  const leadershipSwitch = (
    <div className={SWITCH_ROW}>
      <Label htmlFor="has_leadership">Tem Liderança?</Label>
      <Switch
        id="has_leadership"
        checked={values.has_leadership || false}
        onCheckedChange={(v) => onChange("has_leadership", v)}
      />
    </div>
  );
  // Para quem vê só o ministério, o Líder vem antes de "Ativo" (wireframes da T6).
  const leaderBlock = showLeader && (
    <div className="space-y-2">
      <Label htmlFor="leader">{view.leader === "required" ? MEMBER_FORM_TEXTS.leaderLabel : "Líder"}</Label>
      <AsyncMemberSelect
        inputId="leader"
        focusRef={leaderRef}
        value={values.leader_id || null}
        onChange={(v) => onChange("leader_id", v)}
        excludeId={memberId}
        placeholder="Buscar líder…"
        savedLabel={leaderSavedLabel}
        noResultsLabel={noResultsLabel}
        aria-describedby={describedBy(leaderError && "leader-error", view.leaderHint && "leader-hint")}
      />
      {leaderError && <FieldError id="leader-error">{leaderError}</FieldError>}
      {view.leaderHint && <FieldHint id="leader-hint">{view.leaderHint}</FieldHint>}
    </div>
  );

  return (
    <div>
      <h3 className="text-lg font-semibold mb-3">Dados Ministeriais</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {view.pastor === "switch" && (
          <div className={SWITCH_ROW}>
            <Label htmlFor="is_pastor">É Pastor(a)?</Label>
            <Switch id="is_pastor" checked={values.is_pastor || false} onCheckedChange={(v) => onChange("is_pastor", v)} />
          </div>
        )}
        {view.pastor === "text" && (
          <ReadOnlyValue label={MEMBER_FORM_TEXTS.pastorLabel} note={MEMBER_FORM_TEXTS.pastorReason} />
        )}
        {view.leadership === "switch" ? (
          <>
            {activeRow}
            {leadershipSwitch}
            {leaderBlock}
          </>
        ) : (
          <>
            {view.leadership === "text" && (
              <ReadOnlyValue label={MEMBER_FORM_TEXTS.noLeadershipLabel} note={MEMBER_FORM_TEXTS.noLeadershipReason} />
            )}
            {leaderBlock}
            {activeRow}
          </>
        )}
        <div className={SWITCH_ROW}>
          <Label htmlFor="is_baptized">Batizado(a)?</Label>
          <Switch id="is_baptized" checked={values.is_baptized || false} onCheckedChange={(v) => onChange("is_baptized", v)} />
        </div>
        {values.is_baptized && (
          <div className="space-y-2">
            <Label htmlFor="baptism_date">Data do Batismo</Label>
            <Input
              id="baptism_date"
              type="date"
              value={values.baptism_date || ""}
              onChange={(e) => onChange("baptism_date", e.target.value)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
