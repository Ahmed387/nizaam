-- 1. Advance request status enum
CREATE TYPE public.advance_request_status AS ENUM (
  'pending_branch_manager',
  'pending_admin',
  'approved',
  'rejected'
);

-- 2. Advance requests table (workflow)
CREATE TABLE public.advance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  employee_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  monthly_deduct numeric NOT NULL CHECK (monthly_deduct > 0),
  reason text,
  status public.advance_request_status NOT NULL DEFAULT 'pending_branch_manager',
  branch_manager_id uuid,
  branch_manager_decision_at timestamptz,
  branch_manager_note text,
  admin_id uuid,
  admin_decision_at timestamptz,
  admin_note text,
  rejection_reason text,
  resulting_advance_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_adv_req_status ON public.advance_requests(status);
CREATE INDEX idx_adv_req_employee ON public.advance_requests(employee_id);
CREATE INDEX idx_adv_req_branch ON public.advance_requests(branch_id);
CREATE INDEX idx_adv_req_tenant ON public.advance_requests(tenant_id);

ALTER TABLE public.advance_requests ENABLE ROW LEVEL SECURITY;

-- Auto-set tenant_id
CREATE TRIGGER trg_adv_req_set_tenant
  BEFORE INSERT ON public.advance_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.set_tenant_id_from_user();

-- Update updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_adv_req_touch
  BEFORE UPDATE ON public.advance_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

-- RLS: read
-- - super admin: all
-- - admin (tenant): all in tenant
-- - branch manager of branch: requests in their branch
-- - the employee themselves (requested_by = auth.uid()): their requests
CREATE POLICY adv_req_read ON public.advance_requests
FOR SELECT
USING (
  is_super_admin(auth.uid())
  OR (tenant_id = current_tenant_id() AND is_admin(auth.uid()))
  OR (tenant_id = current_tenant_id() AND has_role(auth.uid(), 'branch_manager') AND user_in_branch(auth.uid(), branch_id))
  OR (requested_by = auth.uid())
);

-- INSERT: any authenticated user in the tenant can request for themselves
CREATE POLICY adv_req_insert ON public.advance_requests
FOR INSERT
WITH CHECK (
  tenant_id = current_tenant_id()
  AND requested_by = auth.uid()
);

-- UPDATE: branch manager (their branch) or admin or super admin
CREATE POLICY adv_req_update ON public.advance_requests
FOR UPDATE
USING (
  is_super_admin(auth.uid())
  OR (tenant_id = current_tenant_id() AND is_admin(auth.uid()))
  OR (tenant_id = current_tenant_id() AND has_role(auth.uid(), 'branch_manager') AND user_in_branch(auth.uid(), branch_id))
);

-- 3. Notifications table
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  user_id uuid NOT NULL,
  title text NOT NULL,
  body text,
  type text NOT NULL DEFAULT 'general',
  link text,
  related_entity text,
  related_entity_id uuid,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_notif_user_unread ON public.notifications(user_id, is_read, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_notif_set_tenant
  BEFORE INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.set_tenant_id_from_user();

-- Users can read their own notifications. Super admin can read all.
CREATE POLICY notif_read ON public.notifications
FOR SELECT
USING (user_id = auth.uid() OR is_super_admin(auth.uid()));

-- Authenticated users in same tenant can create notifications (for workflow)
CREATE POLICY notif_insert ON public.notifications
FOR INSERT
WITH CHECK (
  tenant_id = current_tenant_id() OR is_super_admin(auth.uid())
);

-- Users can mark their own notifications as read
CREATE POLICY notif_update ON public.notifications
FOR UPDATE
USING (user_id = auth.uid() OR is_super_admin(auth.uid()));

CREATE POLICY notif_delete ON public.notifications
FOR DELETE
USING (user_id = auth.uid() OR is_super_admin(auth.uid()));

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.advance_requests;