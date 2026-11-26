import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ACTION_LABELS,
  ENTITY_LABELS,
  HISTORY_ACTIONS,
  isEventAction,
  isShownEntity,
  type EventAction,
  type ShownEntity,
} from "@/lib/audit/events";
import { statusLabel, type AuditFilters, type AuditStatus } from "@/lib/audit/url-params";
import { AUDIT_TEXTS } from "@/lib/audit/texts";

const FILTERS = AUDIT_TEXTS.filters;
const ALL = "all";
const ACTIONS = Object.keys(ACTION_LABELS).filter(isEventAction);
const ENTITIES = Object.keys(ENTITY_LABELS).filter(isShownEntity);
const STATUSES: readonly AuditStatus[] = ["success", "error"];

interface SelectFieldProps<T extends string> {
  label: string;
  allLabel: string;
  value: T | null;
  options: readonly T[];
  optionLabel: (value: T) => string;
  isOption: (value: string) => value is T;
  onChange: (value: T | null) => void;
}

function SelectField<T extends string>({ label, allLabel, value, options, optionLabel, isOption, onChange }: SelectFieldProps<T>) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      <Select value={value ?? ALL} onValueChange={(next) => onChange(isOption(next) ? next : null)}>
        <SelectTrigger id={id} className="h-11 md:h-10">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {optionLabel(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const isHistoryOption = (value: string): value is EventAction => HISTORY_ACTIONS.some((action) => action === value);
const isStatus = (value: string): value is AuditStatus => value === "success" || value === "error";

interface FilterSelectsProps {
  filters: AuditFilters;
  /** No histórico de um registro: só Ação, com as 4 opções de registro (T8, T9). */
  historyMode: boolean;
  onChange: (changes: Partial<AuditFilters>) => void;
}

/** Ação, Entidade e Status (T7 e T8), nas ordens da T7. */
export function FilterSelects({ filters, historyMode, onChange }: FilterSelectsProps) {
  return (
    <>
      <SelectField<EventAction>
        label={FILTERS.action}
        allLabel={FILTERS.allFeminine}
        value={filters.action}
        options={historyMode ? HISTORY_ACTIONS : ACTIONS}
        optionLabel={(action) => ACTION_LABELS[action]}
        isOption={historyMode ? isHistoryOption : isEventAction}
        onChange={(action) => onChange({ action })}
      />
      {!historyMode && (
        <>
          <SelectField<ShownEntity>
            label={FILTERS.entity}
            allLabel={FILTERS.allFeminine}
            value={filters.entity}
            options={ENTITIES}
            optionLabel={(entity) => ENTITY_LABELS[entity]}
            isOption={isShownEntity}
            onChange={(entity) => onChange({ entity })}
          />
          <SelectField<AuditStatus>
            label={FILTERS.status}
            allLabel={FILTERS.allMasculine}
            value={filters.status}
            options={STATUSES}
            optionLabel={statusLabel}
            isOption={isStatus}
            onChange={(status) => onChange({ status })}
          />
        </>
      )}
    </>
  );
}
