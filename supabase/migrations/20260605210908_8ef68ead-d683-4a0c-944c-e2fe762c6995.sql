
CREATE OR REPLACE FUNCTION public.process_approval_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title text;
  v_body text;
  v_link text;
BEGIN
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

  v_link = CASE
    WHEN NEW.branch_id IS NOT NULL THEN '/branch/' || NEW.branch_id || '/approval-requests'
    ELSE '/admin/approval-requests'
  END;

  INSERT INTO public.notifications(tenant_id, user_id, title, body, type, link, related_entity, related_entity_id)
  VALUES (NEW.tenant_id, NEW.requested_by, v_title, v_body, 'general', v_link, 'approval_request', NEW.id);

  RETURN NEW;
END $$;
