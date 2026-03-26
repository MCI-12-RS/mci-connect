-- CREATE TABLE: cell_reports
CREATE TABLE public.cell_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cell_id uuid NOT NULL REFERENCES public.cells(id) ON DELETE CASCADE,
  date date NOT NULL,
  time time NOT NULL,
  theme text,
  observations text,
  visitors jsonb DEFAULT '[]'::jsonb,
  offering numeric(10,2) DEFAULT 0,
  was_held boolean NOT NULL DEFAULT true,
  reason_not_held text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- CREATE TABLE: cell_report_participants
CREATE TABLE public.cell_report_participants (
  report_id uuid NOT NULL REFERENCES public.cell_reports(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  PRIMARY KEY (report_id, member_id)
);

-- ENABLE RLS
ALTER TABLE public.cell_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cell_report_participants ENABLE ROW LEVEL SECURITY;

-- POLICIES FOR cell_reports
CREATE POLICY "Users with view_members can view cell_reports" ON public.cell_reports
  FOR SELECT TO authenticated
  USING (user_has_permission(auth.uid(), 'view_members'::permission_action));

CREATE POLICY "Users with create_cell can insert cell_reports" ON public.cell_reports
  FOR INSERT TO authenticated
  WITH CHECK (user_has_permission(auth.uid(), 'create_cell'::permission_action));

CREATE POLICY "Users with edit_cell can update cell_reports" ON public.cell_reports
  FOR UPDATE TO authenticated
  USING (user_has_permission(auth.uid(), 'edit_cell'::permission_action));

CREATE POLICY "Users with delete_cell can delete cell_reports" ON public.cell_reports
  FOR DELETE TO authenticated
  USING (user_has_permission(auth.uid(), 'delete_cell'::permission_action));

-- POLICIES FOR cell_report_participants
CREATE POLICY "Users with view_members can view cell_report_participants" ON public.cell_report_participants
  FOR SELECT TO authenticated
  USING (user_has_permission(auth.uid(), 'view_members'::permission_action));

CREATE POLICY "Users with create_cell can insert cell_report_participants" ON public.cell_report_participants
  FOR INSERT TO authenticated
  WITH CHECK (user_has_permission(auth.uid(), 'create_cell'::permission_action));

CREATE POLICY "Users with edit_cell can update/delete cell_report_participants" ON public.cell_report_participants
  FOR ALL TO authenticated
  USING (user_has_permission(auth.uid(), 'edit_cell'::permission_action));

-- TRIGGER FOR updated_at
CREATE TRIGGER update_cell_reports_updated_at
  BEFORE UPDATE ON public.cell_reports FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
