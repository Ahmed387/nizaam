// UI test of «رفع صور المنتجات بالجملة» against the local build, database and storage faked in the browser.
// Run: npm run build && npx vite preview --host 127.0.0.1 --port 4173, then: node e2e/permissions.ui.cjs
const { chromium } = require("playwright");
const fs = require("fs");
const OUT = process.env.OUT_DIR || __dirname;
const BASE = "http://127.0.0.1:4173";
const SB = "https://kkfiplnucefytutlwaiz.supabase.co";
const REF = "kkfiplnucefytutlwaiz";
const T = "5316fbfe-b862-4c91-b48b-1d81c8aa5a71";
const OWNER = "85c76e60-3d27-4a99-8cd7-c8f8b39d914a", CASH = "a3174891-0000-0000-0000-000000000001", MGR = "a3174891-0000-0000-0000-000000000002";
const B1 = "1329f6cc-0000-0000-0000-000000000001", B2 = "1329f6cc-0000-0000-0000-000000000002";

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub, role: "authenticated", aud: "authenticated", exp: 4102444800 })}.sig`;

function makeDb() {
  return {
    calls: [], uploads: [],
    profiles: [
      { id: OWNER, name: "احمد ناصر", username: "an.ayoub98", tenant_id: T, is_active: true },
      { id: CASH, name: "mohayassr07", username: "mohayassr07", tenant_id: T, is_active: true },
      { id: MGR, name: "مدير الفرع", username: "mgr", tenant_id: T, is_active: true },
    ],
    user_roles: [
      { user_id: OWNER, role: "owner", tenant_id: T }, { user_id: OWNER, role: "admin", tenant_id: T },
      { user_id: CASH, role: "cashier", tenant_id: T }, { user_id: MGR, role: "branch_manager", tenant_id: T },
    ],
    branch_users: [
      { user_id: CASH, branch_id: B1, access_level: "manage", tenant_id: T },
      { user_id: CASH, branch_id: B2, access_level: "manage", tenant_id: T },
      { user_id: MGR, branch_id: B1, access_level: "manage", tenant_id: T },
    ],
    branches: [
      { id: B1, name: "معرض سكة تلة", code: "B1", tenant_id: T, is_active: true, is_system: false, platform_paused: false },
      { id: B2, name: "معرض عبدالمنعم الغربى", code: "B2", tenant_id: T, is_active: true, is_system: false, platform_paused: false },
    ],
    tenants: [{ id: T, name: "A & N", slug: "an", is_suspended: false, owner_user_id: OWNER, setup_completed: true }],
    employees: [{ id: "e-cash", user_id: CASH, tenant_id: T, is_active: true }],
    role_permissions: [],
    user_permissions: [{ user_id: CASH, tenant_id: T, permission_key: "part.dashboard.gross_profit_today.view", allowed: false }],
    permission_templates: [],
    products: JSON.parse(fs.readFileSync(process.env.PRODUCTS_JSON, "utf8")),
  };
}

function filt(rows, url) {
  for (const [k, v] of url.searchParams) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(k)) continue;
    const m = /^eq\.(.*)$/.exec(v);
    if (m) rows = rows.filter((r) => r[k] === undefined || String(r[k]) === m[1]);
  }
  return rows;
}

async function open(browser, db, me) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ar-EG" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => db.calls.push({ pageerror: String(e).slice(0, 300) }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route(`${SB}/**`, async (route) => {
    const req = route.request(); const url = new URL(req.url()); const path = url.pathname;
    const json = (d, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(d) });
    if (path.startsWith("/auth/v1/user")) return json({ id: me, aud: "authenticated", app_metadata: {}, user_metadata: {} });
    if (path.startsWith("/auth/v1/")) return json({});
    if (path.startsWith("/functions/v1/")) return json({ ok: true });
    if (path.startsWith("/storage/v1/object/product-images/")) {
      const buf = req.postDataBuffer();
      db.uploads.push({ path: decodeURIComponent(path.replace("/storage/v1/object/product-images/", "")), bytes: buf ? buf.length : 0, type: ((buf ? buf.toString("latin1", 0, 600) : "").match(/Content-Type: (image\/[a-z]+)/i) || [])[1] || req.headers()["content-type"] || "" });
      return json({ Key: path });
    }
    if (path.startsWith("/rest/v1/rpc/")) {
      const name = path.split("/").pop(); let body = {}; try { body = req.postDataJSON() || {}; } catch {}
      db.calls.push({ rpc: name, body });
      if (name === "save_user_permissions") {
        db.user_permissions = db.user_permissions.filter((r) => r.user_id !== body.p_user)
          .concat(body.p_rows.map((r) => ({ user_id: body.p_user, tenant_id: T, permission_key: r.key, allowed: r.allowed, branch_id: r.branch ?? null })));
        return json(body.p_rows.length);
      }
      if (name === "branch_limit_status") return json({ limit: 3, used: 2, at_limit: false, pending: null });
      return json(null);
    }
    if (path.startsWith("/rest/v1/")) {
      const table = path.split("/").pop(); const method = req.method();
      if (method !== "GET" && method !== "HEAD") { let body = null; try { body = req.postDataJSON(); } catch {} db.calls.push({ table, method, body }); return json([]); }
      let rows = filt(db[table] ?? [], url);
      // the real API embeds the branch in branch_users («branches(*)»)
      if (table === "branch_users" && (url.searchParams.get("select") || "").includes("branches(")) rows = rows.map((r) => ({ ...r, branches: db.branches.find((b) => b.id === r.branch_id) }));
      const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
      if (single) return rows.length ? json(rows[0]) : route.fulfill({ status: 406, contentType: "application/json", body: JSON.stringify({ code: "PGRST116", message: "0 rows" }) });
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` }, body: JSON.stringify(rows) });
    }
    return json({});
  });
  const sess = { access_token: jwt(me), refresh_token: "r", token_type: "bearer", expires_in: 31536000, expires_at: 4102444800, user: { id: me, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} } };
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${REF}-auth-token`, JSON.stringify(sess)]);
  return { ctx, page };
}

const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`);
(async () => {
  const browser = await chromium.launch();
  const db = makeDb();
  const { ctx, page } = await open(browser, db, OWNER);
  await page.goto(`${BASE}/admin/catalog?tab=images`); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(800);
  check("تاب «صور المنتجات» موجود", await page.getByRole("tab", { name: "صور المنتجات" }).isVisible().catch(() => false));
  await page.setInputFiles('input[aria-label="اختار الصور أو ملف zip"]', process.env.ZIPS.split(","));
  await page.getByText("صور اتقرت").waitFor({ timeout: 60000 });
  const summary = await page.getByLabel("ملخص الرفع").innerText();
  check("قرا الصور وربطها", /ليها منتج/.test(summary), summary.replace(/\s+/g, " "));
  const t0 = Date.now();
  await page.getByRole("button", { name: /صغّر وارفع/ }).click();
  await page.getByText(/فاضل 0/).waitFor({ timeout: 600000 });
  const secs = Math.round((Date.now() - t0) / 1000);
  const ups = db.uploads;
  const total = ups.reduce((s, u) => s + u.bytes, 0);
  const max = Math.max(...ups.map((u) => u.bytes));
  check(`اترفع ${ups.length} صورة في ${secs} ثانية`, ups.length > 0);
  check("كلهم WebP", ups.every((u) => /image\/webp/.test(u.type)), [...new Set(ups.map((u) => u.type))].join(","));
  check(`ولا صورة فوق 200 KB (أكبر واحدة ${Math.round(max / 1024)} KB)`, max <= 200 * 1024);
  check(`الحجم كله ${(total / 1024 / 1024).toFixed(1)} ميجا`, true);
  const known = new Set(db.products.map((p) => p.image));
  check("كل صورة راحت على نفس المكان اللي منتجها مستنيه", ups.every((u) => known.has(u.path)));
  const rpcs = db.calls.filter((c) => c.rpc === "update_product_details").length;
  check("المنتجات ما اتعدلتش (الصور راحت لمكانها)", rpcs === 0, `update_product_details × ${rpcs}`);
  const errs = db.calls.filter((c) => c.pageerror);
  if (errs.length) check("مفيش أخطاء في الصفحة", false, errs.map((x) => x.pageerror).join(" | "));
  await page.screenshot({ path: `${OUT}/images-bulk.png`, fullPage: false });
  fs.writeFileSync(`${OUT}/images-uploads.json`, JSON.stringify(ups));
  await ctx.close(); await browser.close();
  console.log(results.join("\n"));
})();
