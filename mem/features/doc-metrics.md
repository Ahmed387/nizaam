---
name: Document screen card rules
description: Approved FIFO for purchase invoice remaining; payment-voucher card split (suppliers / operating / internal transfers & refunds)
type: feature
---
- Sale AND purchase invoice paid/remaining: FIFO over the contact's full branch statement (opening balance first; direct payments, manual/linked vouchers, return credit; customer/supplier sides netted; only movements up to the period end). Approved by user; must reconcile 100% with statement balances.
- Payment vouchers screen shows ALL payment vouchers. Cards: إجمالي المدفوعات = all active; سداد موردين; تحويلات داخلية ومرتجع (customer_return, any transfer category, party=customer, staff advances, legacy names with تحويل/مرتجع/سلف/مدفوعات لعملاء); مصاريف تشغيلية = the rest only. Never count transfers, refunds or staff advances as operating.
