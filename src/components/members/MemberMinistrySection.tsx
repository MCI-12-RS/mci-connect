import type { ReactNode } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import AsyncMemberSelect from "@/components/AsyncMemberSelect";
import { MEMBER_FORM_TEXTS } from "@/lib/access/texts";
import type { MinistryFieldsView } from "@/lib/access/member-form";
import { fieldA11yProps } from "@/lib/a11y";
import { switchFields, switchesOf, type MemberFormFields } from "@/lib/members/form-values";
import {
  ministrySwitchNotices,
  setBaptismDate,
  setBaptized,
  setHasLeadership,
  setLeader,
  setPastor,
  type MinistrySwitches,
  type SwitchNotice,
} from "@/lib/members/leadership";
import { MEMBER_FORM_LAYOUT_TEXTS as TEXTS } from "@/lib/members/texts";
import { cn } from "@/lib/utils";
import { FieldMessages } from "./FieldMessages";
import { ReadOnlyValue } from "./FormFieldParts";
import { FIELD_BLOCK, errorOf, invalidBorder, type MemberFieldsUi } from "./member-form-ui";

interface MemberMinistrySectionProps {
  ui: MemberFieldsUi;
  /** O que quem edita vê (E2.02). */
  view: MinistryFieldsView;
  /** O cadastro editado: não é oferecido como líder, e os discípulos dele vêm desabilitados (RN-13, AQ-4). */
  memberId?: string;
  /** A busca sem resultado (P11). */
  noResultsLabel: string;
}

/** Os textos embaixo de um interruptor (P20): o aviso é anunciado como status. */
function SwitchNotices({ notices }: { notices: SwitchNotice[] }) {
  return (
    <>
      {notices.map((notice) =>
        notice.kind === "warning" ? (
          <p key={notice.text} role="status" className="flex items-start gap-1.5 text-sm text-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{notice.text}</span>
          </p>
        ) : (
          <p key={notice.text} className={cn("text-sm", notice.kind === "hint" ? "text-muted-foreground" : "text-foreground")}>
            {notice.text}
          </p>
        ),
      )}
    </>
  );
}

interface SwitchRowProps {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  switchRef?: (element: HTMLButtonElement | null) => void;
  invalid?: boolean;
  describedBy?: string;
  children?: ReactNode;
}

/** Uma linha de interruptor: o rótulo ocupa a linha toda, com 44 px, e o toque em qualquer ponto muda o valor (UX-31). */
function SwitchRow({ id, label, checked, onChange, switchRef, invalid, describedBy, children }: SwitchRowProps) {
  return (
    <div className={FIELD_BLOCK}>
      <Label
        htmlFor={id}
        className={cn(
          "flex min-h-11 flex-1 cursor-pointer items-center justify-between gap-3 rounded-md border p-3",
          invalidBorder(!!invalid),
        )}
      >
        <span>{label}</span>
        <Switch
          id={id}
          ref={switchRef}
          checked={checked}
          onCheckedChange={onChange}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
        />
      </Label>
      {children}
    </div>
  );
}

/**
 * Dados ministeriais (E2.04, T4; E2.02, T6): "É Pastor(a)?", "Tem
 * Liderança?", Líder, "Ativo", "Batizado(a)?" e Data do batismo. Os
 * interruptores escondem o campo que apagam e avisam o que será apagado (P20).
 */
export function MemberMinistrySection({ ui, view, memberId, noResultsLabel }: MemberMinistrySectionProps) {
  const { control, watch, setValue } = useFormContext<MemberFormFields>();
  const values = watch();
  const switches = switchesOf(values);
  const notices = ministrySwitchNotices(switches);

  const apply = (next: MinistrySwitches) => {
    const fields = switchFields(next);
    setValue("ministry_memory", fields.ministry_memory);
    setValue("leader_name", fields.leader_name);
    setValue("is_pastor", fields.is_pastor, { shouldDirty: true });
    setValue("has_leadership", fields.has_leadership, { shouldDirty: true });
    setValue("leader_id", fields.leader_id, { shouldDirty: true });
    setValue("is_baptized", fields.is_baptized, { shouldDirty: true });
    setValue("baptism_date", fields.baptism_date, { shouldDirty: true });
  };

  const pastorError = errorOf(ui, "is_pastor");
  const leaderError = errorOf(ui, "leader_id");
  const baptismError = errorOf(ui, "baptism_date");
  const isChurchView = view.leadership === "switch";
  const showLeader = isChurchView ? values.has_leadership && !values.is_pastor : view.leader !== "hidden";

  const pastorRow =
    view.pastor === "switch" ? (
      <Controller
        name="is_pastor"
        control={control}
        render={({ field }) => (
          <SwitchRow
            id="is_pastor"
            label={TEXTS.labels.pastor}
            checked={values.is_pastor}
            onChange={(on) => apply(setPastor(switches, on))}
            switchRef={field.ref}
            invalid={!!pastorError}
            describedBy={fieldA11yProps("is_pastor", { error: pastorError })["aria-describedby"]}
          >
            <FieldMessages id="is_pastor" error={pastorError} />
            <SwitchNotices notices={notices.pastor} />
          </SwitchRow>
        )}
      />
    ) : view.pastor === "text" ? (
      <ReadOnlyValue label={MEMBER_FORM_TEXTS.pastorLabel} note={MEMBER_FORM_TEXTS.pastorReason} />
    ) : null;

  const leadershipRow = isChurchView
    ? !values.is_pastor && (
        <SwitchRow
          id="has_leadership"
          label={TEXTS.labels.hasLeadership}
          checked={values.has_leadership}
          onChange={(on) => apply(setHasLeadership(switches, on))}
        >
          <SwitchNotices notices={notices.leadership} />
        </SwitchRow>
      )
    : view.leadership === "text" && (
        <ReadOnlyValue label={MEMBER_FORM_TEXTS.noLeadershipLabel} note={MEMBER_FORM_TEXTS.noLeadershipReason} />
      );

  const leaderBlock = showLeader && (
    <div className={cn(FIELD_BLOCK, "md:col-span-2")}>
      <Label htmlFor="leader">{view.leader === "optional" ? TEXTS.labels.leaderOptional : TEXTS.labels.leader}</Label>
      <Controller
        name="leader_id"
        control={control}
        render={({ field }) => (
          <AsyncMemberSelect
            inputId="leader"
            focusRef={field.ref}
            value={field.value}
            onChange={(id, name) => apply(setLeader(switches, id ? { id, name: name ?? "" } : null))}
            excludeId={memberId}
            descendantOf={memberId}
            placeholder={TEXTS.placeholders.leader}
            savedLabel={values.leader_name}
            noResultsLabel={noResultsLabel}
            {...fieldA11yProps("leader", { error: leaderError, hint: view.leaderHint })}
          />
        )}
      />
      <FieldMessages id="leader" error={leaderError} hint={view.leaderHint} />
    </div>
  );

  const activeRow = (
    <Controller
      name="is_active"
      control={control}
      render={({ field }) => (
        <SwitchRow id="is_active" label={TEXTS.labels.active} checked={field.value} onChange={field.onChange} switchRef={field.ref} />
      )}
    />
  );

  const baptismRow = (
    <SwitchRow
      id="is_baptized"
      label={TEXTS.labels.baptized}
      checked={values.is_baptized}
      onChange={(on) => apply(setBaptized(switches, on))}
    >
      <SwitchNotices notices={notices.baptism} />
    </SwitchRow>
  );

  const baptismDate = values.is_baptized && (
    <div className={FIELD_BLOCK}>
      <Label htmlFor="baptism_date">{TEXTS.labels.baptismDate}</Label>
      <Controller
        name="baptism_date"
        control={control}
        render={({ field }) => (
          <Input
            id="baptism_date"
            ref={field.ref}
            type="date"
            value={field.value ?? ""}
            onChange={(event) => apply(setBaptismDate(switches, event.target.value || null))}
            {...fieldA11yProps("baptism_date", { error: baptismError })}
            className={invalidBorder(!!baptismError)}
          />
        )}
      />
      <FieldMessages id="baptism_date" error={baptismError} />
    </div>
  );

  return (
    <section className="space-y-4">
      <h3 className="text-lg font-semibold">{TEXTS.sections.ministry}</h3>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {pastorRow}
        {/* Para quem vê só o ministério, a ordem da T6 do E2.02 não muda: Líder, Ativo e Batizado(a)?. */}
        {leadershipRow}
        {leaderBlock}
        {activeRow}
        {baptismRow}
        {baptismDate}
      </div>
    </section>
  );
}
