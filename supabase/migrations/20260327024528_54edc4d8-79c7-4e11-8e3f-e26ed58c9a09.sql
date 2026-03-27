
-- Add foreign keys to cells table (if not exist)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cells_leader_id_fkey') THEN
    ALTER TABLE public.cells ADD CONSTRAINT cells_leader_id_fkey FOREIGN KEY (leader_id) REFERENCES public.members(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cells_timothy_id_fkey') THEN
    ALTER TABLE public.cells ADD CONSTRAINT cells_timothy_id_fkey FOREIGN KEY (timothy_id) REFERENCES public.members(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cells_host_id_fkey') THEN
    ALTER TABLE public.cells ADD CONSTRAINT cells_host_id_fkey FOREIGN KEY (host_id) REFERENCES public.members(id);
  END IF;
END $$;

-- Create cell_reports table
CREATE TABLE IF NOT EXISTS public.cell_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cell_id uuid NOT NULL REFERENCES public.cells(id) ON DELETE CASCADE,
  date date NOT NULL,
  time time NOT NULL,
  was_held boolean NOT NULL DEFAULT true,
  reason_not_held text,
  theme text,
  observations text,
  visitors text[] DEFAULT '{}',
  offering numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cell_reports ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cell_reports' AND policyname = 'Users with view_members can view reports') THEN
    CREATE POLICY "Users with view_members can view reports" ON public.cell_reports FOR SELECT TO authenticated USING (user_has_permission(auth.uid(), 'view_members'::permission_action));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cell_reports' AND policyname = 'Users with edit_cell can insert reports') THEN
    CREATE POLICY "Users with edit_cell can insert reports" ON public.cell_reports FOR INSERT TO authenticated WITH CHECK (user_has_permission(auth.uid(), 'edit_cell'::permission_action));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cell_reports' AND policyname = 'Users with edit_cell can update reports') THEN
    CREATE POLICY "Users with edit_cell can update reports" ON public.cell_reports FOR UPDATE TO authenticated USING (user_has_permission(auth.uid(), 'edit_cell'::permission_action));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cell_reports' AND policyname = 'Users with delete_cell can delete reports') THEN
    CREATE POLICY "Users with delete_cell can delete reports" ON public.cell_reports FOR DELETE TO authenticated USING (user_has_permission(auth.uid(), 'delete_cell'::permission_action));
  END IF;
END $$;

-- Create cell_report_participants table
CREATE TABLE IF NOT EXISTS public.cell_report_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.cell_reports(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE
);

ALTER TABLE public.cell_report_participants ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cell_report_participants' AND policyname = 'Users with view_members can view participants') THEN
    CREATE POLICY "Users with view_members can view participants" ON public.cell_report_participants FOR SELECT TO authenticated USING (user_has_permission(auth.uid(), 'view_members'::permission_action));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cell_report_participants' AND policyname = 'Users with edit_cell can insert participants') THEN
    CREATE POLICY "Users with edit_cell can insert participants" ON public.cell_report_participants FOR INSERT TO authenticated WITH CHECK (user_has_permission(auth.uid(), 'edit_cell'::permission_action));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cell_report_participants' AND policyname = 'Users with edit_cell can delete participants') THEN
    CREATE POLICY "Users with edit_cell can delete participants" ON public.cell_report_participants FOR DELETE TO authenticated USING (user_has_permission(auth.uid(), 'edit_cell'::permission_action));
  END IF;
END $$;
