-- 0178: owner 2026-11-07 «ادمجهم الاتنين واحد … سيب 1412» and «446 … خليهم 1239». The same heater was typed with two
-- codes: سكة bought «سخان … ميكانيكال باكرة تحكم 50 لتر هيرو» (1412) / «سخان اوليمبك غاز طبيعي 6 لتر بالشاحن» (446) from
-- الحاج مصطفى بدر and sold them to شلبى, while شلبى recorded the same pieces as 273 «… 50 لتر هيرو عادى» / 1239 —
-- so سكة had 1412 +40 / 446 +5 and 273 −37 / 1239 −5. In every branch the rows of 273 and 446 are merged into the
-- branch's 1412 and 1239 rows: every document line, batch, stock movement, shortage, transfer, count line and
-- prior-year return pointing to the old row now points to the kept row (history and amounts unchanged, line names
-- kept as typed), the kept row's quantity = both, the old row → quantity 0 and archived (never deleted). The user
-- triggers of the touched tables are switched off only for the repoint (stock_movements is immutable, invoice_items'
-- update trigger would move stock) and back on in the same transaction. Then every 2026 sale of 1412 / 1239 is
-- re-costed (`recost_product_sales`) and cost_price = average. Check: per kept row, products.quantity = the two rows'
-- quantities before, and Σ cost-ledger quantities = that too (raises otherwise) — except شلبى, whose 273 row already
-- had its stock log 8 above its balance (27 vs 35) before the merge (one of the S3 warnings).
-- Dry-run: سكة 1412 38 + (−37) = 1, 1239 −5 + 5 = 0; عبدالمنعم 1412 5, 1239 1; شلبى 1412 26, 1239 6;
-- net profit 1/1–28/10 2,085,788.57 → 2,087,594.77.
DO $mig$
DECLARE v_t uuid; v_owner uuid; pr record; v_ids uuid[]; v_want jsonb; k record; v_led numeric;
BEGIN
  SELECT tenant_id INTO v_t FROM public.branches WHERE code = 'FR-005';
  IF v_t IS NULL OR NOT EXISTS (SELECT 1 FROM public.products WHERE tenant_id = v_t AND sku IN ('273', '446') AND archived_at IS NULL) THEN RETURN; END IF;
  SELECT ur.user_id INTO v_owner FROM public.user_roles ur JOIN public.branches b ON b.tenant_id = ur.tenant_id
   WHERE ur.role = 'owner' AND b.code = 'FR-005' ORDER BY ur.user_id LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);

  SELECT jsonb_object_agg(bb.id::text, a.quantity + bb.quantity) INTO v_want
    FROM public.products a JOIN public.products bb ON bb.branch_id = a.branch_id
    JOIN (VALUES ('273', '1412'), ('446', '1239')) m(f, t) ON a.sku = m.f AND bb.sku = m.t WHERE a.tenant_id = v_t;

  ALTER TABLE public.invoice_items DISABLE TRIGGER USER;          ALTER TABLE public.shipment_items DISABLE TRIGGER USER;
  ALTER TABLE public.purchase_return_items DISABLE TRIGGER USER;  ALTER TABLE public.return_items DISABLE TRIGGER USER;
  ALTER TABLE public.product_batches DISABLE TRIGGER USER;        ALTER TABLE public.stock_movements DISABLE TRIGGER USER;
  ALTER TABLE public.stock_shortages DISABLE TRIGGER USER;        ALTER TABLE public.stock_transfers DISABLE TRIGGER USER;
  ALTER TABLE public.stock_adjustment_items DISABLE TRIGGER USER; ALTER TABLE public.products DISABLE TRIGGER USER;

  FOR pr IN SELECT a.id a_id, bb.id b_id, a.quantity a_q FROM public.products a JOIN public.products bb ON bb.branch_id = a.branch_id
             JOIN (VALUES ('273', '1412'), ('446', '1239')) m(f, t) ON a.sku = m.f AND bb.sku = m.t WHERE a.tenant_id = v_t LOOP
    UPDATE public.invoice_items SET product_id = pr.b_id WHERE product_id = pr.a_id;
    UPDATE public.shipment_items SET product_id = pr.b_id WHERE product_id = pr.a_id;
    UPDATE public.return_items SET product_id = pr.b_id WHERE product_id = pr.a_id;
    UPDATE public.purchase_return_items SET product_id = pr.b_id WHERE product_id = pr.a_id;
    UPDATE public.product_batches SET product_id = pr.b_id WHERE product_id = pr.a_id;
    UPDATE public.stock_movements SET product_id = pr.b_id WHERE product_id = pr.a_id;
    UPDATE public.stock_shortages SET product_id = pr.b_id WHERE product_id = pr.a_id;
    UPDATE public.stock_transfers SET product_id = pr.b_id WHERE product_id = pr.a_id;
    UPDATE public.stock_adjustment_items SET product_id = pr.b_id WHERE product_id = pr.a_id;
    UPDATE public.prior_year_returns
       SET items = (SELECT jsonb_agg(CASE WHEN e->>'product_id' = pr.a_id::text THEN e || jsonb_build_object('product_id', pr.b_id) ELSE e END)
                      FROM jsonb_array_elements(items) e)
     WHERE items::text LIKE '%' || pr.a_id::text || '%';
    UPDATE public.products SET quantity = quantity + pr.a_q WHERE id = pr.b_id;
    UPDATE public.products SET quantity = 0, archived_at = now(), archived_by = v_owner WHERE id = pr.a_id;
  END LOOP;

  ALTER TABLE public.invoice_items ENABLE TRIGGER USER;          ALTER TABLE public.shipment_items ENABLE TRIGGER USER;
  ALTER TABLE public.purchase_return_items ENABLE TRIGGER USER;  ALTER TABLE public.return_items ENABLE TRIGGER USER;
  ALTER TABLE public.product_batches ENABLE TRIGGER USER;        ALTER TABLE public.stock_movements ENABLE TRIGGER USER;
  ALTER TABLE public.stock_shortages ENABLE TRIGGER USER;        ALTER TABLE public.stock_transfers ENABLE TRIGGER USER;
  ALTER TABLE public.stock_adjustment_items ENABLE TRIGGER USER; ALTER TABLE public.products ENABLE TRIGGER USER;

  FOR k IN SELECT key::uuid id, value::numeric want FROM jsonb_each_text(v_want) LOOP
    SELECT coalesce(sum(qty), 0) INTO v_led FROM public.product_cost_ledger(k.id);
    IF (SELECT quantity FROM public.products WHERE id = k.id) <> k.want THEN
      RAISE EXCEPTION '0178: quantity of % is % (want %)', k.id, (SELECT quantity FROM public.products WHERE id = k.id), k.want;
    END IF;
    IF v_led <> k.want AND NOT EXISTS (SELECT 1 FROM public.products p JOIN public.branches b ON b.id = p.branch_id WHERE p.id = k.id AND b.code = 'FR-005') THEN
      RAISE EXCEPTION '0178: cost ledger of % sums to % (want %)', k.id, v_led, k.want;
    END IF;
  END LOOP;

  SELECT array_agg(id) INTO v_ids FROM public.products WHERE tenant_id = v_t AND sku IN ('1412', '1239');
  PERFORM public.recost_product_sales(v_ids, '2026-01-01 00:00+02');
  UPDATE public.products SET cost_price = round(avg_cost, 2) WHERE id = ANY (v_ids) AND coalesce(avg_cost, 0) > 0;
END
$mig$;
