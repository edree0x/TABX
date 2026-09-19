/* ═══════════════════════════════════════════════════════════
   Toby ⇄ TabX format module
   Pure, dependency-free. Reverse-engineered from a real Toby
   export ("All In One-Sep 16 at 19_31.json", version 4).

   Toby shape:
     { version:number, groups:[ { name, type, lists:[
         { title, cards:[ { title, url, favIconUrl,
                           customTitle, customDescription,
                           description } ], labelIds:[] } ] } ],
       labels: { "<uuid>": { title, color } } }

   Exposes: self.TobyFormat  (background service worker)
            module.exports    (node tests)
   ═══════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.TobyFormat = api;
})(typeof self !== "undefined" ? self : null, function () {
  "use strict";

  const VERSION = 4;

  /* native stack colors (kept in sync with background.js COLORS) */
  const COLORS = [
    "#EB4034", "#F97316", "#F7C948", "#22C55E", "#3B82F6",
    "#6366F1", "#8B5CF6", "#EC4899", "#64748B", "#14B8A6",
  ];

  const STRING_CARD_FIELDS = [
    "title", "url", "favIconUrl", "customTitle", "customDescription", "description",
  ];

  /* ── small helpers ── */
  function isObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function str(v) { return typeof v === "string" ? v : (v === null || v === undefined ? "" : String(v)); }

  function uid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
  function nowStr() { return new Date().toString(); }
  function slugify(name) {
    return str(name).toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "category";
  }
  /* strip a repeated "Import - " prefix from imported section names so the
     workspace reads naturally; the original name is kept in cat.tobyName */
  const IMPORT_PREFIX = /^import\s*[-–—:]\s*/i;
  function stripImportPrefix(name) {
    let out = str(name).trim();
    while (true) {
      const next = out.replace(IMPORT_PREFIX, "").trim();
      if (next === out) break;
      out = next;
    }
    return out;
  }

  /* ── format detection ── */
  function isToby(obj) {
    return isObject(obj)
      && typeof obj.version === "number"
      && Array.isArray(obj.groups)
      && isObject(obj.labels);
  }
  function isNative(obj) {
    if (!isObject(obj)) return false;
    if (isToby(obj)) return false;
    return isObject(obj.userData) || Array.isArray(obj.tabData) || Array.isArray(obj.categories);
  }
  function detect(obj) {
    if (isToby(obj)) return "toby";
    if (isNative(obj)) return "native";
    return "unknown";
  }

  /* ── validation ──
     errors   → fatal, importer should refuse
     warnings → recoverable, importer coerces a safe default            */
  function validate(obj) {
    const errors = [];
    const warnings = [];
    const stats = { groups: 0, lists: 0, cards: 0, labels: 0, emptyLists: 0, emptyGroups: 0 };

    if (!isObject(obj)) { errors.push("Root value is not an object."); return { ok: false, errors, warnings, stats }; }
    if (typeof obj.version !== "number") errors.push("Missing numeric root property `version`.");
    if (obj.version !== undefined && obj.version !== VERSION) warnings.push("Unexpected version " + obj.version + " (expected " + VERSION + ").");
    if (!Array.isArray(obj.groups)) errors.push("Missing `groups` array.");
    if (!isObject(obj.labels)) errors.push("Missing `labels` object.");

    if (Array.isArray(obj.groups)) {
      obj.groups.forEach((g, gi) => {
        stats.groups++;
        if (!isObject(g)) { errors.push("groups[" + gi + "] is not an object."); return; }
        if (typeof g.name !== "string") errors.push("groups[" + gi + "].name is not a string.");
        if (typeof g.type !== "string") warnings.push("groups[" + gi + "].type missing; defaulting to \"private\".");
        if (!Array.isArray(g.lists)) { errors.push("groups[" + gi + "].lists is not an array."); return; }
        if (g.lists.length === 0) stats.emptyGroups++;
        g.lists.forEach((l, li) => {
          stats.lists++;
          if (!isObject(l)) { errors.push("groups[" + gi + "].lists[" + li + "] is not an object."); return; }
          if (typeof l.title !== "string") warnings.push("groups[" + gi + "].lists[" + li + "].title missing; defaulting to \"\".");
          if (l.labelIds !== undefined && !Array.isArray(l.labelIds)) warnings.push("groups[" + gi + "].lists[" + li + "].labelIds is not an array.");
          if (!Array.isArray(l.cards)) { errors.push("groups[" + gi + "].lists[" + li + "].cards is not an array."); return; }
          if (l.cards.length === 0) stats.emptyLists++;
          l.cards.forEach((c, ci) => {
            stats.cards++;
            if (!isObject(c)) { errors.push("groups[" + gi + "].lists[" + li + "].cards[" + ci + "] is not an object."); return; }
            for (const f of STRING_CARD_FIELDS) {
              if (c[f] !== undefined && typeof c[f] !== "string") warnings.push("card field `" + f + "` is not a string; coercing.");
            }
          });
        });
      });
    }

    if (isObject(obj.labels)) {
      for (const id of Object.keys(obj.labels)) {
        stats.labels++;
        const lab = obj.labels[id];
        if (!isObject(lab)) { warnings.push("labels[" + id + "] is not an object."); continue; }
        if (typeof lab.title !== "string") warnings.push("labels[" + id + "].title missing.");
        if (lab.color !== undefined && typeof lab.color !== "string") warnings.push("labels[" + id + "].color is not a string.");
      }
    }

    return { ok: errors.length === 0, errors, warnings, stats };
  }

  /* ── Toby → native ──
     Group  → workspace category (catData entry, keeps name + tobyType)
     List   → workspace group/stack (tabData entry)
     Card   → tab
     labelIds → stack.labelIds (for lossless export) + tab.tags (native search)
     opts: { name, ownerId, wsId, uid, now }                              */
  function toNative(toby, opts) {
    opts = opts || {};
    const genId = opts.uid || uid;
    const now = opts.now || nowStr();
    const owner = opts.ownerId || "local";

    const labelRegistry = {};
    const labels = isObject(toby.labels) ? toby.labels : {};
    for (const id of Object.keys(labels)) {
      const lab = isObject(labels[id]) ? labels[id] : {};
      labelRegistry[id] = { title: str(lab.title), color: str(lab.color) || "" };
    }

    const wsId = opts.wsId || genId();
    const catData = [];
    const tabData = [];

    (Array.isArray(toby.groups) ? toby.groups : []).forEach((group, gi) => {
      const catId = genId();
      const rawName = str(group && group.name) || "Untitled group";
      const catName = stripImportPrefix(rawName) || rawName;
      catData.push({
        id: catId,
        name: catName,
        slug: slugify(catName),
        emoji: "📁",
        tobyType: str(group && group.type) || "private",
        tobyName: rawName,
      });

      (Array.isArray(group && group.lists) ? group.lists : []).forEach((list, li) => {
        const labelIds = Array.isArray(list && list.labelIds) ? list.labelIds.filter((x) => typeof x === "string") : [];
        const tags = labelIds.map((id) => (labelRegistry[id] ? labelRegistry[id].title : "")).filter(Boolean);
        const cards = Array.isArray(list && list.cards) ? list.cards : [];

        tabData.push({
          id: genId(),
          title: str(list && list.title),
          emoji: "📁",
          color: COLORS[(gi + li) % COLORS.length],
          categoryID: catId,
          createdBy: owner,
          lastAdded: now,
          focus: false,
          comments: cards.length,
          labelIds: labelIds,
          tabs: cards.map((card) => cardToTab(card, { genId, now, wsId, tags })),
        });
      });
    });

    const workspace = {
      id: wsId,
      name: opts.name || "Imported from Toby",
      emoji: "📥",
      catData,
      catLength: catData.length,
      shared: false,
      owner,
      public: false,
    };

    return {
      workspace,
      wsId,
      tabData,
      labelRegistry,
      stats: { groups: catData.length, lists: tabData.length, cards: tabData.reduce((n, g) => n + g.tabs.length, 0) },
    };
  }

  function cardToTab(card, ctx) {
    card = isObject(card) ? card : {};
    const title = str(card.title);
    const customTitle = str(card.customTitle);
    const description = str(card.description);
    const customDescription = str(card.customDescription);
    const tab = {
      id: ctx.genId(),
      title: customTitle || title,
      url: str(card.url),
      favIcon: str(card.favIconUrl),
      type: "Site",
      comment: customDescription || description,
      commentColor: false,
      note: false,
      todo: false,
      tags: ctx.tags.slice(),
      isStacked: false,
      stackedItems: [],
      hasAlarm: [],
      dateCreated: ctx.now,
      WSid: ctx.wsId,
      spaceId: "",
      justAdded: false,
      /* compatibility: keep the scraped originals so overrides round-trip exactly */
      tobyTitle: title,
      tobyDescription: description,
    };
    if (customTitle) tab.tobyCustomTitle = customTitle;
    if (customDescription) tab.tobyCustomDescription = customDescription;
    return tab;
  }

  /* ── native → Toby ──
     categories → groups (name + type)
     groups      → lists
     tabs        → cards
     opts: { categories, tabData, labels, wsPublic }                     */
  function fromNative(opts) {
    opts = opts || {};
    const categories = Array.isArray(opts.categories) ? opts.categories : [];
    const tabData = Array.isArray(opts.tabData) ? opts.tabData : [];
    const registry = isObject(opts.labels) ? opts.labels : {};
    const wsPublic = !!opts.wsPublic;

    const groups = [];
    const usedGroupIds = new Set();

    categories.forEach((cat) => {
      const lists = tabData
        .filter((g) => isObject(g) && g.categoryID === cat.id)
        .map(groupToTobyList);
      lists.forEach((_, i) => usedGroupIds.add(cat.id + ":" + i));
      groups.push({
        name: str(cat.tobyName) || str(cat.name),
        type: str(cat.tobyType) || (wsPublic ? "public" : "private"),
        lists,
      });
    });

    /* groups whose categoryID matches no category → keep, don't drop */
    const orphans = tabData.filter((g) => isObject(g) && !categories.some((c) => c.id === g.categoryID)).map(groupToTobyList);
    if (orphans.length) groups.push({ name: "Ungrouped", type: wsPublic ? "public" : "private", lists: orphans });

    const labels = {};
    for (const id of Object.keys(registry)) {
      const lab = isObject(registry[id]) ? registry[id] : {};
      labels[id] = { title: str(lab.title), color: str(lab.color) };
    }

    return { version: VERSION, groups, labels };
  }

  function groupToTobyList(g) {
    return {
      title: str(g.title),
      cards: (Array.isArray(g.tabs) ? g.tabs : []).map(tabToCard),
      labelIds: Array.isArray(g.labelIds) ? g.labelIds.filter((x) => typeof x === "string") : [],
    };
  }

  function tabToCard(t) {
    const baseTitle = typeof t.tobyTitle === "string" ? t.tobyTitle : str(t.title);
    const customTitle = typeof t.tobyCustomTitle === "string"
      ? t.tobyCustomTitle
      : (str(t.title) && str(t.title) !== baseTitle ? str(t.title) : "");
    const baseDesc = typeof t.tobyDescription === "string" ? t.tobyDescription : str(t.comment);
    const customDescription = typeof t.tobyCustomDescription === "string"
      ? t.tobyCustomDescription
      : (str(t.comment) && str(t.comment) !== baseDesc ? str(t.comment) : "");
    return {
      title: baseTitle,
      url: str(t.url),
      favIconUrl: str(t.favIcon),
      customTitle: customTitle,
      customDescription: customDescription,
      description: baseDesc,
    };
  }

  return {
    VERSION,
    COLORS,
    isObject,
    isToby,
    isNative,
    detect,
    validate,
    toNative,
    fromNative,
  };
});
