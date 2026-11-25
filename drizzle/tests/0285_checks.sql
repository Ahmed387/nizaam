-- 0285 checks (rollback-only: always raises DRY). Run after migrations 0285a + 0285.
do $dry$
declare t uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71';
  sk uuid := '1329f6cc-a4a5-418c-9e91-cccd651b3142'; am uuid := '7a9f9e1b-d6ae-47c0-9965-bf23d0d31213'; sh uuid;
  cashier uuid; nour uuid; taha uuid; mahmoud uuid := '9aa41d69-13ef-41d8-a6ca-b6c722c95c62'; owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  out text := ''; tid uuid; tid2 uuid; r jsonb; s record; n int; v numeric; v0 numeric; g uuid; pid uuid; q0 int; q1 int; b0 numeric; b1 numeric; req uuid;
begin
  create temp table _seq on commit drop as select schemaname, sequencename, last_value from pg_sequences where schemaname='public' and last_value is not null;
  select b.id into sh from branches b where b.tenant_id=t and b.name like '%شلبى%';
  select p.id into cashier from profiles p where p.name='محمد ياسر' and p.tenant_id=t;
  select p.id into nour from profiles p where p.name like '%نور ناصر%' and p.tenant_id=t;
  select p.id into taha from profiles p where p.name like '%محمد طه%' and p.tenant_id=t;
  SET CONSTRAINTS ALL IMMEDIATE;
  select coalesce(sum(case when x.type='income' then x.amount else -x.amount end),0) into v0 from treasury x where x.branch_id=sk and x.payment_method='instapay';
  -- M1 cashier / M2 read-only refused
  perform set_config('request.jwt.claims', json_build_object('sub',cashier,'role','authenticated')::text, true);
  begin perform public.transfer_treasury_atomic(sk, am, 100, 'x', 'instapay', 0, null, null, true, null, '01018232539'); out := out||'M1 CASHIER SENT!! | ';
  exception when others then out := out||'M1 cashier refused ✓ | '; end;
  perform set_config('request.jwt.claims', json_build_object('sub',nour,'role','authenticated')::text, true);
  begin perform public.transfer_treasury_atomic(sk, am, 100, 'x', 'instapay', 0, null, null, true, null, '01018232539'); out := out||'M2 READONLY SENT!! | ';
  exception when others then out := out||'M2 read-only refused ✓ | '; end;
  -- M3 manager sends 100 instapay, fee 1%
  perform set_config('request.jwt.claims', json_build_object('sub',mahmoud,'role','authenticated')::text, true);
  tid := public.transfer_treasury_atomic(sk, am, 100, 'تجربة', 'instapay', 0, null, null, true, null, '01018232539', 'percent', 1);
  select coalesce(sum(case when x.type='income' then x.amount else -x.amount end),0) into v from treasury x where x.branch_id=sk and x.payment_method='instapay';
  out := out||'M3 sent fee='||(select fee_amount from treasury_transfers where id=tid)||' till Δ='||(v-v0)||' notified='||coalesce((select string_agg(p.name,'، ') from notifications x join profiles p on p.id=x.user_id where x.related_entity_id=tid),'-')||' | ';
  -- cash fee forced 0
  tid2 := public.transfer_treasury_atomic(sk, am, 10, 'x', 'cash', 0, null, null, true, null, null, 'fixed', 5);
  out := out||'cash fee='||(select fee_amount from treasury_transfers where id=tid2)||' | ';
  perform public.cancel_money_transfer(tid2, 'تجربة');
  -- M5 edit 100 -> 80, fixed 3
  r := public.edit_money_transfer(tid, 80, 'fixed', 3, 'غلطت في المبلغ');
  select coalesce(sum(case when x.type='income' then x.amount else -x.amount end),0) into v from treasury x where x.branch_id=sk and x.payment_method='instapay';
  out := out||'M5 edit till Δ='||(v-v0)||' (expect -83) rev days='||coalesce((select string_agg(distinct x.transaction_date::text,',') from treasury x where x.branch_id=sk and x.category='إلغاء سند' and x.created_at > now() - interval '1 minute'),'-')||' | ';
  -- M6 read-only receiver refused, manage receiver ok on cash
  perform set_config('request.jwt.claims', json_build_object('sub',mahmoud,'role','authenticated')::text, true);
  begin perform public.receive_treasury_transfer(tid, 80, null); out := out||'M6 READONLY RECEIVED!! | ';
  exception when others then out := out||'M6 read-only receive refused ✓ | '; end;
  perform set_config('request.jwt.claims', json_build_object('sub',nour,'role','authenticated')::text, true);
  r := public.receive_treasury_transfer(tid, 50, 'وصل 50', 'cash', null);
  out := out||'M6 nour received '||r||' rows: '||(select string_agg(b.name||' '||x.payment_method||' '||x.type||' '||x.amount, ' ; ' order by x.created_at) from treasury x join branches b on b.id=x.branch_id where x.reference_id=tid and x.category='transfer')||' | ';
  -- M7 cancel after receive refused
  perform set_config('request.jwt.claims', json_build_object('sub',mahmoud,'role','authenticated')::text, true);
  begin perform public.cancel_money_transfer(tid, 'x'); out := out||'M7 CANCELLED AFTER RECEIVE!! | ';
  exception when others then out := out||'M7 cancel after receive refused ✓ | '; end;
  -- M9 limits
  perform set_config('request.jwt.claims', json_build_object('sub',mahmoud,'role','authenticated')::text, true);
  begin perform public.set_transfer_approval_limits(1, 1); out := out||'L0 MANAGER SET LIMIT!! | ';
  exception when others then out := out||'L0 manager cannot set limit ✓ | '; end;
  perform set_config('request.jwt.claims', json_build_object('sub',owner,'role','authenticated')::text, true);
  r := public.set_transfer_approval_limits(1000, 500); out := out||'limits '||r||' | ';
  perform set_config('request.jwt.claims', json_build_object('sub',mahmoud,'role','authenticated')::text, true);
  select coalesce(sum(case when x.type='income' then x.amount else -x.amount end),0) into v0 from treasury x where x.branch_id=sk and x.payment_method='instapay';
  tid := public.transfer_treasury_atomic(sk, am, 1500, 'كبير', 'instapay', 0, null, null, true, null, '01018232539', 'none', 0);
  select coalesce(sum(case when x.type='income' then x.amount else -x.amount end),0) into v from treasury x where x.branch_id=sk and x.payment_method='instapay';
  select id into req from approval_requests where entity_id=tid;
  out := out||'M9 waiting='||(select approval_status from treasury_transfers where id=tid)||' till Δ='||(v-v0)||' req='||(req is not null)||' owner notified='||(select count(*) from notifications where related_entity_id=req)||' | ';
  perform set_config('request.jwt.claims', json_build_object('sub',nour,'role','authenticated')::text, true);
  begin perform public.receive_treasury_transfer(tid, 1500, null); out := out||'RECEIVED WAITING!! | ';
  exception when others then out := out||'receive waiting refused ✓ | '; end;
  perform set_config('request.jwt.claims', json_build_object('sub',mahmoud,'role','authenticated')::text, true);
  begin update approval_requests set status='approved' where id=req; out := out||'MANAGER APPROVED!! | ';
  exception when others then out := out||'manager approve refused ✓ | '; end;
  perform set_config('request.jwt.claims', json_build_object('sub',owner,'role','authenticated')::text, true);
  update approval_requests set status='approved' where id=req;
  select coalesce(sum(case when x.type='income' then x.amount else -x.amount end),0) into v from treasury x where x.branch_id=sk and x.payment_method='instapay';
  out := out||'approved → till Δ='||(v-v0)||' status='||(select approval_status from treasury_transfers where id=tid)||' | ';
  perform set_config('request.jwt.claims', json_build_object('sub',mahmoud,'role','authenticated')::text, true);
  begin perform public.edit_money_transfer(tid, 3000, 'none', 0, 'x'); out := out||'EDIT ABOVE LIMIT OK!! | ';
  exception when others then out := out||'edit above limit refused ✓ | '; end;
  tid2 := public.transfer_treasury_atomic(sk, am, 2000, 'كبير 2', 'instapay', 0, null, null, true, null, '01018232539', 'none', 0);
  perform set_config('request.jwt.claims', json_build_object('sub',owner,'role','authenticated')::text, true);
  update approval_requests set status='rejected', admin_note='لأ' where entity_id=tid2;
  select coalesce(sum(case when x.type='income' then x.amount else -x.amount end),0) into v from treasury x where x.branch_id=sk and x.payment_method='instapay';
  out := out||'refused status='||(select approval_status from treasury_transfers where id=tid2)||' till Δ still='||(v-v0)||' | ';
  perform set_config('request.jwt.claims', json_build_object('sub',mahmoud,'role','authenticated')::text, true);
  tid2 := public.transfer_treasury_atomic(sk, am, 1200, 'كبير 3', 'instapay', 0, null, null, true, null, '01018232539', 'none', 0);
  perform public.cancel_money_transfer(tid2, 'مش محتاجه');
  out := out||'cancel waiting → req='||(select status::text from approval_requests where entity_id=tid2)||' | ';
  -- owner over limit goes straight
  perform set_config('request.jwt.claims', json_build_object('sub',owner,'role','authenticated')::text, true);
  tid2 := public.transfer_treasury_atomic(sk, am, 5000, 'المالك', 'instapay', 0, null, null, true, null, '01018232539', 'none', 0);
  out := out||'owner over limit status='||coalesce((select approval_status from treasury_transfers where id=tid2),'direct')||' | ';

  -- GOODS
  select p.id, p.quantity into pid, q0 from products p where p.branch_id=sk and p.quantity >= 3 and coalesce(nullif(p.avg_cost,0),p.cost_price,0) between 50 and 400 order by p.quantity desc limit 1;
  select coalesce(sum(quantity_remaining),0) into b0 from product_batches where product_id=pid;
  perform set_config('request.jwt.claims', json_build_object('sub',owner,'role','authenticated')::text, true);
  perform public.set_transfer_approval_limits(1000, 0);
  perform set_config('request.jwt.claims', json_build_object('sub',cashier,'role','authenticated')::text, true);
  begin perform public.transfer_stock_multi_atomic(sk, sh, jsonb_build_array(jsonb_build_object('product_id',pid,'quantity',1)), 'x', null); out := out||'G1 CASHIER SENT GOODS!! | ';
  exception when others then out := out||'G1 cashier goods refused ✓ | '; end;
  perform set_config('request.jwt.claims', json_build_object('sub',mahmoud,'role','authenticated')::text, true);
  g := public.transfer_stock_multi_atomic(sk, sh, jsonb_build_array(jsonb_build_object('product_id',pid,'quantity',2)), 'تجربة', null);
  select id into tid from stock_transfers where group_id=g;
  select quantity into q1 from products where id=pid;
  out := out||'G2 sent 2 qty '||q0||'→'||q1||' notified='||coalesce((select string_agg(p.name,'، ') from notifications x join profiles p on p.id=x.user_id where x.related_entity_id=tid),'-')||' | ';
  perform public.edit_stock_transfer(tid, 1, 'واحدة بس');
  select quantity into q1 from products where id=pid;
  out := out||'G3 edit 2→1 qty='||q1||' | ';
  perform set_config('request.jwt.claims', json_build_object('sub',taha,'role','authenticated')::text, true);
  r := public.partial_confirm_transfer(tid, 1);
  select coalesce(sum(quantity_remaining),0) into b1 from product_batches where product_id=pid;
  out := out||'G4 taha received '||r||' sender batches '||b0||'→'||b1||' | ';
  perform set_config('request.jwt.claims', json_build_object('sub',mahmoud,'role','authenticated')::text, true);
  g := public.transfer_stock_multi_atomic(sk, sh, jsonb_build_array(jsonb_build_object('product_id',pid,'quantity',1)), 'تجربة 2', null);
  select coalesce(sum(quantity_remaining),0) into b0 from product_batches where product_id=pid;
  perform public.cancel_stock_transfer_group(g, 'غلط');
  select quantity into q1 from products where id=pid; select coalesce(sum(quantity_remaining),0) into b1 from product_batches where product_id=pid;
  out := out||'G5 cancel qty='||q1||' batches '||b0||'→'||b1||' status='||(select string_agg(status::text,',') from stock_transfers where group_id=g)||' | ';
  -- goods over limit
  perform set_config('request.jwt.claims', json_build_object('sub',owner,'role','authenticated')::text, true);
  perform public.set_transfer_approval_limits(1000, 10);
  perform set_config('request.jwt.claims', json_build_object('sub',mahmoud,'role','authenticated')::text, true);
  select quantity into q0 from products where id=pid;
  g := public.transfer_stock_multi_atomic(sk, sh, jsonb_build_array(jsonb_build_object('product_id',pid,'quantity',1)), 'كبير', null);
  select quantity into q1 from products where id=pid;
  out := out||'G6 awaiting='||(select string_agg(status::text,',') from stock_transfers where group_id=g)||' qty unchanged='||(q0=q1)||' | ';
  perform set_config('request.jwt.claims', json_build_object('sub',taha,'role','authenticated')::text, true);
  begin perform public.partial_confirm_transfer((select id from stock_transfers where group_id=g), 1); out := out||'RECEIVED AWAITING!! | ';
  exception when others then out := out||'receive awaiting refused ✓ | '; end;
  perform set_config('request.jwt.claims', json_build_object('sub',owner,'role','authenticated')::text, true);
  update approval_requests set status='approved' where entity_id=g;
  select quantity into q1 from products where id=pid;
  out := out||'G7 approved → '||(select string_agg(status::text,',') from stock_transfers where group_id=g)||' qty '||q0||'→'||q1||' | ';
  -- purge
  perform set_config('request.jwt.claims', json_build_object('sub',mahmoud,'role','authenticated')::text, true);
  begin perform public.purge_document_log('مسح'); out := out||'MANAGER PURGED!! | ';
  exception when others then out := out||'purge by manager refused ✓ | '; end;
  perform set_config('request.jwt.claims', json_build_object('sub',owner,'role','authenticated')::text, true);
  r := public.purge_document_log('مسح'); out := out||'owner purge '||r||' left='||(select count(*) from document_events)||' | ';
  out := out||'exposed='||(select count(*) from public.security_exposed_definer_functions());
  for s in select * from _seq loop perform setval(format('%I.%I', s.schemaname, s.sequencename), s.last_value); end loop;
  raise exception 'DRY %', out;
end $dry$;
