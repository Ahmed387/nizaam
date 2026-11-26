// Harness for e2e/settlement.ui.cjs: the real «تسوية بدون فلوس» / «تسوية برصيد» dialogs, server mocked by the test.
import "@/index.css";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { SettleWithoutMoneyDialog } from "@/components/contact/SettleWithoutMoneyButton";
import { SettleToBalanceDialog } from "@/components/contact/SettleToBalanceButton";

const which = new URLSearchParams(location.search).get("d") ?? "swm";
const sides = (new URLSearchParams(location.search).get("sides") ?? "customer").split(",") as ("customer" | "supplier")[];
function App() {
  const p = { contactId: "c1", contactName: "كريم عاطف", side: sides[0], sides, defaultBranch: null, open: true, onOpenChange: () => {} };
  return <>{which === "swm" ? <SettleWithoutMoneyDialog {...p} /> : <SettleToBalanceDialog {...p} />}<Toaster /></>;
}
createRoot(document.getElementById("root")!).render(<BrowserRouter><App /></BrowserRouter>);
