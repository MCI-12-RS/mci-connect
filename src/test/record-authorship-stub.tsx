// O bloco de autoria (E2.05, T1) trocado por um marcador nos testes dos formulários, que não montam o
// roteador nem a leitura da autoria: o teste confere onde o bloco entra (UX-03) sem consumir respostas
// da fila do `fake-supabase`. O componente de verdade tem os próprios testes (RecordAuthorship.test.tsx).
import type { AuthorshipEntity } from "@/lib/audit/authorship";

export function RecordAuthorshipStub({ entity, recordId }: { entity: AuthorshipEntity; recordId: string }) {
  return <div data-testid="record-authorship" data-entity={entity} data-record-id={recordId} />;
}
