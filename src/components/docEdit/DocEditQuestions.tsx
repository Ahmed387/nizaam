import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Undo2 } from "lucide-react";
import { formatEGP } from "@/lib/format";
import { calculateFee, loadAllPaymentMethods, loadTransferFees, type PaymentMethodOption, type TransferFee } from "@/lib/paymentMethods";
import type { ExcessChoice, ReturnAction } from "@/lib/documentEdit";

/**
 * The two questions before a document edit is sent (0141):
 *  1) the document has active returns → «الغي المرتجع وكمّل / سيب المرتجع وكمّل / عدّل المرتجع / رجوع», with what
 *     keeping it does to the stock and the account;
 *  2) the new total is below what was paid → «يفضل على حسابه» or «يرجعله دلوقتي» from a vessel (the one he paid with
 *     is suggested) with its fee.
 * `ask()` resolves with the answers, or null when the user went back.
 */
export type AskReturns = { numbers: string[]; effects: string[]; onEditReturn?: () => void };
export type AskExcess = { amount: number; defaultMethod?: string | null; partyWord?: string };
export type Answers = { returnAction?: ReturnAction; excess?: ExcessChoice };

export function useDocEditQuestions() {
  const [step, setStep] = useState<null | "returns" | "excess">(null);
  const [opts, setOpts] = useState<{ returns?: AskReturns; excess?: AskExcess }>({});
  const answers = useRef<Answers>({});
  const resolver = useRef<((a: Answers | null) => void) | null>(null);
  const [method, setMethod] = useState("cash");
  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  const [fees, setFees] = useState<TransferFee[]>([]);

  useEffect(() => {
    if (step !== "excess") return;
    loadAllPaymentMethods().then((m) => setMethods(m.filter((x) => x.is_enabled !== false))).catch(() => setMethods([]));
    loadTransferFees().then(setFees).catch(() => setFees([]));
  }, [step]);

  const finish = (a: Answers | null) => { setStep(null); resolver.current?.(a); resolver.current = null; };
  const next = (from: "returns" | "excess") => {
    if (from === "returns" && opts.excess && opts.excess.amount > 0) { setStep("excess"); return; }
    finish(answers.current);
  };

  const ask = useCallback((o: { returns?: AskReturns; excess?: AskExcess }): Promise<Answers | null> => {
    answers.current = {};
    setOpts(o);
    setMethod(o.excess?.defaultMethod || "cash");
    const first = o.returns && o.returns.numbers.length > 0 ? "returns" : o.excess && o.excess.amount > 0 ? "excess" : null;
    if (!first) return Promise.resolve({});
    setStep(first);
    return new Promise((res) => { resolver.current = res; });
  }, []);

  const fee = opts.excess ? calculateFee(method, opts.excess.amount, fees) : 0;
  const word = opts.excess?.partyWord ?? "العميل";

  const dialog = (
    <>
      <Dialog open={step === "returns"} onOpenChange={(o) => { if (!o) finish(null); }}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-warning" /> المستند ده عليه مرتجع</DialogTitle>
            <DialogDescription>
              عليه {opts.returns?.numbers.join("، ")}. هتلغي المرتجع ولا هتسيبه؟
            </DialogDescription>
          </DialogHeader>
          {(opts.returns?.effects.length ?? 0) > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm space-y-1">
              <div className="font-semibold">لو سبت المرتجع:</div>
              {opts.returns!.effects.map((e) => <div key={e}>• {e}</div>)}
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2 sm:justify-start">
            <Button onClick={() => { answers.current.returnAction = "cancel"; next("returns"); }}>الغي المرتجع وكمّل</Button>
            <Button variant="secondary" onClick={() => { answers.current.returnAction = "keep"; next("returns"); }}>سيب المرتجع وكمّل</Button>
            {opts.returns?.onEditReturn && (
              <Button variant="outline" onClick={() => { finish(null); opts.returns?.onEditReturn?.(); }}>عدّل المرتجع</Button>
            )}
            <Button variant="ghost" onClick={() => finish(null)}><Undo2 className="w-4 h-4 ml-1" /> رجوع</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={step === "excess"} onOpenChange={(o) => { if (!o) finish(null); }}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>{word} دافع أكتر من الإجمالي الجديد</DialogTitle>
            <DialogDescription>
              الفرق {formatEGP(opts.excess?.amount ?? 0)}. يفضل على حسابه، ولا يرجعله دلوقتي؟
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>لو هيرجعله دلوقتي: من أنهي وعاء</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(methods.length ? methods : [{ value: "cash", label: "نقدي", is_builtin: true, is_enabled: true }]).map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}{m.value === opts.excess?.defaultMethod ? " (اللي دفع بيه)" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fee > 0 && <p className="text-xs text-muted-foreground">عمولة الوعاء ده: {formatEGP(fee)}</p>}
          </div>
          <DialogFooter className="flex-wrap gap-2 sm:justify-start">
            <Button variant="secondary" onClick={() => { answers.current.excess = { action: "keep", amount: opts.excess!.amount }; finish(answers.current); }}>
              يفضل على حسابه
            </Button>
            <Button onClick={() => { answers.current.excess = { action: "refund", amount: opts.excess!.amount, method }; finish(answers.current); }}>
              يرجعله {formatEGP(opts.excess?.amount ?? 0)} دلوقتي
            </Button>
            <Button variant="ghost" onClick={() => finish(null)}>رجوع</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  return { ask, dialog };
}
