# Project Memory

## Core
RTL Arabic ERP (نظام). Golden Matrix: 8 قواعد + قاعدة STOP & ASK قبل أي تغيير غير محدد صراحةً.
لا حركات مالية تجريبية على بيانات حقيقية — المستخدم يختبر بنفسه من الشاشة.
Indexes on big tables (invoices, vouchers…) ONLY via CREATE INDEX CONCURRENTLY (own migration, no transaction). No blocking DDL.

## Memories
- [Sacred red-line counts](mem://features/red-line-counts) — الأرقام المحمية للتحقق: 11,842 فاتورة، 26,092 سند، 59 إيداع، 783 مصروف، 1,776 منتج
- [Document cards](mem://features/doc-metrics) — FIFO purchase remaining approved; payment vouchers split suppliers/operating/internal
