// UI test of the product photos page (summary, link, biggest + delete, missing fix) against the local build, database and storage faked in the browser.
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

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const img = (b, n) => `${T}/${b}/${n}.webp`;
const PRODUCTS = [
  { id: "p1", name: "غسالة توشيبا 9 كيلو", sku: "WM9", image: img(B1, "wm9"), branch_id: B1 }, { id: "p2", name: "غسالة توشيبا 9 كيلو", sku: "WM9", image: img(B1, "wm9"), branch_id: B2 },
  { id: "p3", name: "شاشة سامسونج 55", sku: "TV55", image: img(B1, "tv55"), branch_id: B1 }, { id: "p4", name: "شاشة سامسونج 55", sku: "TV55", image: img(B1, "tv55"), branch_id: B2 },
  { id: "p5", name: "بوتاجاز يونيفرسال", sku: "ST1", image: img(B2, "st1"), branch_id: B2 },
  { id: "p6", name: "غسالة فريش دويتو 5Kg", sku: "FR5", image: null, branch_id: B1 }, { id: "p7", name: "غسالة فريش دويتو 5Kg", sku: "FR5", image: null, branch_id: B2 },
  { id: "p8", name: "مكواة راش برش", sku: "IR3", image: null, branch_id: B1 },
  { id: "p9", name: "ثلاجة شارب", sku: "FG1", image: img(B1, "gone"), branch_id: B1 },
];
const FILES = [{ path: img(B1, "wm9"), size: 110000 }, { path: img(B1, "tv55"), size: 98000 }, { path: img(B2, "st1"), size: 20000 }];
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub, role: "authenticated", aud: "authenticated", exp: 4102444800 })}.sig`;

function makeDb() {
  return {
    calls: [], uploads: [], removed: [], files: JSON.parse(JSON.stringify(FILES)),
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
    products: PRODUCTS,
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
    if (path === "/storage/v1/object/list/product-images") {
      const b = req.postDataJSON(); const pre = b.prefix.replace(/\/$/, "");
      const kids = new Map();
      db.files.forEach((f) => { if (!f.path.startsWith(pre + "/")) return; const rest = f.path.slice(pre.length + 1); const seg = rest.split("/")[0];
        kids.set(seg, rest.includes("/") ? { name: seg, id: null, metadata: null } : { name: seg, id: "x" + seg, metadata: { size: f.size } }); });
      return json([...kids.values()].slice(b.offset || 0, (b.offset || 0) + (b.limit || 100)));
    }
    if (path === "/storage/v1/object/product-images" && req.method() === "DELETE") {
      const b = req.postDataJSON(); db.removed.push(...b.prefixes); db.files = db.files.filter((f) => !b.prefixes.includes(f.path)); return json([]);
    }
    if (path.startsWith("/storage/v1/object/sign/product-images") && req.method() === "POST") {
      const b = req.postDataJSON(); return json((b.paths || []).map((p) => ({ path: p, signedURL: "/object/sign/product-images/" + p + "?token=t", error: null })));
    }
    if (path.startsWith("/storage/v1/object/sign/")) return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
    if (path.startsWith("/storage/v1/object/product-images/")) {
      const buf = req.postDataBuffer();
      db.files.push({ path: decodeURIComponent(path.replace("/storage/v1/object/product-images/", "")), size: buf ? buf.length : 0 });
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
      if (name === "update_product_details") { const p = db.products.find((x) => x.id === body.p_id); if (p) p.image = body.p_patch.image || null; return json(null); }
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
  await page.goto(`${BASE}/admin/catalog?tab=images`); await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByLabel("ملخص الصور").waitFor({ timeout: 20000 });
  const sum = (await page.getByLabel("ملخص الصور").innerText()).replace(/\s+/g, " ");
  check("الملخص: 3 صور", /صور مرفوعة\s*3/.test(sum), sum);
  check("أكبر صورة 107 KB واسم منتجها", /107 KB/.test(sum) && /غسالة توشيبا/.test(sum));
  check("منتجات من غير صورة = 2 (3 في كل الفروع)", /من غير صورة\s*2/.test(sum) && /3 في كل الفروع/.test(sum));
  check("صورتها مفقودة = 1", /مفقودة\s*1/.test(sum));
  await page.screenshot({ path: `${OUT}/images-manager.png`, fullPage: true });

  // search
  const list = page.getByRole("listbox", { name: "المنتجات" });
  check("الليستة فيها اللي من غير صورة بس", (await list.getByRole("option").count()) === 2);
  await page.getByLabel("ابحث عن منتج").fill("فريش");
  check("البحث بحرف من الاسم بيضيّق", (await list.getByRole("option").count()) === 1);
  await page.getByLabel("ابحث عن منتج").fill("ir3");
  check("البحث بالكود", (await list.getByRole("option").count()) === 1 && /مكواة/.test(await list.innerText()));
  await page.getByLabel("ابحث عن منتج").fill("فريش");
  await list.getByRole("option").first().click();
  await page.setInputFiles('input[aria-label="اختار صورة المنتج"]', process.env.PHOTO);
  await page.getByText(/بقت/).waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${OUT}/images-link.png`, fullPage: true });
  const ups0 = db.uploads.length;
  await page.getByRole("button", { name: /^اربط$/ }).click();
  await page.waitForTimeout(1500);
  const up = db.uploads[ups0];
  const links = db.calls.filter((c) => c.rpc === "update_product_details" && c.body.p_patch.image);
  check("الصورة اترفعت مصغّرة WebP ≤ 200 KB", up && /webp/.test(up.type) && up.bytes <= 200 * 1024, up ? `${Math.round(up.bytes / 1024)} KB ${up.type}` : "no upload");
  check("اتربطت على المنتج في الفرعين", links.length === 2 && links.every((c) => ["p6", "p7"].includes(c.body.p_id)));
  check("المنتج خرج من ليستة من غير صورة", (await page.getByLabel("ملخص الصور").innerText()).replace(/\s+/g, " ").match(/من غير صورة\s*1/) != null);

  // biggest + multi delete
  await page.getByRole("checkbox", { name: /اختار صورة غسالة توشيبا/ }).click();
  await page.getByRole("checkbox", { name: /اختار صورة شاشة سامسونج/ }).click();
  const bar = await page.getByText(/مختار 2 صورة/).innerText();
  check("شريط المختار: 2 صورة على 4 منتج", /على 4 منتج/.test(bar), bar.replace(/\s+/g, " "));
  await page.getByRole("button", { name: /امسح المختار/ }).click();
  const dlg = (await page.getByRole("alertdialog").innerText()).replace(/\s+/g, " ");
  check("تأكيد واحد بالأسماء", /غسالة توشيبا/.test(dlg) && /شاشة سامسونج/.test(dlg) && /مش هترجع/.test(dlg), dlg.slice(0, 160));
  await page.screenshot({ path: `${OUT}/images-delete.png`, fullPage: true });
  const before = db.calls.length;
  await page.getByRole("button", { name: "أيوه امسح" }).click();
  await page.waitForTimeout(1500);
  const after = db.calls.slice(before).filter((c) => c.rpc === "update_product_details");
  check("المنتجات اتفضّت (4)", after.length === 4 && after.every((c) => c.body.p_patch.image === ""));
  check("الملفين اتمسحوا من التخزين", db.removed.includes(img(B1, "wm9")) && db.removed.includes(img(B1, "tv55")));

  // missing fix
  const fixBtn = page.getByRole("button", { name: /صلّحهم/ });
  check("زرار صلّحهم ظاهر", await fixBtn.isVisible());
  await fixBtn.click(); await page.waitForTimeout(1200);
  check("صلّحهم فضّى الثلاجة بس", db.products.find((p) => p.id === "p9").image === null && /مفقودة\s*0/.test((await page.getByLabel("ملخص الصور").innerText()).replace(/\s+/g, " ")));
  const errs = db.calls.filter((c) => c.pageerror);
  if (errs.length) check("مفيش أخطاء في الصفحة", false, errs.map((x) => x.pageerror).join(" | "));
  await page.screenshot({ path: `${OUT}/images-after.png`, fullPage: true });
  await ctx.close(); await browser.close();
  console.log(results.join("\n"));
})();
