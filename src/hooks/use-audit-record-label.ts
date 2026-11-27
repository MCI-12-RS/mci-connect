import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AuditRecordRef } from "@/lib/audit/url-params";

/** O nome do registro do histórico (AQ-3): `null` quando o registro não existe (link errado). */
export interface AuditRecordLabel {
  name: string | null;
  leader_name: string | null;
  report_date: string | null;
  deleted: boolean;
}

/**
 * O título do histórico de um registro (E2.05, T9, RN-19), pela `audit_record_label`, que lê a igreja
 * toda, inclusive os excluídos, só com "Visualizar Auditoria".
 */
export function useAuditRecordLabel(record: AuditRecordRef | null) {
  return useQuery({
    queryKey: ["events", "record-label", record?.type ?? null, record?.id ?? null],
    enabled: !!record,
    queryFn: async (): Promise<AuditRecordLabel | null> => {
      if (!record) return null;
      const { data, error } = await supabase.rpc("audit_record_label", { _record_type: record.type, _record_id: record.id });
      if (error) throw error;
      const row = data?.[0];
      return row ? { name: row.name, leader_name: row.leader_name, report_date: row.report_date, deleted: row.deleted === true } : null;
    },
  });
}
