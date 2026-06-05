
-- 1) Enum for action types
DO $$ BEGIN
  CREATE TYPE public.approval_action AS ENUM ('delete', 'update');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.approval_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Table
CREATE TABLE public.approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_id uuid,
  entity_type text NOT NULL, -- 'contact' | 'invoice' | 'shipment' | ...
  entity_id uuid NOT NULL,
  entity_label text NOT NULL,
  action public.approval_action NOT NULL,
  payload jsonb,             -- proposed new values when action='update'
  reason text,
  status public.approval_status NOT NULL DEFAULT 'pending',
  requested_by uuid NOT NULL,
  requested_by_name text NOT NULL,
  admin_id uuid,
  admin_note text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_approval_requests_tenant_status ON public.approval_requests(tenant_id, status);
CREATE INDEX idx_approval_requests_requested_by ON public.approval_requests(requested_by);

-- 3) GRANTs
GRANT SELECT, INSERT, UPDATE ON public.approval_requests TO authenticated;
GRANT ALL ON public.approval_requests TO service_role;

-- 4) Enable RLS
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;

-- 5) Policies
CREATE POLICY ar_insert ON public.approval_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND requested_by = auth.uid()
    AND (
      is_admin(auth.uid())
      OR (has_role(auth.uid(), 'branch_manager'::app_role) AND user_in_branch(auth.uid(), branch_id))
    )
  );

CREATE POLICY ar_read ON public.approval_requests
  FOR SELECT TO authenticated
  USING (
    is_super_admin(auth.uid())
    OR (tenant_id = current_tenant_id() AND is_admin(auth.uid()))
    OR requested_by = auth.uid()
  );

CREATE POLICY ar_update_admin ON public.approval_requests
  FOR UPDATE TO authenticated
  USING (
    is_super_admin(auth.uid())
    OR (tenant_id = current_tenant_id() AND is_admin(auth.uid()))
  )
  WITH CHECK (
    is_super_admin(auth.uid())
    OR (tenant_id = current_tenant_id() AND is_admin(auth.uid()))
  );

CREATE POLICY ar_suspended ON public.approval_requests
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()) OR NOT current_tenant_is_suspended())
  WITH CHECK (is_super_admin(auth.uid()) OR NOT current_tenant_is_suspended());

-- 6) updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_approval_requests_updated_at
  BEFORE UPDATE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 7) Trigger to execute action on approval + notify requester
CREATE OR REPLACE FUNCTION public.process_approval_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title text;
  v_body text;
  v_link text;
BEGIN
  -- only run when status changes to approved or rejected
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  IF NEW.status = 'approved' THEN
    NEW.decided_at = now();

    IF NEW.action = 'delete' THEN
      IF NEW.entity_type = 'contact' THEN
        DELETE FROM public.contacts WHERE id = NEW.entity_id AND tenant_id = NEW.tenant_id;
      ELSIF NEW.entity_type = 'invoice' THEN
        UPDATE public.invoices SET status = 'cancelled', cancel_reason = COALESCE(NEW.admin_note, NEW.reason, 'Approved deletion')
          WHERE id = NEW.entity_id AND tenant_id = NEW.tenant_id;
      ELSIF NEW.entity_type = 'shipment' THEN
        DELETE FROM public.shipments WHERE id = NEW.entity_id AND tenant_id = NEW.tenant_id;
      END IF;
    ELSIF NEW.action = 'update' AND NEW.payload IS NOT NULL THEN
      IF NEW.entity_type = 'contact' THEN
        UPDATE public.contacts SET
          name = COALESCE(NEW.payload->>'name', name),
          phone = COALESCE(NEW.payload->>'phone', phone),
          address = COALESCE(NEW.payload->>'address', address),
          contact_person = COALESCE(NEW.payload->>'contact_person', contact_person),
          notes = COALESCE(NEW.payload->>'notes', notes)
        WHERE id = NEW.entity_id AND tenant_id = NEW.tenant_id;
      END IF;
    END IF;

    v_title = 'تمت الموافقة على طلبك';
    v_body  = 'تمت الموافقة على طلب ' || (CASE WHEN NEW.action='delete' THEN 'حذف' ELSE 'تعديل' END) || ' ' || NEW.entity_label;
  ELSIF NEW.status = 'rejected' THEN
    NEW.decided_at = now();
    v_title = 'تم رفض طلبك';
    v_body  = 'تم رفض طلب ' || (CASE WHEN NEW.action='delete' THEN 'حذف' ELSE 'تعديل' END) || ' ' || NEW.entity_label
              || COALESCE(' — ' || NEW.admin_note, '');
  END IF;

  v_link = '/branch/approval-requests';

  INSERT INTO public.notifications(tenant_id, user_id, title, body, type, link, related_entity, related_entity_id)
  VALUES (NEW.tenant_id, NEW.requested_by, v_title, v_body, 'general', v_link, 'approval_request', NEW.id);

  RETURN NEW;
END $$;

CREATE TRIGGER trg_approval_requests_process
  BEFORE UPDATE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.process_approval_request();

-- 8) Trigger to notify admins on new pending request
CREATE OR REPLACE FUNCTION public.notify_admins_new_approval()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE p.tenant_id = NEW.tenant_id AND ur.role = 'admin'
  LOOP
    INSERT INTO public.notifications(tenant_id, user_id, title, body, type, link, related_entity, related_entity_id)
    VALUES (
      NEW.tenant_id, r.user_id,
      'طلب موافقة جديد',
      NEW.requested_by_name || ' يطلب ' || (CASE WHEN NEW.action='delete' THEN 'حذف' ELSE 'تعديل' END) || ' ' || NEW.entity_label,
      'general', '/admin/approval-requests', 'approval_request', NEW.id
    );
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_approval_requests_notify_admins
  AFTER INSERT ON public.approval_requests
  FOR EACH ROW WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION public.notify_admins_new_approval();

-- 9) Realtime
ALTER TABLE public.approval_requests REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.approval_requests;
