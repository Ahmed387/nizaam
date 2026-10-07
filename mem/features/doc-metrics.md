---
name: Document screen card rules
description: Approved FIFO for purchase invoice remaining; payment-voucher card split (suppliers / operating / internal transfers & refunds)
type: feature
---
- Purchase invoice paid/remaining: supplier payment vouchers per supplier+branch allocated FIFO (oldest invoice_date first). Approved by user.
- Payment vouchers screen shows ALL payment vouchers. Cards: إجمالي المدفوعات = all active; سداد موردين; تحويلات داخلية ومرتجع (customer_return, any transfer category, party=customer, staff advances, legacy names with تحويل/مرتجع/سلف/مدفوعات لعملاء); مصاريف تشغيلية = the rest only. Never count transfers, refunds or staff advances as operating.
