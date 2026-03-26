
-- Permissions enum
CREATE TYPE public.permission_action AS ENUM (
  'create_member', 'view_members', 'edit_member', 'delete_member',
  'manage_roles', 'view_roles',
  'view_dashboard'
);

-- Roles table
CREATE TABLE public.roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Role permissions table
CREATE TABLE public.role_permissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission permission_action NOT NULL,
  UNIQUE(role_id, permission)
);

-- Members table
CREATE TABLE public.members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT,
  cpf TEXT UNIQUE,
  gender TEXT CHECK (gender IN ('M', 'F')),
  spouse_id UUID REFERENCES public.members(id) ON DELETE SET NULL,
  birth_date DATE,
  mobile_whatsapp TEXT,
  phone TEXT,
  notes TEXT,
  
  -- Ministry data
  is_pastor BOOLEAN NOT NULL DEFAULT false,
  has_leadership BOOLEAN NOT NULL DEFAULT false,
  leader_id UUID REFERENCES public.members(id) ON DELETE SET NULL,
  is_baptized BOOLEAN NOT NULL DEFAULT false,
  baptism_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  g12_level INTEGER NOT NULL DEFAULT 0,
  
  -- Address
  street TEXT,
  number TEXT,
  complement TEXT,
  neighborhood TEXT,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  
  -- Access
  role_id UUID REFERENCES public.roles(id) ON DELETE SET NULL,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;

-- Security definer function to check permission
CREATE OR REPLACE FUNCTION public.user_has_permission(_user_id UUID, _permission permission_action)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM members m
    JOIN role_permissions rp ON rp.role_id = m.role_id
    WHERE m.auth_user_id = _user_id
      AND rp.permission = _permission
  )
$$;

-- Check if user is admin
CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM members m
    JOIN role_permissions rp ON rp.role_id = m.role_id
    WHERE m.auth_user_id = _user_id
      AND rp.permission = 'manage_roles'
  )
$$;

-- RLS policies for roles
CREATE POLICY "Authenticated users can view roles" ON public.roles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can insert roles" ON public.roles
  FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update roles" ON public.roles
  FOR UPDATE TO authenticated USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete roles" ON public.roles
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

-- RLS policies for role_permissions
CREATE POLICY "Authenticated users can view role permissions" ON public.role_permissions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can insert role permissions" ON public.role_permissions
  FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update role permissions" ON public.role_permissions
  FOR UPDATE TO authenticated USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete role permissions" ON public.role_permissions
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

-- RLS policies for members
CREATE POLICY "Users with view_members can view" ON public.members
  FOR SELECT TO authenticated
  USING (public.user_has_permission(auth.uid(), 'view_members') OR auth_user_id = auth.uid());

CREATE POLICY "Users with create_member can insert" ON public.members
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_permission(auth.uid(), 'create_member'));

CREATE POLICY "Users with edit_member can update" ON public.members
  FOR UPDATE TO authenticated
  USING (public.user_has_permission(auth.uid(), 'edit_member') OR auth_user_id = auth.uid());

CREATE POLICY "Users with delete_member can delete" ON public.members
  FOR DELETE TO authenticated
  USING (public.user_has_permission(auth.uid(), 'delete_member'));

-- Function to compute G12 level
CREATE OR REPLACE FUNCTION public.compute_g12_level()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  leader_level INTEGER;
BEGIN
  IF NEW.is_pastor THEN
    NEW.g12_level := 0;
  ELSIF NEW.leader_id IS NOT NULL THEN
    SELECT g12_level INTO leader_level FROM members WHERE id = NEW.leader_id;
    NEW.g12_level := COALESCE(leader_level, 0) + 1;
  ELSE
    NEW.g12_level := 0;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER compute_member_g12_level
  BEFORE INSERT OR UPDATE OF leader_id, is_pastor ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.compute_g12_level();

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_members_updated_at
  BEFORE UPDATE ON public.members FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_roles_updated_at
  BEFORE UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed default roles
INSERT INTO public.roles (name, description, is_system) VALUES
  ('Administrador', 'Acesso total ao sistema', true),
  ('Líder', 'Pode visualizar e gerenciar membros', false),
  ('Membro', 'Acesso básico ao sistema', false);

-- Seed permissions for admin
INSERT INTO public.role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM public.roles r,
  unnest(ARRAY['create_member', 'view_members', 'edit_member', 'delete_member', 'manage_roles', 'view_roles', 'view_dashboard']::permission_action[]) AS p(permission)
WHERE r.name = 'Administrador';

-- Seed permissions for leader
INSERT INTO public.role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM public.roles r,
  unnest(ARRAY['create_member', 'view_members', 'edit_member', 'view_roles', 'view_dashboard']::permission_action[]) AS p(permission)
WHERE r.name = 'Líder';

-- Seed permissions for member
INSERT INTO public.role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM public.roles r,
  unnest(ARRAY['view_dashboard']::permission_action[]) AS p(permission)
WHERE r.name = 'Membro';
