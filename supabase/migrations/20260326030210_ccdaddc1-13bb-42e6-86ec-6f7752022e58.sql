
CREATE TABLE public.cells (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  leader_id uuid REFERENCES public.members(id),
  timothy_id uuid REFERENCES public.members(id),
  host_id uuid REFERENCES public.members(id),
  type text NOT NULL DEFAULT 'Evangelística',
  meeting_day text DEFAULT 'Sábado',
  meeting_time time DEFAULT '19:00',
  street text,
  number text,
  complement text,
  neighborhood text,
  city text,
  state text,
  zip_code text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.cells ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users with view_members can view cells" ON public.cells
  FOR SELECT TO authenticated
  USING (user_has_permission(auth.uid(), 'view_members'::permission_action));

CREATE POLICY "Users with create_cell can insert" ON public.cells
  FOR INSERT TO authenticated
  WITH CHECK (user_has_permission(auth.uid(), 'create_cell'::permission_action));

CREATE POLICY "Users with edit_cell can update" ON public.cells
  FOR UPDATE TO authenticated
  USING (user_has_permission(auth.uid(), 'edit_cell'::permission_action));

CREATE POLICY "Users with delete_cell can delete" ON public.cells
  FOR DELETE TO authenticated
  USING (user_has_permission(auth.uid(), 'delete_cell'::permission_action));

-- Grant cell permissions to Admin role
INSERT INTO public.role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM public.roles r,
  unnest(ARRAY['create_cell', 'edit_cell', 'delete_cell']::permission_action[]) AS p(permission)
WHERE r.name = 'Administrador'
ON CONFLICT DO NOTHING;

-- Grant cell permissions to Líder role
INSERT INTO public.role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM public.roles r,
  unnest(ARRAY['create_cell', 'edit_cell']::permission_action[]) AS p(permission)
WHERE r.name = 'Líder'
ON CONFLICT DO NOTHING;
