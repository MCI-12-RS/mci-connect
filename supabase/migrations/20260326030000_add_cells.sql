
-- Add new permissions to enum
-- Note: ALTER TYPE ... ADD VALUE cannot be executed in a transaction block in some Postgres environments, 
-- but Supabase migrations handle this.
ALTER TYPE public.permission_action ADD VALUE IF NOT EXISTS 'view_cells';
ALTER TYPE public.permission_action ADD VALUE IF NOT EXISTS 'create_cell';
ALTER TYPE public.permission_action ADD VALUE IF NOT EXISTS 'edit_cell';
ALTER TYPE public.permission_action ADD VALUE IF NOT EXISTS 'delete_cell';

-- Create cells table
CREATE TABLE public.cells (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  leader_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  timothy_id UUID REFERENCES public.members(id) ON DELETE SET NULL,
  host_id UUID REFERENCES public.members(id) ON DELETE SET NULL,
  type TEXT CHECK (type IN ('Evangelística', 'Discipulado', 'Macrocélula')),
  meeting_day TEXT CHECK (meeting_day IN ('Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado')),
  meeting_time TIME,
  
  -- Address
  street TEXT,
  number TEXT,
  complement TEXT,
  neighborhood TEXT,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.cells ENABLE ROW LEVEL SECURITY;

-- RLS policies for cells
CREATE POLICY "Users with view_cells can view" ON public.cells
  FOR SELECT TO authenticated
  USING (public.user_has_permission(auth.uid(), 'view_cells'));

CREATE POLICY "Users with create_cell can insert" ON public.cells
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_permission(auth.uid(), 'create_cell'));

CREATE POLICY "Users with edit_cell can update" ON public.cells
  FOR UPDATE TO authenticated
  USING (public.user_has_permission(auth.uid(), 'edit_cell'));

CREATE POLICY "Users with delete_cell can delete" ON public.cells
  FOR DELETE TO authenticated
  USING (public.user_has_permission(auth.uid(), 'delete_cell'));

-- Updated_at trigger
CREATE TRIGGER update_cells_updated_at
  BEFORE UPDATE ON public.cells FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed permissions for existing roles
-- Administrador gets all
INSERT INTO public.role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM public.roles r,
  unnest(ARRAY['view_cells', 'create_cell', 'edit_cell', 'delete_cell']::permission_action[]) AS p(permission)
WHERE r.name = 'Administrador'
ON CONFLICT DO NOTHING;

-- Líder gets view, create and edit
INSERT INTO public.role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM public.roles r,
  unnest(ARRAY['view_cells', 'create_cell', 'edit_cell']::permission_action[]) AS p(permission)
WHERE r.name = 'Líder'
ON CONFLICT DO NOTHING;
