/* ═══════════════════════════════════════════════════════════
   Toby ⇄ TabX validation tests
   Run:  node tests/toby.test.js [path-to-toby-fixture.json]
   Uses the real background.js service worker via a chrome stub,
   so the whole import/export message path is exercised.
   ═══════════════════════════════════════════════════════════ */
"use strict";

const fs = require("fs");
const path = require("path");

const EXT = path.join(__dirname, "..");
const FIXTURE = process.argv[2]
  || "/home/edree0x/Downloads/All In One-Sep 16 at 19_31.json";

const TobyFormat = require(path.join(EXT, "toby.js"));

/* ── tiny test runner ── */
let passed = 0, failed = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { passed++; console.log("  \u2713 " + name); }
  else { failed++; failures.push(name); console.log("  \u2717 " + name + (extra ? "  -> " + extra : "")); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), "got " + JSON.stringify(a) + " want " + JSON.stringify(b)); }

/* ── background harness: in-memory chrome.storage ── */
function makeBg() {
  const store = {};
  const chromeStub = {
    runtime: {
      onMessage: { addListener(cb) { chromeStub.__listener = cb; } },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      sendMessage: () => Promise.resolve(),
      getURL: (p) => "chrome-extension://test/" + p,
      lastError: null,
    },
    storage: {
      onChanged: { addListener() {} },
      local: {
        get(keys, cb) {
          let out = {};
          if (keys === null || keys === undefined) out = Object.assign({}, store);
          else if (Array.isArray(keys)) keys.forEach((k) => { if (k in store) out[k] = store[k]; });
          else if (typeof keys === "string") { if (keys in store) out[keys] = store[keys]; }
          else if (typeof keys === "object") Object.keys(keys).forEach((k) => { out[k] = (k in store) ? store[k] : keys[k]; });
          if (cb) { cb(out); return; }
          return Promise.resolve(out);
        },
        set(obj, cb) { Object.assign(store, JSON.parse(JSON.stringify(obj))); if (cb) cb(); return Promise.resolve(); },
        remove(keys, cb) {
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete store[k]);
          if (cb) cb(); return Promise.resolve();
        },
      },
    },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
    contextMenus: { create() {}, removeAll() {}, onClicked: { addListener() {} } },
    tabs: { create() {}, query(_q, cb) { if (cb) cb([]); }, sendMessage() {}, onUpdated: { addListener() {} }, onRemoved: { addListener() {} } },
    windows: { getCurrent(_o, cb) { if (cb) cb({ id: 1 }); } },
    permissions: { request(_p, cb) { if (cb) cb(true); } },
  };
  global.chrome = chromeStub;
  global.self = global;
  global.TobyFormat = TobyFormat; /* importScripts("toby.js") equivalent */

  const bgPath = path.join(EXT, "background.js");
  delete require.cache[require.resolve(bgPath)];
  global.importScripts = (...files) => files.forEach((f) => require(path.join(EXT, f)));
  require(bgPath);

  const send = (msg) => new Promise((resolve) => chromeStub.__listener(msg, {}, resolve));
  const userData = () => store[Object.keys(store).find((k) => k === "TabX_userData" || k.endsWith("_userData"))];
  const wsKey = (wsId) => Object.keys(store).find((k) => k === "TabX_ws_" + wsId || k.endsWith("_ws_" + wsId));
  const wait = () => new Promise((r) => setTimeout(r, 30));
  return { store, send, wait, userData: () => userData(), wsKey };
}

/* ═══════════════════════════════════════════════════════════ */
(async function main() {
  console.log("Fixture:", FIXTURE);
  const toby = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));

  console.log("\n[1] Format detection + validation");
  ok("detect(toby) === toby", TobyFormat.detect(toby) === "toby");
  eq("isNative({categories:[],tabData:[]})", TobyFormat.isNative({ categories: [], tabData: [] }), true);
  eq("detect(native)", TobyFormat.detect({ userData: {}, tabData: [] }), "native");
  eq("detect({})", TobyFormat.detect({}), "unknown");
  const v = TobyFormat.validate(toby);
  ok("fixture validates", v.ok && v.errors.length === 0);
  eq("stats.groups", v.stats.groups, toby.groups.length);
  eq("stats.lists", v.stats.lists, toby.groups.reduce((n, g) => n + g.lists.length, 0));
  eq("stats.cards", v.stats.cards, toby.groups.reduce((n, g) => n + g.lists.reduce((m, l) => m + l.cards.length, 0), 0));
  eq("stats.labels", v.stats.labels, Object.keys(toby.labels).length);

  console.log("\n[2] Toby -> native conversion");
  const conv = TobyFormat.toNative(toby, { name: "All In One", ownerId: "u1" });
  eq("categories == groups", conv.workspace.catData.length, toby.groups.length);
  eq("stacks == lists", conv.tabData.length, v.stats.lists);
  eq("tabs == cards", conv.tabData.reduce((n, g) => n + g.tabs.length, 0), v.stats.cards);
  const stripImp = (n) => { let s = n; for (;;) { const m = s.replace(/^Import\s*[-–—:]\s*/i, "").trim(); if (m === s) break; s = m; } return s; };
  eq("category names have Import prefix stripped",
    conv.workspace.catData.map((c) => c.name), toby.groups.map((g) => stripImp(g.name)));
  eq("original names preserved in cat.tobyName",
    conv.workspace.catData.map((c) => c.tobyName), toby.groups.map((g) => g.name));
  eq("no category still begins with 'Import'", conv.workspace.catData.every((c) => !/^import\s*[-–—:]/i.test(c.name)), true);
  ok("workspace default name marks the import", TobyFormat.toNative({ version: 4, groups: [{ name: "g", lists: [] }], labels: {} }).workspace.name === "Imported from Toby");
  eq("workspace default emoji", TobyFormat.toNative({ version: 4, groups: [{ name: "g", lists: [] }], labels: {} }).workspace.emoji, "📥");
  eq("group types preserved", conv.workspace.catData.map((c) => c.tobyType), toby.groups.map((g) => g.type));
  // ordering: category i has exactly its lists, in order
  let orderOk = true;
  toby.groups.forEach((g, gi) => {
    const stacks = conv.tabData.filter((s) => s.categoryID === conv.workspace.catData[gi].id);
    if (stacks.map((s) => s.title).join("|") !== g.lists.map((l) => l.title).join("|")) orderOk = false;
  });
  ok("group/list ordering preserved", orderOk);
  // card ordering + first card fields
  const firstList = conv.tabData[0], firstCards = toby.groups[0].lists[0].cards;
  eq("first list card order", firstList.tabs.map((t) => t.url), firstCards.map((c) => c.url));
  eq("card url->tab.url", firstList.tabs[0].url, firstCards[0].url);
  eq("card favIconUrl->tab.favIcon", firstList.tabs[0].favIcon, firstCards[0].favIconUrl);
  eq("customTitle wins for display", firstList.tabs[0].title, firstCards[0].customTitle || firstCards[0].title);
  eq("scraped original kept", firstList.tabs[0].tobyTitle, firstCards[0].title);

  console.log("\n[3] native -> Toby -> native round trip");
  const back = TobyFormat.fromNative({
    categories: conv.workspace.catData, tabData: conv.tabData,
    labels: conv.labelRegistry, wsPublic: false,
  });
  eq("round-trip deep equality", JSON.stringify(back), JSON.stringify(toby));
  eq("version preserved", back.version, toby.version);

  console.log("\n[4] Labels / labelIds");
  const listWithLabel = toby.groups.flatMap((g) => g.lists).find((l) => l.labelIds.length);
  const labelId = listWithLabel.labelIds[0];
  const convList = conv.tabData.find((s) => JSON.stringify(s.labelIds) === JSON.stringify(listWithLabel.labelIds));
  ok("labelIds preserved on stack", !!convList);
  ok("label title applied to tab.tags", convList.tabs.every((t) => t.tags.includes(toby.labels[labelId].title)));
  eq("label color preserved in registry", conv.labelRegistry[labelId].color, toby.labels[labelId].color);
  const backLabel = back.groups.flatMap((g) => g.lists).find((l) => l.labelIds.includes(labelId));
  ok("label round-trips to same list", !!backLabel);
  eq("label registry round-trips", back.labels, toby.labels);

  console.log("\n[5] Empty / missing optional fields");
  const sparse = {
    version: 4,
    groups: [
      { name: "G1", lists: [] },
      { name: "G2", lists: [{ title: "L1", cards: [], labelIds: [] }] },
      { name: "G3", type: "public", lists: [{ title: "L2", cards: [{ url: "https://x.test" }] }] },
    ],
    labels: {},
  };
  const sv = TobyFormat.validate(sparse);
  ok("sparse file validates", sv.ok);
  eq("empty groups counted", sv.stats.emptyGroups, 1);
  eq("empty lists counted", sv.stats.emptyLists, 1);
  const sc = TobyFormat.toNative(sparse, { ownerId: "u" });
  eq("missing type defaults to private", sc.workspace.catData[0].tobyType, "private");
  eq("explicit type kept", sc.workspace.catData[2].tobyType, "public");
  eq("missing card title coerced", sc.tabData[1].tabs[0].title, "");
  eq("missing card url defaults", sc.tabData[1].tabs[0].url, "https://x.test");
  const sparseBack = TobyFormat.fromNative({ categories: sc.workspace.catData, tabData: sc.tabData, labels: {} });
  eq("sparse round-trips", sparseBack.groups[1].lists[0].cards.length, 0);
  eq("sparse missing fields re-emitted as empty strings",
    Object.keys(sparseBack.groups[2].lists[0].cards[0]).sort(),
    ["customDescription", "customTitle", "description", "favIconUrl", "title", "url"]);

  console.log("\n[6] Invalid / non-Toby input");
  ok("reject {}", !TobyFormat.validate({}).ok);
  ok("reject version as string", !TobyFormat.validate({ version: "4", groups: [], labels: {} }).ok);
  ok("reject missing groups", !TobyFormat.validate({ version: 4, labels: {} }).ok);
  ok("reject groups not array", !TobyFormat.validate({ version: 4, groups: {}, labels: {} }).ok);
  ok("reject list without cards", !TobyFormat.validate({ version: 4, groups: [{ name: "g", lists: [{ title: "t" }] }], labels: {} }).ok);
  ok("native not detected as toby", !TobyFormat.isToby({ categories: [], tabData: [] }));

  console.log("\n[7] Background integration (import/export messages)");

  /* 7a. native JSON import regression */
  {
    const bg = makeBg();
    await bg.send({ msg: "initAppData" }); await bg.wait();
    const nativeFile = {
      userData: {
        userId: "native-1", email: "local@device", name: "Native", tour: false,
        stripeSubscriptionStatus: "active", uploadedEmojis: [], updateId: "x",
        workspaces: [{ id: "wsN", name: "Native WS", emoji: "🏠", catData: [{ id: "cN", name: "General", slug: "general", emoji: "📁" }], catLength: 1, shared: false, owner: "native-1", public: false }],
      },
      tabData: [{ id: "gN", title: "Native Group", categoryID: "cN", tabs: [{ id: "tN", title: "Example", url: "https://example.com", favIcon: "" }] }],
    };
    const r = await bg.send({ msg: "importData", payload: nativeFile }); await bg.wait();
    ok("native import reports success", r && r.success === true);
    eq("native import stores tabData", (bg.store[bg.wsKey("wsN")] || []).length, 1);
  }

  /* 7b. Toby import via the generic `importData` message (format detection) */
  let bg;
  {
    bg = makeBg();
    await bg.send({ msg: "initAppData" }); await bg.wait();
    const before = bg.userData().workspaces.length;
    const r = await bg.send({ msg: "importData", payload: toby, name: "All In One" }); await bg.wait();
    ok("Toby import reports success", r && r.success === true, JSON.stringify(r));
    const ud = bg.userData();
    eq("a workspace was added", ud.workspaces.length, before + 1);
    const ws = ud.workspaces[ud.workspaces.length - 1];
    const wsId = ws.id;
    eq("imported workspace name", ws.name, "All In One");
    eq("imported workspace emoji marks the import", ws.emoji, "📥");
    eq("imported categories == Toby groups", ws.catData.length, toby.groups.length);
    const tabData = bg.store[bg.wsKey(wsId)] || [];
    eq("imported stacks == Toby lists", tabData.length, v.stats.lists);
    eq("imported tabs == Toby cards", tabData.reduce((n, g) => n + g.tabs.length, 0), v.stats.cards);
    // label registry persisted
    const regKey = Object.keys(bg.store).find((k) => k.endsWith("tobyLabels"));
    ok("label registry persisted", !!regKey && Object.keys(bg.store[regKey]).length === 2);
    // ordering through the real path
    const catIds = ws.catData.map((c) => c.id);
    eq("category[0] name has prefix stripped", ws.catData[0].name, stripImp(toby.groups[0].name));
    eq("category[0] tobyName preserved", ws.catData[0].tobyName, toby.groups[0].name);
    eq("first stack title", tabData[0].title, toby.groups[0].lists[0].title);
    eq("first stack belongs to category0", tabData[0].categoryID, catIds[0]);
  }

  /* 7c. Toby export via message + compare to source */
  {
    const r = await bg.send({ msg: "exportTobyData" }); await bg.wait();
    ok("Toby export reports success", r && r.success === true, JSON.stringify(r && r.error));
    if (r && r.success) {
      eq("export deep-equals source file", JSON.stringify(r.data), JSON.stringify(toby));
    }
  }

  /* 7d. Reject invalid Toby through the message path */
  {
    const r = await bg.send({ msg: "importTobyData", payload: { version: "x", groups: [] } }); await bg.wait();
    ok("invalid Toby import refused", r && r.success === false && !!r.error);
  }

  console.log("\n=== " + passed + " passed, " + failed + " failed ===");
  if (failed) { console.log("Failed: " + failures.join(", ")); process.exit(1); }
})();
