import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AdminLayout } from "@/components/layout/Layouts";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Send, Loader2, RotateCcw, Database, User2 } from "lucide-react";
import { edgeErrorMessage } from "@/lib/edgeError";

type Msg = { role: "user" | "assistant"; content: string; steps?: { query: string; rows: number; error?: string }[] };

const STORE_KEY = "nizam.askme.conversation.v1";

const SUGGESTIONS = [
  "إيه صافي الربح الشهر ده؟",
  "أعلى 10 منتجات مبيعاً آخر 30 يوم",
  "المصروفات حسب البند لشهر يوليو",
  "مين العملاء اللي عليهم مديونية؟",
  "المخزون الراكد اللي مباعش من شهرين",
  "مقارنة مبيعات الفروع الشهر ده",
];

export default function AskMe() {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Msg[]>(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? (JSON.parse(raw) as Msg[]) : [];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(messages.slice(-40)));
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    taRef.current?.focus();
  }, []);

  const empty = messages.length === 0;

  async function send(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ask-me", {
        body: { messages: next.map((m) => ({ role: m.role, content: m.content })) },
      });
      const askErr = await edgeErrorMessage(error, data);
      if (askErr) throw new Error(askErr);
      setMessages((m) => [...m, { role: "assistant", content: (data as any).content || "…", steps: (data as any).steps }]);
    } catch (e: any) {
      const msg = e?.message ?? "حصل خطأ غير متوقع";
      toast({ variant: "destructive", title: "معلش، مقدرتش أجاوب", description: msg });
      setMessages((m) => [...m, { role: "assistant", content: `⚠️ ${msg}` }]);
    } finally {
      setLoading(false);
      setTimeout(() => taRef.current?.focus(), 50);
    }
  }

  const header = useMemo(
    () => (
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-l from-primary/15 via-primary/5 to-transparent p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
            <Sparkles className="h-7 w-7" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold sm:text-3xl">اسألني</h1>
            <p className="text-sm text-muted-foreground">
              مساعدك الذكي اللي شايف كل بيانات الشركة — اسأل عن الأرباح، التكاليف، المخزون، الموظفين… وهيجيبلك الرقم الصح فوراً.
            </p>
          </div>
          {messages.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="ms-auto shrink-0"
              onClick={() => {
                setMessages([]);
                localStorage.removeItem(STORE_KEY);
              }}
            >
              <RotateCcw className="ms-1 h-4 w-4" /> محادثة جديدة
            </Button>
          )}
        </div>
      </div>
    ),
    [messages.length],
  );

  return (
    <AdminLayout>
    <div className="mx-auto flex h-[calc(100dvh-12rem)] w-full max-w-5xl flex-col gap-4" dir="rtl">
      {header}

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
          {empty && (
            <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
              <div className="grid h-20 w-20 animate-pulse place-items-center rounded-3xl bg-primary/10 text-primary">
                <Sparkles className="h-10 w-10" />
              </div>
              <div>
                <p className="text-lg font-semibold">اسألني أي حاجة عن شركتك</p>
                <p className="text-sm text-muted-foreground">اكتب سؤالك بالعامية عادي، أو ابدأ بواحد من دول:</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border bg-card px-4 py-2 text-sm transition-colors hover:border-primary hover:bg-primary/10"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-start gap-2">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted">
                  <User2 className="h-4 w-4" />
                </div>
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-primary-foreground">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="flex gap-2">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="prose prose-sm max-w-none dark:prose-invert prose-table:text-sm prose-th:text-start prose-td:text-start">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  </div>
                  {!!m.steps?.length && (
                    <details className="text-xs text-muted-foreground">
                      <summary className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground">
                        <Database className="h-3.5 w-3.5" /> مصدر البيانات ({m.steps.length} استعلام)
                      </summary>
                      <div className="mt-2 space-y-2">
                        {m.steps.map((s, k) => (
                          <div key={k} className="rounded-lg border bg-muted/40 p-2">
                            <Badge variant={s.error ? "destructive" : "secondary"} className="mb-1">
                              {s.error ? "خطأ" : `${s.rows} صف`}
                            </Badge>
                            <pre className="overflow-x-auto whitespace-pre-wrap text-[11px]" dir="ltr">
                              {s.query}
                            </pre>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </div>
            ),
          )}

          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              بدور في بيانات الشركة...
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t bg-muted/30 p-3">
          <div className="flex items-end gap-2">
            <Textarea
              ref={taRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              placeholder="اكتب سؤالك… (Enter للإرسال)"
              className="max-h-40 min-h-[44px] resize-none bg-background"
            />
            <Button size="icon" className="h-11 w-11 shrink-0" disabled={loading || !input.trim()} onClick={() => send(input)}>
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 rotate-180" />}
            </Button>
          </div>
        </div>
      </Card>
    </div>
    </AdminLayout>
  );
}
