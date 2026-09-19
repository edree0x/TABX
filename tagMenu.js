/* ═══════════════════════════════════════════════════════════
   TabX — Tag Menu v2 (Fixed & Enhanced)
   Adds: tag badges on tab cards, right-click tag menu,
   tag manager modal, custom-tag prompt, and toasts.
   Plain vanilla JS — safe to load as a classic <script>.
   
   CHANGES from v1:
   - All colors now use Chakra CSS variables (dark/light adapt).
   - Badges are rendered as compact inline chips inside the link card,
     not floating absolutely-positioned divs that overlap buttons.
   - Tag list in the sidebar is filterable by tag name.
   - Badge click → opens tag context menu for that URL.
   ═══════════════════════════════════════════════════════════ */
(() => {
  "use strict";
  if (window.__TabXTagLoaded) return;
  window.__TabXTagLoaded = true;

  const state = {
    tagMap: new Map(),   // normalizedUrl -> { url, tags:Set, ids:Set }
    tagList: [],
    openMenu: null,
  };

  /* ── utils ── */
  function send(msg) {
    return new Promise((resolve) => {
      try {
        if (!chrome?.runtime?.sendMessage) return resolve(null);
        chrome.runtime.sendMessage(msg, (r) => resolve(r || null));
      } catch { resolve(null); }
    });
  }
  function normalizeUrl(u) {
    try {
      const x = new URL(u || "");
      x.hash = "";
      return x.href.replace(/\/+$/, "");
    } catch { return ""; }
  }
  /* evidence-strict URL key used for tag-filter matching: strips scheme, www,
     trailing slashes, hash and query so tagged URLs match the app's
     scheme-stripped row text ("example.com/path") and vice versa. */
  function urlKey(u) {
    if (!u) return "";
    const raw = String(u).trim();
    if (!raw) return "";
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : "https://" + raw;
    try {
      const x = new URL(withScheme);
      const host = (x.hostname || "").toLowerCase().replace(/^www\./, "");
      if (!host || host === "0") return "";
      const p = (x.pathname || "/").replace(/\/+$/, "") || "/";
      return host + p;
    } catch { return ""; }
  }
  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "style") n.setAttribute("style", v);
      else n.setAttribute(k, v);
    }
    (children || []).forEach((c) => {
      if (typeof c === "string") n.appendChild(document.createTextNode(c));
      else if (c) n.appendChild(c);
    });
    return n;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[m]));
  }

  /* ── color tokens from Chakra theme (with fallbacks) ── */
  const COLORS = {
    chipBg: "var(--chakra-colors-mainButtonBg,#f4f5f7)",
    chipBgDark: "var(--chakra-colors-slate700,#2b3245)",
    chipText: "var(--chakra-colors-catText,#353C49)",
    chipTextDark: "var(--chakra-colors-slate200,#e2e8f0)",
    chipBorder: "var(--chakra-colors-slate600,#cbd5e1)",
    chipBorderDark: "var(--chakra-colors-slate500,#475569)",
    accent: "#6366F1",
    accentHover: "#818cf8",
    removeColor: "var(--chakra-colors-iconLight,#B0B7C1)",
    removeColorHover: "#e5484d",
    overlayBg: "rgba(0,0,0,.55)",
    panelBg: "var(--chakra-colors-mainButtonBg,#f4f5f7)",
    panelBgDark: "#1e2430",
    inputBg: "var(--chakra-colors-inputBg,#EDF0F4)",
    inputBgDark: "#0f1420",
    borderColor: "var(--chakra-colors-slate600,#cbd5e1)",
    borderColorDark: "rgba(255,255,255,.12)",
    textPrimary: "var(--chakra-colors-catText,#353C49)",
    textPrimaryDark: "#e2e8f0",
    textSecondary: "var(--chakra-colors-iconMd,#555d6c)",
    textSecondaryDark: "#94a3b8",
    hoverBg: "var(--chakra-colors-hoverBg,rgba(0,0,0,.06))",
    hoverBgDark: "#2b3245",
    shadow: "0 4px 12px rgba(0,0,0,.15)",
    shadowDark: "0 10px 30px rgba(0,0,0,.5)",
    bodyFont: `-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`,
  };

  /* detect dark mode from the APP's real theme (emitted CSS vars), not OS preference */
  function isDark() {
    const mb = (getComputedStyle(document.documentElement).getPropertyValue("--chakra-colors-modalBg") || "").trim();
    if (mb) {
      const s = mb.toLowerCase().replace(/^#/, "");
      if (s === "fff" || s === "ffffff") return false;
      if (/^[0-9a-f]{3,8}$/.test(s)) return !/^[fde][0-9a-f]{2,5}$/.test(s);
      if (/^rgb\(/.test(mb)) {
        const n = Number((mb.match(/rgb\(\s*(\d+)/) || [0, 255])[1]);
        return n < 160;
      }
    }
    return !!document.querySelector('[class*="dark"],[data-theme*="dark"]')
      || getComputedStyle(document.body).backgroundColor === '#111318'
      || window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /* ── data ── */
  async function refreshTags() {
    const tagResp = await send({ msg: "getAllTags" });
    state.tagList = Array.isArray(tagResp?.tags) ? tagResp.tags : [];
    const resp = await send({ msg: "getTabsByTag", tag: "" });
    const map = new Map();
    for (const t of resp?.tabs || []) {
      const key = normalizeUrl(t.url);
      if (!key) continue;
      if (!map.has(key)) map.set(key, { url: t.url, tags: new Set(), ids: new Set() });
      const e = map.get(key);
      (t.tags || []).forEach((tag) => e.tags.add(tag));
      e.ids.add(t.id);
    }
    state.tagMap = map;
    injectBadges();
    return resp;
  }

  /* ── badge injection (fixed: inline chips inside card, not floating) ── */
  function injectBadges() {
    if (!state.tagMap.size) return;
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    for (const a of anchors) {
      if (a.dataset.tabxTagged === "1") continue;
      const key = normalizeUrl(a.href);
      const entry = key && state.tagMap.get(key);
      if (!entry || !entry.tags.size) continue;

      /* Create a container for all tags of this URL */
      const badgeContainer = el("div", {
        class: "tabx-tag-badges",
        "data-tabx-tagged-url": key,
        style: `display:inline-flex;gap:4px;align-items:center;margin-top:6px;flex-wrap:wrap;`,
      }, []);

      Array.from(entry.tags).slice(0, 5).forEach((t) => {
        badgeContainer.appendChild(createChip(t, false));
      });
      if (entry.tags.size > 5) {
        badgeContainer.appendChild(el("span", {
          style: `font-size:11px;font-weight:600;color:${isDark() ? COLORS.accent : COLORS.accent};padding:2px 6px;border-radius:6px;background:${isDark() ? 'rgba(99,102,241,.15)' : 'rgba(99,102,241,.1)'};cursor:pointer;`,
        }, [`+${entry.tags.size - 5}`]));
      }

      /* Click on container → open tag menu */
      badgeContainer.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e, a.href);
      });

      /* Click on a tag chip → open "tabs with this tag" popover */
      badgeContainer.addEventListener("click", (e) => {
        const chip = e.target.closest("span[title]");
        if (!chip) return;
        e.preventDefault();
        e.stopPropagation();
        const tag = chip.getAttribute("title");
        if (!tag || tag.startsWith("+")) return;
        openTagPopover(a.href, tag, chip);
      });

      const pos = getComputedStyle(a).position;
      if (pos === "static" || !pos) a.style.position = "relative";
      a.appendChild(badgeContainer);
      a.dataset.tabxTagged = "1";
    }
  }

  function createChip(tag, removable) {
    const chip = el("span", {
      style: `display:inline-flex;align-items:center;gap:2px;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:600;white-space:nowrap;cursor:pointer;transition:all .15s ease;border:var(--chakra-colors-teBorder, 1px solid #e4eaf0);background:var(--chakra-colors-mainButtonBg,#f4f5f7);color:var(--chakra-colors-catText,#353C49);box-shadow:var(--chakra-colors-mainButtonShadow,none);`,
      title: tag,
    }, []);
    
    chip.appendChild(el("span", {
      style: "max-width:80px;overflow:hidden;text-overflow:ellipsis;",
    }, [tag]));

    if (removable) {
      const x = el("span", {
        style: `cursor:pointer;color:${isDark() ? COLORS.removeColor : COLORS.removeColor};font-weight:700;font-size:12px;line-height:1;padding:0 2px;border-radius:3px;flex-shrink:0;opacity:.6;transition:opacity .15s;`,
        title: "Remove " + tag,
      }, ["×"]);
      x.addEventListener("mouseenter", () => { x.style.opacity = "1"; x.style.color = COLORS.removeColorHover; });
      x.addEventListener("mouseleave", () => { x.style.opacity = ".6"; x.style.color = isDark() ? COLORS.removeColor : COLORS.removeColor; });
      chip.appendChild(x);
    }

    return chip;
  }

  /* ── custom right-click tag menu ── */
  async function onContextMenu(e, href) {
    if (!href) {
      const a = e.target.closest ? e.target.closest("a[href]") : null;
      if (!a) return;
      href = a.href;
    }
    const url = normalizeUrl(href);
    if (!url) return;

    /* resolve tab for this URL */
    const resp = await send({ msg: "getTabByRef", url: href });
    const tab = resp?.tab;
    if (!tab) return; /* not an internal TabX tab */

    e.preventDefault();
    e.stopPropagation();
    closeMenu();

    const dark = isDark();
    const menu = el("div", {
      id: "tabx-tag-root",
      style: `position:fixed;z-index:2147483647;min-width:200px;max-width:280px;background:${dark ? COLORS.panelBgDark : COLORS.panelBg};border:1px solid ${dark ? COLORS.borderColorDark : COLORS.borderColor};border-radius:12px;padding:8px;box-shadow:${dark ? COLORS.shadowDark : COLORS.shadow};font-family:${COLORS.bodyFont};color:${dark ? COLORS.textPrimaryDark : COLORS.textPrimary};font-size:13px;`,
    }, []);

    menu.appendChild(el("div", {
      style: `padding:8px 10px;font-weight:600;font-size:12px;color:${dark ? COLORS.textSecondaryDark : COLORS.textSecondary};text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid ${dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)'};margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
    }, ["🏷 " + (tab.title || tab.url)]));

    const current = Array.isArray(tab.tags) ? tab.tags : [];
    const allTags = state.tagList.length ? state.tagList : current;

    /* Current tags (removeable) */
    if (current.length) {
      menu.appendChild(el("div", {
        style: `font-size:10px;color:${dark ? COLORS.textSecondaryDark : COLORS.textSecondary};margin:6px 0 4px;text-transform:uppercase;letter-spacing:.3px;`,
      }, ["Current Tags"]));
      
      for (const tag of current) {
        menu.appendChild(menuItem(`✅ ${tag}`, () => 
          send({ msg: "tagTabByRef", refId: tab.id, tag, action: "remove" }).then(refreshTags)
        ));
      }
    }

    /* Available tags (addable) */
    if (allTags.length) {
      menu.appendChild(el("div", {
        style: `font-size:10px;color:${dark ? COLORS.textSecondaryDark : COLORS.textSecondary};margin:6px 0 4px;text-transform:uppercase;letter-spacing:.3px;`,
      }, ["Available Tags"]));
      
      for (const tag of allTags) {
        if (current.includes(tag)) continue;
        menu.appendChild(menuItem(`➕ ${tag}`, () => 
          send({ msg: "tagTabByRef", refId: tab.id, tag, action: "add" }).then(refreshTags)
        ));
      }
    }

    menu.appendChild(menuItem("✍️ Tag as…", () => showCustomPrompt(tab)));
    menu.appendChild(menuItem("🗂 Manage tags…", () => openTagManager()));
    if (current.length) {
      menu.appendChild(menuItem("🗑️ Clear all tags", () => 
        send({ msg: "tagTabByRef", refId: tab.id, action: "set", tags: [] }).then(refreshTags)
      ));
    }

    const x = Math.min(e.clientX, window.innerWidth - 300);
    const y = Math.min(e.clientY, window.innerHeight - 350);
    menu.style.left = Math.max(8, x) + "px";
    menu.style.top = Math.max(8, y) + "px";
    document.body.appendChild(menu);
    state.openMenu = menu;
  }

  function menuItem(label, onClick) {
    const item = el("div", {
      style: `padding:8px 12px;border-radius:8px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500;`,
    }, [label]);
    item.addEventListener("mouseenter", () => {
      item.style.background = isDark() ? COLORS.hoverBgDark : COLORS.hoverBg;
    });
    item.addEventListener("mouseleave", () => {
      item.style.background = "transparent";
    });
    item.addEventListener("click", () => { onClick(); closeMenu(); });
    return item;
  }

  function closeMenu() {
    if (state.openMenu) { state.openMenu.remove(); state.openMenu = null; }
  }

  /* ── custom tag prompt ── */
  function showCustomPrompt(tab, prefill, onPick) {
    closeMenu();
    const dark = isDark();
    const overlay = el("div", {
      style: `position:fixed;inset:0;z-index:2147483647;background:${COLORS.overlayBg};display:flex;align-items:center;justify-content:center;`,
    }, []);
    const box = el("div", {
      style: `background:${dark ? COLORS.panelBgDark : COLORS.panelBg};border:1px solid ${dark ? COLORS.borderColorDark : COLORS.borderColor};border-radius:14px;padding:20px;width:340px;max-width:92vw;font-family:${COLORS.bodyFont};color:${dark ? COLORS.textPrimaryDark : COLORS.textPrimary};box-shadow:${dark ? COLORS.shadowDark : COLORS.shadow};`,
    }, []);
    box.appendChild(el("div", { style: "font-weight:700;font-size:16px;margin-bottom:8px;" }, ["Tag this tab"]));
    box.appendChild(el("div", { style: "font-size:13px;color:" + (dark ? COLORS.textSecondaryDark : COLORS.textSecondary) + ";margin-bottom:14px;" }, [
      tab ? (tab.title || tab.url) : "Enter a tag name",
    ]));

    const inputContainer = el("div", { style: "position:relative;width:100%;margin-bottom:14px;" }, []);
    
    const dropdown = el("div", {
      style: `position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:1000;background:${dark ? COLORS.panelBgDark : COLORS.panelBg};border:1px solid ${dark ? COLORS.borderColorDark : COLORS.borderColor};border-radius:10px;box-shadow:${dark ? COLORS.shadowDark : COLORS.shadow};overflow:hidden;display:none;max-height:200px;overflow-y:auto;font-family:${FONT};`,
    }, []);

    const input = el("input", {
      type: "text",
      value: prefill || "",
      placeholder: "e.g. work, research, read-later… (type to search existing)",
      style: `width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid ${dark ? COLORS.borderColorDark : COLORS.borderColor};background:${dark ? COLORS.inputBgDark : COLORS.inputBg};color:${dark ? COLORS.textPrimaryDark : COLORS.textPrimary};font-size:14px;outline:none;transition:border-color .2s;appearance:none;`,
    }, []);
    input.style.setProperty("--webkit-appearance", "none");
    input.style.setProperty("--moz-appearance", "textfield");

    let selectedIndex = -1;
    let filteredTags = [];

    function updateDropdown() {
      const query = input.value.toLowerCase().trim();
      if (!query) {
        dropdown.style.display = "none";
        selectedIndex = -1;
        return;
      }
      filteredTags = state.tagList.filter(t => t.toLowerCase().includes(query)).slice(0, 10);
      if (!filteredTags.length) {
        dropdown.style.display = "none";
        selectedIndex = -1;
        return;
      }

      dropdown.innerHTML = "";
      filteredTags.forEach((tag, idx) => {
        const item = el("div", {
          style: `padding:8px 12px;cursor:pointer;font-size:13px;color:${dark ? COLORS.textPrimaryDark : COLORS.textPrimary};transition:background .1s;display:flex;align-items:center;gap:8px;`,
        }, []);
        
        const tagLower = tag.toLowerCase();
        const matchIdx = tagLower.indexOf(query);
        if (matchIdx >= 0) {
          const before = tag.slice(0, matchIdx);
          const match = tag.slice(matchIdx, matchIdx + query.length);
          const after = tag.slice(matchIdx + query.length);
          item.appendChild(el("span", {}, [before]));
          item.appendChild(el("span", { style: `font-weight:700;color:${COLORS.accent};` }, [match]));
          item.appendChild(el("span", {}, [after]));
        } else {
          item.appendChild(el("span", {}, [tag]));
        }

        if (idx === selectedIndex) {
          item.style.background = dark ? 'rgba(99,102,241,.2)' : 'rgba(99,102,241,.1)';
        }

        item.addEventListener("mouseenter", () => {
          selectedIndex = idx;
          updateSelection();
        });
        item.addEventListener("click", () => {
          input.value = tag;
          dropdown.style.display = "none";
          input.focus();
        });
        dropdown.appendChild(item);
      });

      dropdown.style.display = "block";
      selectedIndex = 0;
      updateSelection();
    }

    function updateSelection() {
      const items = dropdown.querySelectorAll("div");
      items.forEach((item, idx) => {
        if (idx === selectedIndex) {
          item.style.background = dark ? 'rgba(99,102,241,.2)' : 'rgba(99,102,241,.1)';
        } else {
          item.style.background = "transparent";
        }
      });
    }

    input.addEventListener("focus", () => {
      input.style.borderColor = COLORS.accent;
      input.style.boxShadow = `0 0 0 3px rgba(99,102,241,.2)`;
      updateDropdown();
    });
    input.addEventListener("blur", () => {
      input.style.borderColor = dark ? COLORS.borderColorDark : COLORS.borderColor;
      input.style.boxShadow = "none";
      setTimeout(() => dropdown.style.display = "none", 150);
    });
    input.addEventListener("input", () => {
      selectedIndex = -1;
      updateDropdown();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (selectedIndex >= 0 && filteredTags[selectedIndex]) {
          input.value = filteredTags[selectedIndex];
        }
        done(input.value.trim());
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (filteredTags.length) {
          selectedIndex = Math.min(selectedIndex + 1, filteredTags.length - 1);
          updateSelection();
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (filteredTags.length) {
          selectedIndex = Math.max(selectedIndex - 1, 0);
          updateSelection();
        }
      } else if (e.key === "Escape") {
        dropdown.style.display = "none";
      }
    });

    inputContainer.appendChild(input);
    inputContainer.appendChild(dropdown);
    box.appendChild(inputContainer);

    const chips = el("div", { style: "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;" }, []);
    state.tagList.filter((t) => t !== prefill).slice(0, 12).forEach((t) => {
      const chip = el("span", {
        style: `padding:4px 10px;border-radius:20px;background:${dark ? COLORS.chipBgDark : COLORS.chipBg};cursor:pointer;font-size:12px;font-weight:500;border:1px solid ${dark ? COLORS.chipBorderDark : COLORS.chipBorder};`,
      }, ["# " + esc(t)]);
      chip.addEventListener("click", () => done(t));
      chips.appendChild(chip);
    });
    if (chips.children.length) box.appendChild(chips);

    const row = el("div", { style: "display:flex;justify-content:flex-end;gap:10px;" }, []);
    const cancel = el("button", { style: buttonStyle(dark ? "#334155" : "#e2e8f0", dark ? "#475569" : "#334155") }, ["Cancel"]);
    const ok = el("button", { style: buttonStyle(COLORS.accent, "#fff") }, prefill ? "Apply" : "Add tag");
    cancel.addEventListener("click", () => done(null));
    ok.addEventListener("click", () => done(input.value.trim()));
    row.appendChild(cancel);
    row.appendChild(ok);
    box.appendChild(row);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function buttonStyle(bg, textColor) {
      return `padding:9px 18px;border:none;border-radius:10px;background:${bg};color:${textColor};cursor:pointer;font-size:14px;font-weight:600;transition:filter .15s;`;
    }
    function done(tag) {
      overlay.remove();
      if (onPick) { onPick(tag); return; }
      if (!tag) return;
      if (tab) {
        send({ msg: "tagTabByRef", refId: tab.id, tag, action: "add" }).then(refreshTags);
      } else {
        send({ msg: "saveAllTags", tags: [...new Set([...state.tagList, tag])] }).then(refreshTags);
      }
    }
    input.focus();
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") done(input.value.trim());
      if (e.key === "Escape") done(null);
    });
  }

  /* ── tag manager modal ── */
  async function openTagManager() {
    closeMenu();
    await refreshTags();
    const dark = isDark();
    const overlay = el("div", {
      style: `position:fixed;inset:0;z-index:2147483647;background:${COLORS.overlayBg};display:flex;align-items:center;justify-content:center;`,
    }, []);
    const box = el("div", {
      style: `background:${dark ? COLORS.panelBgDark : COLORS.panelBg};border:1px solid ${dark ? COLORS.borderColorDark : COLORS.borderColor};border-radius:16px;padding:24px;width:min(560px,92vw);max-height:82vh;overflow:auto;font-family:${COLORS.bodyFont};color:${dark ? COLORS.textPrimaryDark : COLORS.textPrimary};box-shadow:${dark ? COLORS.shadowDark : COLORS.shadow};`,
    }, []);

    const head = el("div", { style: "display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;" }, []);
    head.appendChild(el("div", { style: "font-weight:700;font-size:17px;" }, ["🏷 Tag Manager"]));
    const closeBtn = el("button", { style: "border:none;background:none;color:" + (dark ? COLORS.textSecondaryDark : COLORS.textSecondary) + ";cursor:pointer;font-size:18px;padding:4px;" }, ["✕"]);
    closeBtn.addEventListener("click", () => overlay.remove());
    head.appendChild(closeBtn);
    box.appendChild(head);

    const addRow = el("div", { style: "display:flex;gap:10px;margin-bottom:20px;" }, []);
    const addInput = el("input", {
      type: "text",
      placeholder: "New tag name…",
      style: `flex:1;padding:10px 12px;border-radius:10px;border:1px solid ${dark ? COLORS.borderColorDark : COLORS.borderColor};background:${dark ? COLORS.inputBgDark : COLORS.inputBg};color:${dark ? COLORS.textPrimaryDark : COLORS.textPrimary};font-size:14px;outline:none;`,
    }, []);
    const addBtn = el("button", { style: `padding:10px 18px;border:none;border-radius:10px;background:${COLORS.accent};color:#fff;cursor:pointer;font-size:14px;font-weight:600;` }, ["Add"]);
    addRow.appendChild(addInput);
    addRow.appendChild(addBtn);
    box.appendChild(addRow);

    addBtn.addEventListener("click", () => {
      const tag = addInput.value.trim();
      if (!tag) return;
      state.tagList = [...new Set([...state.tagList, tag])];
      send({ msg: "saveAllTags", tags: state.tagList }).then(() => { addInput.value = ""; openTagManager(); });
    });
    addInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addBtn.click(); });

    /* Search/filter input */
    const searchRow = el("div", { style: "margin-bottom:16px;" }, []);
    const searchInput = el("input", {
      type: "text",
      placeholder: "Filter tags…",
      style: `width:100%;padding:8px 12px;border-radius:8px;border:1px solid ${dark ? COLORS.borderColorDark : COLORS.borderColor};background:${dark ? COLORS.inputBgDark : COLORS.inputBg};color:${dark ? COLORS.textPrimaryDark : COLORS.textPrimary};font-size:13px;outline:none;`,
    }, []);
    searchRow.appendChild(searchInput);
    box.appendChild(searchRow);

    const listWrap = el("div", { style: "display:flex;flex-direction:column;gap:10px;" }, []);
    box.appendChild(listWrap);

    async function renderTagList(filter = "") {
      while (listWrap.firstChild) listWrap.removeChild(listWrap.firstChild);
      
      const filtered = state.tagList.filter((t) => 
        t.toLowerCase().includes(filter.toLowerCase())
      );

      if (!filtered.length) {
        listWrap.appendChild(el("div", {
          style: `text-align:center;padding:20px;color:${dark ? COLORS.textSecondaryDark : COLORS.textSecondary};font-size:14px;`,
        }, [filter ? "No tags match your filter" : "No tags yet"]));
        return;
      }

      for (const tag of filtered) {
        const tagResp = await send({ msg: "getTabsByTag", tag });
        const tabs = tagResp?.tabs || [];
        const card = el("div", {
          style: `border:1px solid ${dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)'};border-radius:12px;padding:14px;background:${dark ? 'rgba(255,255,255,.03)' : 'rgba(0,0,0,.02)'};`,
        }, []);

        const topRow = el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:10px;" }, []);
        const left = el("div", { style: "display:flex;align-items:center;gap:10px;min-width:0;" }, []);
        left.appendChild(el("span", { style: "font-weight:600;font-size:14px;color:" + COLORS.accent + ";" }, ["# " + esc(tag)]));
        left.appendChild(el("span", { style: "font-size:12px;color:" + (dark ? COLORS.textSecondaryDark : COLORS.textSecondary) + ";flex-shrink:0;" }, [
          tabs.length + (tabs.length === 1 ? " tab" : " tabs")
        ]));
        topRow.appendChild(left);

        const actions = el("div", { style: "display:flex;gap:8px;" }, []);
        const addTabBtn = el("button", { style: tinyBtn(dark ? "#334155" : "#e2e8f0", dark ? "#475569" : "#334155") }, ["+ tab"]);
        addTabBtn.addEventListener("click", () => showCustomPrompt(null, tag));
        actions.appendChild(addTabBtn);
        const delBtn = el("button", { style: tinyBtn("#dc2626", "#fff") }, ["delete"]);
        delBtn.addEventListener("click", async () => {
          for (const t of tabs) await send({ msg: "tagTabByRef", refId: t.id, tag, action: "remove" });
          const nl = state.tagList.filter((x) => x !== tag);
          await send({ msg: "saveAllTags", tags: nl });
          refreshTags();
          openTagManager();
        });
        actions.appendChild(delBtn);
        topRow.appendChild(actions);
        card.appendChild(topRow);

        if (tabs.length) {
          const tabList = el("div", { style: "margin-top:10px;display:flex;flex-direction:column;gap:4px;" }, []);
          tabs.slice(0, 30).forEach((t) => {
            const row = el("div", {
              style: `display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;font-size:13px;color:${dark ? '#cbd5e1' : '#475569'};`,
            }, []);
            row.addEventListener("mouseenter", () => row.style.background = dark ? COLORS.hoverBgDark : COLORS.hoverBg);
            row.addEventListener("mouseleave", () => row.style.background = "transparent");
            row.addEventListener("click", () => { if (t.url) window.open(t.url, "_blank"); });
            row.appendChild(el("span", { style: "width:8px;height:8px;border-radius:50%;background:" + COLORS.accent + ";flex-shrink:0;" }, []));
            row.appendChild(el("span", {
              style: "flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;",
            }, [esc(t.title || t.url)]));
            const unfav = el("span", { style: "cursor:pointer;color:" + (dark ? COLORS.textSecondaryDark : COLORS.textSecondary) + ";font-size:12px;flex-shrink:0;" }, ["✕"]);
            unfav.addEventListener("click", (e) => {
              e.stopPropagation();
              send({ msg: "tagTabByRef", refId: t.id, tag, action: "remove" }).then(refreshTags);
              openTagManager();
            });
            row.appendChild(unfav);
            tabList.appendChild(row);
          });
          card.appendChild(tabList);
        }
        listWrap.appendChild(card);
      }
    }

    searchInput.addEventListener("input", () => renderTagList(searchInput.value));
    renderTagList("");

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) overlay.remove(); });
  }

  function tinyBtn(bg, textColor) {
    return `padding:4px 10px;border:none;border-radius:8px;background:${bg};color:${textColor};cursor:pointer;font-size:12px;font-weight:500;`;
  }

  /* ── global tag filter modal (Ctrl+Shift+T) ── */
  async function openTagFilter() {
    await refreshTags();
    if (!state.tagList.length) {
      toast("No tags available", "info");
      return;
    }

    const dark = isDark();
    const overlay = el("div", {
      style: `position:fixed;inset:0;z-index:2147483647;background:${COLORS.overlayBg};display:flex;align-items:center;justify-content:center;`,
    }, []);
    const box = el("div", {
      style: `background:${dark ? COLORS.panelBgDark : COLORS.panelBg};border:1px solid ${dark ? COLORS.borderColorDark : COLORS.borderColor};border-radius:16px;padding:0;width:min(520px,92vw);max-height:82vh;overflow:hidden;font-family:${COLORS.bodyFont};color:${dark ? COLORS.textPrimaryDark : COLORS.textPrimary};box-shadow:${dark ? COLORS.shadowDark : COLORS.shadow};display:flex;flex-direction:column;`,
    }, []);

    // Header
    const header = el("div", {
      style: `display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid ${dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)'};`,
    }, []);
    header.appendChild(el("div", { style: "font-weight:700;font-size:16px;display:flex;align-items:center;gap:8px;" }, ["🔍 Filter by Tag"]));
    const closeBtn = el("button", { 
      style: `border:none;background:${dark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.05)'};color:${dark ? COLORS.textSecondaryDark : COLORS.textSecondary};cursor:pointer;font-size:16px;padding:6px 10px;border-radius:8px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;`,
      title: "Close (Esc)"
    }, ["✕"]);
    closeBtn.addEventListener("click", () => overlay.remove());
    header.appendChild(closeBtn);
    box.appendChild(header);

    // Search tags
    const searchWrap = el("div", { style: "padding:16px 20px;border-bottom:1px solid " + (dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)') }, []);
    const searchInput = el("input", {
      type: "text",
      placeholder: "Search tags…",
      style: `width:100%;padding:10px 14px;border-radius:10px;border:1px solid ${dark ? COLORS.borderColorDark : COLORS.borderColor};background:${dark ? COLORS.inputBgDark : COLORS.inputBg};color:${dark ? COLORS.textPrimaryDark : COLORS.textPrimary};font-size:14px;outline:none;`,
    }, []);
    searchInput.addEventListener("focus", () => {
      searchInput.style.borderColor = COLORS.accent;
      searchInput.style.boxShadow = `0 0 0 3px rgba(99,102,241,.2)`;
    });
    searchInput.addEventListener("blur", () => {
      searchInput.style.borderColor = dark ? COLORS.borderColorDark : COLORS.borderColor;
      searchInput.style.boxShadow = "none";
    });
    searchWrap.appendChild(searchInput);
    box.appendChild(searchWrap);

    // Tag chips list (horizontal scrollable)
    const tagsWrap = el("div", { style: "padding:12px 20px 8px;display:flex;flex-wrap:wrap;gap:8px;max-height:150px;overflow-y:auto;" }, []);
    box.appendChild(tagsWrap);

    // Results area
    const resultsWrap = el("div", { style: "flex:1;padding:0 20px 20px;overflow-y:auto;min-height:200px;" }, []);
    box.appendChild(resultsWrap);

    function renderTagChips(filter = "") {
      while (tagsWrap.firstChild) tagsWrap.removeChild(tagsWrap.firstChild);
      
      const filtered = state.tagList.filter((t) => 
        t.toLowerCase().includes(filter.toLowerCase())
      );

      if (!filtered.length) {
        tagsWrap.appendChild(el("div", {
          style: `width:100%;text-align:center;padding:16px;color:${dark ? COLORS.textSecondaryDark : COLORS.textSecondary};font-size:13px;`,
        }, ["No tags match"]));
        return;
      }

      filtered.forEach((tag) => {
        const chip = el("button", {
          style: `padding:8px 14px;border-radius:24px;border:1px solid ${dark ? COLORS.chipBorderDark : COLORS.chipBorder};background:${dark ? COLORS.chipBgDark : COLORS.chipBg};color:${dark ? COLORS.chipTextDark : COLORS.chipText};font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;white-space:nowrap;display:flex;align-items:center;gap:6px;`,
        }, ["# " + esc(tag)]);
        chip.addEventListener("mouseenter", () => {
          chip.style.borderColor = COLORS.accent;
          chip.style.background = dark ? 'rgba(99,102,241,.2)' : 'rgba(99,102,241,.1)';
        });
        chip.addEventListener("mouseleave", () => {
          chip.style.borderColor = dark ? COLORS.chipBorderDark : COLORS.chipBorder;
          chip.style.background = dark ? COLORS.chipBgDark : COLORS.chipBg;
        });
        chip.addEventListener("click", () => showResultsForTag(tag));
        tagsWrap.appendChild(chip);
      });
    }

    async function showResultsForTag(tag) {
      // Update chip states
      tagsWrap.querySelectorAll("button").forEach((btn) => {
        if (btn.textContent.includes(tag)) {
          btn.style.borderColor = COLORS.accent;
          btn.style.background = dark ? 'rgba(99,102,241,.25)' : 'rgba(99,102,241,.15)';
          btn.style.color = COLORS.accent;
        } else {
          btn.style.borderColor = dark ? COLORS.chipBorderDark : COLORS.chipBorder;
          btn.style.background = dark ? COLORS.chipBgDark : COLORS.chipBg;
          btn.style.color = dark ? COLORS.chipTextDark : COLORS.chipText;
        }
      });

      const tagResp = await send({ msg: "getTabsByTag", tag });
      const tabs = tagResp?.tabs || [];

      while (resultsWrap.firstChild) resultsWrap.removeChild(resultsWrap.firstChild);

      if (!tabs.length) {
        resultsWrap.appendChild(el("div", {
          style: `text-align:center;padding:40px 20px;color:${dark ? COLORS.textSecondaryDark : COLORS.textSecondary};`,
        }, [el("div", { style: "font-size:24px;margin-bottom:8px;" }, ["📭"]), "No tabs with this tag"]));
        return;
      }

      const count = el("div", {
        style: `font-size:13px;color:${dark ? COLORS.textSecondaryDark : COLORS.textSecondary};margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid ${dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)'};`,
      }, [`${tabs.length} ${tabs.length === 1 ? "tab" : "tabs"} tagged with #${tag}`]);
      resultsWrap.appendChild(count);

      const list = el("div", { style: "display:flex;flex-direction:column;gap:6px;" }, []);
      tabs.slice(0, 50).forEach((t) => {
        const row = el("div", {
          style: `display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;cursor:pointer;font-size:13px;color:${dark ? '#cbd5e1' : '#334155'};background:${dark ? 'rgba(255,255,255,.03)' : 'rgba(0,0,0,.02)'};border:1px solid ${dark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.05)'};transition:all .15s;`,
        }, []);
        row.addEventListener("mouseenter", () => {
          row.style.background = dark ? 'rgba(99,102,241,.1)' : 'rgba(99,102,241,.05)';
          row.style.borderColor = COLORS.accent;
        });
        row.addEventListener("mouseleave", () => {
          row.style.background = dark ? 'rgba(255,255,255,.03)' : 'rgba(0,0,0,.02)';
          row.style.borderColor = dark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.05)';
        });
        row.addEventListener("click", () => { if (t.url) window.open(t.url, "_blank"); });
        
        // Favicon
        const favicon = el("img", {
          src: t.favIcon || `https://www.google.com/s2/favicons?sz=16&domain_url=${encodeURIComponent(t.url)}`,
          style: "width:16px;height:16px;border-radius:3px;flex-shrink:0;",
        });
        row.appendChild(favicon);
        
        const title = el("span", {
          style: "flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500;",
        }, [esc(t.title || t.url)]);
        row.appendChild(title);

        // Tags on this tab (small chips)
        if (t.tags && t.tags.length) {
          const tagChips = el("div", { style: "display:flex;gap:4px;flex-shrink:0;" }, []);
          t.tags.slice(0, 3).forEach((tg) => {
            tagChips.appendChild(el("span", {
              style: `padding:2px 7px;border-radius:12px;font-size:10px;font-weight:600;background:${dark ? COLORS.chipBgDark : COLORS.chipBg};color:${dark ? COLORS.chipTextDark : COLORS.chipText};border:1px solid ${dark ? COLORS.chipBorderDark : COLORS.chipBorder};`,
            }, [tg]));
          });
          if (t.tags.length > 3) {
            tagChips.appendChild(el("span", {
              style: `padding:2px 7px;border-radius:12px;font-size:10px;font-weight:600;color:${COLORS.accent};background:${dark ? 'rgba(99,102,241,.15)' : 'rgba(99,102,241,.1)'};`,
            }, ["+" + (t.tags.length - 3)]));
          }
          row.appendChild(tagChips);
        }

        // Open button
        const openBtn = el("button", {
          style: `padding:4px 10px;border-radius:6px;border:none;background:${COLORS.accent};color:#fff;font-size:11px;font-weight:600;cursor:pointer;flex-shrink:0;transition:filter .15s;`,
          title: "Open in new tab",
        }, ["Open"]);
        openBtn.addEventListener("mouseenter", () => openBtn.style.filter = "brightness(1.1)");
        openBtn.addEventListener("mouseleave", () => openBtn.style.filter = "none");
        openBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (t.url) window.open(t.url, "_blank");
        });
        row.appendChild(openBtn);

        list.appendChild(row);
      });
      resultsWrap.appendChild(list);
    }

    searchInput.addEventListener("input", () => renderTagChips(searchInput.value));
    renderTagChips("");

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    
    // Focus search input
    searchInput.focus();
    
    // Close on Escape
    function onKey(e) {
      if (e.key === "Escape") {
        overlay.remove();
        document.removeEventListener("keydown", onKey);
      }
    }
    document.addEventListener("keydown", onKey);
    
    overlay.addEventListener("mousedown", (e) => { 
      if (e.target === overlay) overlay.remove(); 
    });
  }

  /* ── toasts ── */
  function toast(text, type) {
    const dark = isDark();
    const colors = { ok: "#16a34a", err: "#dc2626", info: "#3b82f6" };
    const t = el("div", {
      style: `position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:2147483647;background:${dark ? COLORS.panelBgDark : COLORS.panelBg};color:${dark ? COLORS.textPrimaryDark : COLORS.textPrimary};border-left:4px solid ${colors[type] || colors.info};padding:12px 20px;border-radius:10px;font-family:${COLORS.bodyFont};font-size:14px;box-shadow:${dark ? COLORS.shadowDark : COLORS.shadow};max-width:90vw;`,
    }, [text]);
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 350); }, 2200);
  }

  /* ── runtime messages from background ── */
  chrome.runtime?.onMessage?.addListener((msg, sender, sendResponse) => {
    if (!msg) return;

    if (msg.msg === "tabx:promptTag") {
      showCustomPrompt(null, "", (tag) => {
        try { sendResponse({ tag: tag || "" }); } catch {}
      });
      return true; /* keep channel open for async response */
    }
    if (msg.msg === "tabx:openTagManager") openTagManager();
    if (msg.msg === "tabx:tagged") { toast("Tagged as #" + msg.tag, "ok"); refreshTags(); }
    if (msg.msg === "tabx:tagFailed") toast("Couldn't tag that tab", "err");
    if (msg.msg === "tabx:notSaved") toast("This tab isn't saved in TabX yet — save it first", "info");
    if (msg.msg === "wsDataSub" || msg.msg === "newUserData") refreshTags();
  });

  /* ═══════════════════════════════════════════════════════════
     EDIT-MODAL TAG EDITOR (injected into the modal footer)
     Uses Chakra CSS variables so tags always match the theme.
     ═══════════════════════════════════════════════════════════ */
  const editState = {
    candidateEl: null,
    tab: null,
    tabId: null,
    footerEl: null,
    injected: null,
  };

  function isOwnNode(el) {
    return !!(el && el.closest && el.closest("#tabx-tag-root, [data-tabx-tagpanel], [data-tabx-footer-injected], .tabx-tag-badge, [data-tabx-tags-view], [data-tabx-tagtab], [data-tabx-tag-popover], [data-tabx-userpanel], [data-tabx-userchooser], [data-tabx-userdel], #tabx-tag-manager-overlay"));
  }

  function looksLikeHttpInput(value) {
    return typeof value === "string" && /^https?:\/\//i.test(value.trim());
  }

  function findEditModal() {
    const divs = document.querySelectorAll("div");
    for (const d of divs) {
      if (isOwnNode(d)) continue;
      if (d.children.length === 0) continue;
      const cs = getComputedStyle(d);
      if (cs.position !== "fixed") continue;
      const r = d.getBoundingClientRect();
      if (r.width < 220 || r.height < 120) continue;
      if (r.top < 0 || r.left < 0) continue;
      const inputs = d.querySelectorAll("input");
      for (const inp of inputs) {
        if (looksLikeHttpInput(inp.value)) return d;
      }
    }
    return null;
  }

  function modalFooter(modal) {
    return modal.querySelector('.chakra-modal__footer, [class*="chakra-modal__footer"]') || null;
  }

  async function checkEditModal() {
    const modal = findEditModal();

    if (!modal) {
      if (editState.candidateEl) {
        editState.candidateEl = null;
        editState.tab = null;
        editState.tabId = null;
        removeInjectedFooter();
      }
      return;
    }

    if (modal !== editState.candidateEl) {
      editState.candidateEl = modal;
      const urlInput = Array.from(modal.querySelectorAll("input")).find((i) => looksLikeHttpInput(i.value));
      await bindTabToModal(modal, (urlInput && urlInput.value) || "");
    } else {
      const urlInput = Array.from(modal.querySelectorAll("input")).find((i) => looksLikeHttpInput(i.value));
      const val = (urlInput && urlInput.value) || "";
      if (editState.tab && val && normalizeUrl(val) !== normalizeUrl(editState.tab.url)) {
        const resp = await send({ msg: "getTabByRef", url: val });
        const switched = resp?.tab || null;
        if (switched && switched.id !== editState.tabId) {
          editState.candidateEl = modal;
          editState.tab = switched;
          editState.tabId = switched.id;
          ensureFooterEditor(modal);
        }
      } else {
        ensureFooterEditor(modal);
      }
    }
  }

  async function bindTabToModal(modal, url) {
    const resp = await send({ msg: "getTabByRef", url: url || "" });
    const tab = resp?.tab || null;
    if (!tab) { removeInjectedFooter(); return; }
    editState.tab = tab;
    editState.tabId = tab.id;
    ensureFooterEditor(modal);
  }

  function ensureFooterEditor(modal) {
    const footer = modalFooter(modal);
    if (!footer) { removeInjectedFooter(); return; }

    if (editState.footerEl !== footer || !editState.injected || !footer.contains(editState.injected)) {
      removeInjectedFooter();
      editState.footerEl = footer;
      editState.injected = buildFooterEditor(footer, editState.tab);
      footer.appendChild(editState.injected);
    }
  }

  function removeInjectedFooter() {
    if (editState.injected) { editState.injected.remove(); editState.injected = null; }
    editState.footerEl = null;
  }

  const FONT = COLORS.bodyFont;
  const BTN = `background:var(--chakra-colors-mainButtonBg,#f4f5f7);box-shadow:var(--chakra-colors-mainButtonShadow);border:none;border-radius:8px;height:36px;padding:0 16px;font-family:${FONT};font-size:13px;font-weight:600;color:var(--chakra-colors-iconMd,#555d6c);cursor:pointer;white-space:nowrap;transition:0.1s;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;`;
  const CHIP = `background:var(--chakra-colors-mainButtonBg,#f4f5f7);box-shadow:var(--chakra-colors-mainButtonShadow);color:var(--chakra-colors-catText,#353C49);border-radius:8px;height:28px;padding:0 8px 0 10px;display:inline-flex;align-items:center;gap:4px;font-family:${FONT};font-size:12px;font-weight:600;white-space:nowrap;flex-shrink:0;transition:0.1s;cursor:default;`;
  const MAXCHIPS = 6;

  function buildFooterEditor(footer, tab) {
    const dark = isDark();
    const root = el("div", {
      "data-tabx-footer-injected": "1",
      style: `display:flex;flex-direction:column;gap:10px;width:100%;min-width:0;font-family:${FONT};padding:8px 0 4px;`,
    }, []);

    // Row 1: Label + existing tags (with wrapping)
    const tagsRow = el("div", {
      style: `display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-height:36px;`,
    }, []);

    tagsRow.appendChild(el("span", {
      style: "font-size:12px;font-weight:700;color:var(--chakra-colors-iconMd,#555d6c);white-space:nowrap;user-select:none;flex-shrink:0;margin-right:4px;",
    }, ["Tags"]));

    const current = Array.isArray(tab.tags) ? tab.tags : [];

    function makeChipFn(tag, removable) {
      const chip = el("span", { style: CHIP, title: tag }, []);
      chip.appendChild(el("span", { style: "max-width:120px;overflow:hidden;text-overflow:ellipsis;" }, [tag]));
      if (removable) {
        const x = el("span", {
          style: "cursor:pointer;color:var(--chakra-colors-iconLight,#B0B7C1);font-weight:700;font-size:13px;line-height:1;padding:0 4px 0 2px;border-radius:4px;flex-shrink:0;",
          title: "Remove " + tag,
        }, ["×"]);
        x.addEventListener("mouseenter", () => { x.style.color = "#e5484d"; x.style.background = "var(--chakra-colors-hoverBg,rgba(0,0,0,.06))"; });
        x.addEventListener("mouseleave", () => { x.style.color = "var(--chakra-colors-iconLight,#B0B7C1)"; x.style.background = "transparent"; });
        x.addEventListener("click", () => {
          send({ msg: "tagTabByRef", refId: tab.id, tag, action: "remove" }).then(() => {
            tab.tags = (tab.tags || []).filter((t) => t !== tag);
            refreshTags();
            rerenderFooterEditor();
          });
        });
        chip.appendChild(x);
      }
      return chip;
    }

    current.slice(0, MAXCHIPS).forEach((tag) => tagsRow.appendChild(makeChipFn(tag, true)));
    const hiddenCount = current.length - MAXCHIPS;
    if (hiddenCount > 0) {
      const more = makeChipFn("+" + hiddenCount, false);
      more.style.cursor = "pointer";
      more.style.color = "var(--chakra-colors-iconMd,#555d6c)";
      more.addEventListener("mouseenter", () => { more.style.filter = "brightness(1.05)"; });
      more.addEventListener("mouseleave", () => { more.style.filter = "none"; });
      more.addEventListener("click", () => openTagManager());
      tagsRow.appendChild(more);
    }

    root.appendChild(tagsRow);

    // Row 2: Input + Add button (full width, spacious) - WITH CUSTOM DROPDOWN
    const inputRow = el("div", {
      style: `display:flex;align-items:center;gap:10px;width:100%;position:relative;`,
    }, []);

    // Custom autocomplete dropdown (replaces native datalist) - styled to the app's menu language
    const dropdown = el("div", {
      id: "tabx-tag-dropdown",
      style: `position:absolute;top:calc(100% + 6px);left:0;right:0;z-index:1000;background:var(--chakra-colors-modalBg,#fff);box-shadow:var(--chakra-colors-popoverShadowLight);border:var(--chakra-colors-teBorder, 1px solid #e4eaf0);border-radius:10px;padding:4px;display:none;max-height:240px;overflow-y:auto;font-family:${FONT};`,
    }, []);
    inputRow.appendChild(dropdown);

    const addInp = el("input", {
      type: "text",
      placeholder: "Add a tag… (type to search existing tags)",
      style: `flex:1 1 auto;min-width:0;background:var(--chakra-colors-inputBg,#EDF0F4);border:var(--chakra-colors-teBorder, 1px solid #e4eaf0);border-radius:8px;height:40px;padding:0 14px;font-family:${FONT};font-size:14px;font-weight:500;color:var(--chakra-colors-catText,#353C49);caret-color:var(--chakra-colors-catText,#353C49);outline:none;transition:border-color .15s, box-shadow .15s;`,
    }, []);
    addInp.style.setProperty("--webkit-appearance", "none");
    addInp.style.setProperty("--moz-appearance", "textfield");
    
    // Filtered tag results + optional "create new" row, both navigable
    let filteredTags = [];
    let items = [];
    let activeIndex = -1;

    function setActive(i) {
      activeIndex = i;
      items.forEach((it, k) => {
        it.style.background = k === i ? "var(--chakra-colors-noteBg,#EDF0F4)" : "transparent";
      });
      const cur = items[i];
      if (cur) cur.scrollIntoView({ block: "nearest" });
    }

    function renderDropdown() {
      const query = addInp.value.toLowerCase().trim();
      dropdown.innerHTML = "";
      items = [];
      activeIndex = -1;
      if (!query) {
        dropdown.style.display = "none";
        return;
      }

      const own = tab.tags || [];
      filteredTags = state.tagList.filter(t => !own.includes(t) && t.toLowerCase().includes(query)).slice(0, 10);
      const exact = state.tagList.some(t => t.toLowerCase() === query) || own.includes(query);

      const itemBase = "display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;color:var(--chakra-colors-catText,#353C49);transition:background .1s;";

      filteredTags.forEach((tag, idx) => {
        const it = el("div", { style: itemBase }, []);
        const tl = tag.toLowerCase();
        const mi = tl.indexOf(query);
        if (mi >= 0) {
          it.appendChild(document.createTextNode(tag.slice(0, mi)));
          it.appendChild(el("span", { style: "font-weight:700;color:#3690fb;" }, [tag.slice(mi, mi + query.length)]));
          it.appendChild(document.createTextNode(tag.slice(mi + query.length)));
        } else {
          it.textContent = tag;
        }
        it.addEventListener("mouseenter", () => setActive(idx));
        it.addEventListener("mousedown", () => {
          addInp.value = tag;
          dropdown.style.display = "none";
          addInp.focus();
        });
        items.push(it);
        dropdown.appendChild(it);
      });

      if (!exact) {
        const cr = el("div", {
          style: `display:flex;align-items:center;gap:8px;margin-top:2px;padding:8px 12px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;color:#fff;background-image:linear-gradient(145deg,#5DABFE 0%,#3391FF 100%);`,
        }, [el("span", {}, ["+ "]), document.createTextNode('Add "' + query + '"')]);
        const ci = filteredTags.length;
        cr.addEventListener("mouseenter", () => setActive(ci));
        cr.addEventListener("mousedown", (e) => { e.preventDefault(); addTag(query, addInp); });
        items.push(cr);
        dropdown.appendChild(cr);
      }

      if (items.length) {
        dropdown.style.display = "block";
        setActive(0);
      } else {
        dropdown.style.display = "none";
      }
    }

    function hideDropdown() {
      setTimeout(() => {
        dropdown.style.display = "none";
      }, 150);
    }

    addInp.addEventListener("focus", () => {
      addInp.style.borderColor = "#5ba6ff";
      addInp.style.boxShadow = "0 0 0 3px rgba(91,166,255,.22)";
      renderDropdown();
    });
    
    addInp.addEventListener("blur", () => {
      addInp.style.border = "var(--chakra-colors-teBorder, 1px solid #e4eaf0)";
      addInp.style.boxShadow = "none";
      hideDropdown();
    });
    
    addInp.addEventListener("input", () => {
      renderDropdown();
    });
    
    addInp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < filteredTags.length) {
          addInp.value = filteredTags[activeIndex];
        } else if (activeIndex >= filteredTags.length) {
          addTag(addInp.value.trim(), addInp);
          return;
        }
        addTag(addInp.value.trim(), addInp);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (items.length) setActive((activeIndex + 1) % items.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (items.length) setActive((activeIndex - 1 + items.length) % items.length);
      } else if (e.key === "Escape") {
        dropdown.style.display = "none";
        e.stopPropagation();
      }
    });
    
    inputRow.appendChild(addInp);

    const addBtn = el("button", { type: "button", style: BTN }, ["Add"]);
    addBtn.addEventListener("mouseenter", () => { addBtn.style.filter = "brightness(1.05)"; });
    addBtn.addEventListener("mouseleave", () => { addBtn.style.filter = "none"; });
    addBtn.addEventListener("click", () => addTag(addInp.value.trim(), addInp));
    inputRow.appendChild(addBtn);

    root.appendChild(inputRow);

    function addTag(tag, inp) {
      if (!tag) return;
      send({ msg: "tagTabByRef", refId: tab.id, tag, action: "add" }).then(() => {
        if (!Array.isArray(tab.tags)) tab.tags = [];
        if (!tab.tags.includes(tag)) tab.tags.push(tag);
        inp.value = "";
        refreshTags();
        rerenderFooterEditor();
      });
    }

    return root;
  }

  function rerenderFooterEditor() {
    const tab = editState.tab;
    const footer = editState.footerEl;
    if (!tab || !footer) return;
    removeInjectedFooter();
    editState.footerEl = footer;
    editState.injected = buildFooterEditor(footer, tab);
    footer.appendChild(editState.injected);
  }

  function installEditMonitoring() {
    setInterval(checkEditModal, 700);
  }

  /* ═══ SEARCH MODAL: DEDICATED "Tags" TAB AFTER BOOKMARKS ═══ */
  const tagSearch = {
    active: false,        /* is our injected "Tags" tab the selected one */
    tabBtn: null,         /* injected 5th tab button (role=tab) */
    view: null,           /* dedicated panel with search + chips + results */
    selected: [],         /* chosen tag filters */
    urls: new Set(),      /* urlKeys of matching tabs (union) */
    tabs: [],             /* matching tab objects (deduped) */
    total: 0,             /* size of the union */
    allTags: [],          /* tags ACTUALLY attached to saved tabs (no orphans) */
    filter: "",           /* tag search-box text */
    lastSrc: "",          /* signature of allTags to detect changes */
    savedAppTab: null,    /* app's previously-active tab (style/aria) to restore */
    tick: 0,
  };

  function filterChipStyle(selected) {
    const base = `cursor:pointer;display:inline-flex;align-items:center;height:26px;padding:0 10px;border-radius:8px;font-family:${FONT};font-size:12px;font-weight:600;transition:background .1s, transform .05s;white-space:nowrap;user-select:none;`;
    if (selected) {
      return base + `background-image:linear-gradient(145deg,#5DABFE 0%,#3391FF 100%);color:#fff;box-shadow:0 1px 2px rgba(0,0,0,.18);`;
    }
    return base + `background:var(--chakra-colors-categoriesBg,#E6EAEF);color:var(--chakra-colors-catText,#353C49);`;
  }

  function tabBtnStyle(active) {
    const common = `border:none;padding:8px 16px;border-radius:10px 10px 0 0;font-size:14px;cursor:pointer;font-family:${FONT};`;
    if (active) return common + `background:var(--chakra-colors-modalBg,#fff);color:#3690fb;font-weight:700;`;
    return common + `background:transparent;color:var(--chakra-colors-secondaryText,#828b9a);font-weight:600;`;
  }

  function findSearchOverlay() {
    const divs = document.querySelectorAll("body div");
    for (const d of divs) {
      if (isOwnNode(d)) continue;
      const cs = getComputedStyle(d);
      if (cs.position !== "fixed") continue;
      if (!/blur\(/.test(cs.backdropFilter || "")) continue;
      const r = d.getBoundingClientRect();
      if (r.width < 400 || r.height < 300) continue;
      if (d.querySelector('input[type="tel"]')) return d;
    }
    return null;
  }

  function buildTagsView() {
    const view = el("div", {
      "data-tabx-tags-view": "1",
      style: `display:none;flex-direction:column;gap:10px;padding:14px 16px;font-family:${FONT};min-height:70vh;max-height:70vh;overflow:hidden;box-sizing:border-box;background:var(--chakra-colors-modalBg,#fff);border-top:var(--chakra-colors-teBorder, 1px solid #e4eaf0);border-radius:0 0 14px 14px;`,
    }, []);

    const head = el("div", { style: "display:flex;align-items:center;gap:8px;" }, []);
    head.appendChild(el("span", { style: `font-size:13px;font-weight:700;color:var(--chakra-colors-catText,#353C49);white-space:nowrap;user-select:none;` }, ["Search by tags"]));
    head.appendChild(el("span", { "data-tabx-tagcount": "1", style: `font-size:12px;font-weight:500;color:var(--chakra-colors-secondaryText,#828b9a);opacity:.85;` }, [""]));
    const clearBtn = el("button", {
      "data-tabx-clear": "1",
      type: "button",
      style: `margin-left:auto;display:none;border:none;background:none;color:var(--chakra-colors-iconMd,#555d6c);cursor:pointer;font-size:12px;font-weight:600;font-family:${FONT};padding:2px 6px;border-radius:6px;`,
    }, ["✕ clear"]);
    clearBtn.addEventListener("mouseenter", () => { clearBtn.style.background = "var(--chakra-colors-noteBg,#EDF0F4)"; clearBtn.style.color = "#e5484d"; });
    clearBtn.addEventListener("mouseleave", () => { clearBtn.style.background = "transparent"; clearBtn.style.color = "var(--chakra-colors-iconMd,#555d6c)"; });
    clearBtn.addEventListener("click", () => {
      tagSearch.selected = [];
      tagSearch.filter = "";
      const inp = view.querySelector('[data-tabx-tagsearch]');
      if (inp) inp.value = "";
      renderSearchChips();
      refreshTagSelection();
    });
    head.appendChild(clearBtn);
    view.appendChild(head);

    const inp = el("input", {
      "data-tabx-tagsearch": "1",
      type: "text",
      placeholder: "Search tags…",
      style: `height:34px;border-radius:8px;background:var(--chakra-colors-inputBg,#EDF0F4);border:1px solid var(--chakra-colors-teBorder, 1px solid #e4eaf0);padding:0 12px;font-size:13px;font-family:${FONT};color:var(--chakra-colors-catText,#353C49);outline:none;`,
    }, []);
    inp.addEventListener("input", () => { tagSearch.filter = inp.value; renderSearchChips(); });
    inp.addEventListener("focus", () => { inp.style.border = "1px solid #5ba6ff"; inp.style.background = "var(--chakra-colors-modalBg,#fff)"; });
    inp.addEventListener("blur", () => { inp.style.border = "var(--chakra-colors-teBorder, 1px solid #e4eaf0)"; inp.style.background = "var(--chakra-colors-inputBg,#EDF0F4)"; });
    view.appendChild(inp);

    view.appendChild(el("div", { "data-tabx-tagchips": "1", style: "display:flex;flex-wrap:wrap;gap:6px;" }, []));
    view.appendChild(el("div", { "data-tabx-tagnote": "1", style: `font-size:12px;color:var(--chakra-colors-emptyStateText,#828b9a);flex-shrink:0;` }, []));
    view.appendChild(el("div", { "data-tabx-tagresults": "1", style: "display:none;flex-direction:column;gap:2px;flex:1;overflow-y:auto;min-height:0;" }, []));
    return view;
  }

  /* collect tags that are ATTACHED to at least one saved tab (no orphans) */
  async function refreshTagsInUse() {
    const resp = await send({ msg: "getTabsByTag", tag: "" });
    const set = new Set();
    for (const t of (resp && resp.tabs) || []) for (const g of t.tags || []) set.add(g);
    const arr = Array.from(set).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const sig = arr.join("\u0001");
    const changed = sig !== tagSearch.lastSrc;
    tagSearch.lastSrc = sig;
    tagSearch.allTags = arr;
    const before = tagSearch.selected.length;
    tagSearch.selected = tagSearch.selected.filter((t) => set.has(t));
    if (tagSearch.selected.length !== before) refreshTagSelection();
    return changed;
  }

  function makeFilterChip(tag, selected) {
    const c = el("span", { style: filterChipStyle(selected), title: tag }, [tag]);
    const isSel = () => tagSearch.selected.includes(tag);
    c.addEventListener("mouseenter", () => {
      if (!isSel()) c.style.background = "var(--chakra-colors-noteBg,#EDF0F4)";
    });
    c.addEventListener("mouseleave", () => {
      if (!isSel()) c.style.background = "";
    });
    c.addEventListener("click", () => {
      const i = tagSearch.selected.indexOf(tag);
      if (i >= 0) tagSearch.selected.splice(i, 1);
      else tagSearch.selected.push(tag);
      renderSearchChips();
      refreshTagSelection();
    });
    return c;
  }

  function renderSearchChips() {
    const v = tagSearch.view;
    if (!v) return;
    const chipsEl = v.querySelector('[data-tabx-tagchips]');
    const noteEl = v.querySelector('[data-tabx-tagnote]');
    if (!chipsEl) return;
    const f = tagSearch.filter.toLowerCase();
    const selSet = new Set(tagSearch.selected);
    const rest = tagSearch.allTags.filter((t) => !selSet.has(t) && (!f || t.toLowerCase().includes(f)));
    chipsEl.innerHTML = "";
    [...tagSearch.selected, ...rest].slice(0, 48).forEach((t) => chipsEl.appendChild(makeFilterChip(t, selSet.has(t))));
    if (noteEl) {
      if (!tagSearch.allTags.length) {
        noteEl.textContent = "No tags yet — add tags from a tab's edit menu.";
      } else if (!tagSearch.selected.length && !rest.length) {
        noteEl.textContent = f ? "No tags matching \u0022" + tagSearch.filter + "\u0022" : "";
      } else if (rest.length > 48 - tagSearch.selected.length) {
        noteEl.textContent = "More tags available — use the search box above.";
      } else {
        noteEl.textContent = "";
      }
    }
  }

  async function refreshTagSelection() {
    const urls = new Set();
    const tabs = [];
    const seen = new Set();
    for (const t of tagSearch.selected) {
      const resp = await send({ msg: "getTabsByTag", tag: t });
      for (const tb of (resp && resp.tabs) || []) {
        const k = urlKey(tb.url);
        if (!k) continue;
        urls.add(k);
        if (!seen.has(k)) { seen.add(k); tabs.push(tb); }
      }
    }
    tagSearch.urls = urls;
    tagSearch.total = urls.size;
    tagSearch.tabs = tabs;
    renderSearchResults();
    renderTagTotals();
  }

  function renderSearchResults() {
    const v = tagSearch.view;
    if (!v) return;
    const box = v.querySelector('[data-tabx-tagresults]');
    if (!box) return;
    const active = tagSearch.selected.length > 0;
    box.innerHTML = "";
    if (active) {
      const list = tagSearch.tabs || [];
      list.slice(0, 8).forEach((t) => {
        const row = el("div", {
          style: `display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;font-size:13px;color:var(--chakra-colors-catText,#353C49);background:var(--chakra-colors-mainButtonBg,#f4f5f7);`,
        }, []);
        row.addEventListener("mouseenter", () => { row.style.background = "var(--chakra-colors-noteBg,#EDF0F4)"; });
        row.addEventListener("mouseleave", () => { row.style.background = "var(--chakra-colors-mainButtonBg,#f4f5f7)"; });
        row.addEventListener("click", () => { send({ msg: "openTabByUrl", url: t.url || "" }); });
        const icon = el("img", {
          src: faviconFor(t.url || ""),
          style: "width:16px;height:16px;border-radius:3px;flex-shrink:0;",
        }, []);
        icon.addEventListener("error", () => icon.remove());
        row.appendChild(icon);
        row.appendChild(el("span", { style: "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" }, [esc(t.title || t.url || "")]));
        const meta = (t.groupTitle || t.wsName || "").trim();
        if (meta) row.appendChild(el("span", { style: `font-size:11px;color:var(--chakra-colors-secondaryText,#828b9a);white-space:nowrap;` }, [esc(meta)]));
        box.appendChild(row);
      });
      if (list.length > 8) {
        box.appendChild(el("div", { style: `font-size:11px;color:var(--chakra-colors-emptyStateText,#828b9a);padding:2px 8px;` }, ["+ " + (list.length - 8) + " more tabs with " + tagSearch.selected.map((t) => "#" + t).join(", ")]));
      }
    }
    box.style.display = active ? "flex" : "none";
  }

  function renderTagTotals() {
    const v = tagSearch.view;
    if (!v) return;
    const countEl = v.querySelector('[data-tabx-tagcount]');
    const clearBtn = v.querySelector('[data-tabx-clear]');
    const noteEl = v.querySelector('[data-tabx-tagnote]');
    const active = tagSearch.selected.length > 0;
    if (countEl) countEl.textContent = active ? tagSearch.total + " tab" + (tagSearch.total === 1 ? "" : "s") : "";
    if (clearBtn) clearBtn.style.display = active ? "" : "none";
    if (noteEl) {
      if (active && tagSearch.total === 0) noteEl.textContent = "No saved tabs with these tags";
      else if (!active) renderSearchChips();
    }
  }

  async function applyTagsView() {
    if (!tagSearch.view) return;
    const changed = await refreshTagsInUse();
    renderSearchChips();
    if (changed) await refreshTagSelection();
    else renderTagTotals();
  }

  /* when our "Tags" tab is active, visually deactivate the app's own active tab
     so the tablist does not look like both are selected at once */
  function deactivateAppTab(tablist) {
    if (!tablist) return;
    let btn = tablist.querySelector('[role="tab"][aria-selected="true"]:not([data-tabx-tagtab])');
    if (!btn) {
      for (const t of tablist.querySelectorAll('[role="tab"]:not([data-tabx-tagtab])')) {
        if (getComputedStyle(t).color === "rgb(54, 144, 251)") { btn = t; break; }
      }
    }
    if (!btn) return;
    if (!tagSearch.savedAppTab || tagSearch.savedAppTab.el !== btn) {
      tagSearch.savedAppTab = { el: btn, style: btn.getAttribute("style"), aria: btn.getAttribute("aria-selected") };
    }
    btn.setAttribute("aria-selected", "false");
    btn.setAttribute("style", "border:none;background:transparent;color:var(--chakra-colors-secondaryText,#828b9a);font-weight:600;padding:8px 16px;border-radius:10px 10px 0 0;font-size:14px;cursor:pointer;");
  }

  function restoreAppTab() {
    const s = tagSearch.savedAppTab;
    tagSearch.savedAppTab = null;
    if (s && s.el && s.el.isConnected) {
      if (s.style !== null) s.el.setAttribute("style", s.style);
      else s.el.removeAttribute("style");
      if (s.aria !== null) s.el.setAttribute("aria-selected", s.aria);
      else s.el.removeAttribute("aria-selected");
    }
  }

  function searchTick() {
    const overlay = findSearchOverlay();
    if (!overlay) {
      if (tagSearch.active || tagSearch.tabBtn || tagSearch.view) {
        tagSearch.active = false;
        tagSearch.tabBtn = null;
        tagSearch.view = null;
        tagSearch.selected = [];
        tagSearch.urls = new Set();
        tagSearch.tabs = [];
        tagSearch.total = 0;
        tagSearch.allTags = [];
        tagSearch.filter = "";
        tagSearch.lastSrc = "";
        tagSearch.savedAppTab = null;
        tagSearch.tick = 0;
      }
      return;
    }
    tagSearch.tick++;
    const tablist = overlay.querySelector('[role="tablist"]');
    const panel = overlay.querySelector('[role="tabpanel"]');

    if (tablist) {
      let btn = tablist.querySelector('[data-tabx-tagtab]');
      if (!btn) {
        btn = el("button", { "data-tabx-tagtab": "1", role: "tab", type: "button", style: tabBtnStyle(false) }, ["Tags"]);
        btn.addEventListener("click", () => {
          tagSearch.active = true;
          applyTagsView();
        });
        tablist.appendChild(btn);
      }
      tagSearch.tabBtn = btn;
      if (tablist.dataset.tabxBound !== "1") {
        tablist.dataset.tabxBound = "1";
        tablist.addEventListener("click", (e) => {
          const t = e.target.closest ? e.target.closest('[role="tab"]') : null;
          if (t && t !== tagSearch.tabBtn) tagSearch.active = false;
        }, true);
      }
      btn.style.cssText = tabBtnStyle(tagSearch.active);
    }

    let view = overlay.querySelector('[data-tabx-tags-view]');
    if (!view && tablist) {
      view = buildTagsView();
      tablist.insertAdjacentElement("afterend", view);
    }
    tagSearch.view = view || null;

    if (view) {
      if (tagSearch.active) {
        view.style.display = "flex";
        deactivateAppTab(tablist);
        setTagBtnAria();
        if (panel) {
          if (tagSearch.hiding === undefined) tagSearch.hiding = panel.style.display;
          panel.style.display = "none";
        }
        if (tagSearch.tick % 5 === 1) applyTagsView();
        else { renderSearchChips(); renderTagTotals(); }
      } else {
        view.style.display = "none";
        restoreAppTab();
        setTagBtnAria();
        const prev = tagSearch.hiding;
        tagSearch.hiding = undefined;
        if (panel && prev !== undefined) panel.style.display = prev;
      }
    }
  }

  function setTagBtnAria() {
    if (tagSearch.tabBtn) tagSearch.tabBtn.setAttribute("aria-selected", String(tagSearch.active));
  }

  function installSearchMonitor() {
    setInterval(searchTick, 600);
  }

  /* ═══ BADGE CLICK → TABS-WITH-TAG POPOVER ═══ */
  let tagPopoverEl = null;

  function faviconFor(url) {
    try {
      return "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(new URL(url).hostname) + "&sz=32";
    } catch (e) {
      return "";
    }
  }

  function closeTagPopover() {
    if (tagPopoverEl) { tagPopoverEl.remove(); tagPopoverEl = null; }
  }

  async function openTagPopover(href, tag, anchorEl) {
    closeTagPopover();
    const resp = await send({ msg: "getTabsByTag", tag });
    const tabs = (resp && resp.tabs) || [];

    const panel = el("div", {
      "data-tabx-tag-popover": "1",
      style: `position:fixed;z-index:2147483646;min-width:240px;max-width:320px;background:var(--chakra-colors-modalBg,#fff);box-shadow:var(--chakra-colors-popoverShadowLight);border:var(--chakra-colors-teBorder, 1px solid #e4eaf0);border-radius:10px;padding:6px;font-family:${FONT};`,
    }, []);

    const head = el("div", {
      style: `display:flex;align-items:center;gap:6px;padding:6px 8px;font-size:12px;border-bottom:var(--chakra-colors-teBorder, 1px solid #e4eaf0);margin-bottom:4px;`,
    }, []);
    head.appendChild(el("span", { style: "font-weight:700;color:#3690fb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" }, ["#" + tag]));
    head.appendChild(el("span", { style: "font-weight:500;opacity:.8;color:var(--chakra-colors-secondaryText,#828b9a);" }, ["" + tabs.length]));
    panel.appendChild(head);

    if (!tabs.length) {
      panel.appendChild(el("div", { style: `padding:12px;font-size:13px;color:var(--chakra-colors-secondaryText,#828b9a);` }, ["No saved tabs with this tag yet"]));
    } else {
      tabs.slice(0, 12).forEach((t) => {
        const row = el("div", {
          style: `display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px;cursor:pointer;font-size:13px;color:var(--chakra-colors-catText,#353C49);`,
        }, []);
        row.addEventListener("mouseenter", () => { row.style.background = "var(--chakra-colors-noteBg,#EDF0F4)"; });
        row.addEventListener("mouseleave", () => { row.style.background = "transparent"; });
        row.addEventListener("click", () => {
          send({ msg: "openTabByUrl", url: t.url || "" });
          closeTagPopover();
        });
        const icon = el("img", {
          src: faviconFor(t.url || ""),
          style: "width:16px;height:16px;border-radius:3px;flex-shrink:0;",
        }, []);
        icon.addEventListener("error", () => icon.remove());
        row.appendChild(icon);
        row.appendChild(el("span", {
          style: "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;",
        }, [esc(t.title || t.url || "")]));
        panel.appendChild(row);
      });
    }

    document.body.appendChild(panel);
    tagPopoverEl = panel;

    const r = anchorEl.getBoundingClientRect();
    const rows = Math.min(tabs.length, 12) || 1;
    let left = r.left;
    let top = r.bottom + 6;
    if (top + rows * 30 + 40 > window.innerHeight) top = Math.max(6, r.top - rows * 30 - 46);
    if (left + 320 > window.innerWidth) left = window.innerWidth - 320;
    panel.style.left = Math.max(6, left) + "px";
    panel.style.top = Math.max(6, top) + "px";
  }

  /* ═══════════════════════════════════════════════════════════
     LOCAL MULTI-USER PANEL (rename / switch / new user / sign out)
     Hooks the app's own user button; all data stays on-device.
     ═══════════════════════════════════════════════════════════ */
  const userPanel = {
    users: [],
    activeUserId: null,
    panelEl: null,
    chooserEl: null,
    delEl: null,
    anchorBtn: null,
    bgOk: null,
  };

  function initialOf(name) {
    const s = String(name || "").trim();
    return s ? s[0].toUpperCase() : "?";
  }

  async function refreshUserState() {
    const [u, a] = await Promise.all([
      send({ msg: "getUsers" }),
      send({ msg: "getActiveUser" }),
    ]);
    if (u && Array.isArray(u.users)) {
      userPanel.users = u.users;
      userPanel.bgOk = true;
    } else {
      userPanel.bgOk = false;
    }
    const active = (a && a.activeUserId) || (u && u.activeUserId) || null;
    if (active) userPanel.activeUserId = active;
    if (!userPanel.activeUserId && userPanel.users.length) {
      userPanel.activeUserId = userPanel.users[0].userId;
    }
  }

  function bgNoticeEl() {
    return el("div", {
      style: `display:flex;gap:8px;align-items:flex-start;margin:2px 0 8px;padding:9px 10px;border-radius:8px;background:rgba(229,72,77,.1);border:1px solid rgba(229,72,77,.35);font-size:11px;line-height:1.5;color:#e5484d;font-weight:600;`,
    }, ["Multi-user needs a fresh background. Open chrome://extensions → TabX → Reload, then reopen this panel."]);
  }

  function activeUserObj() {
    return userPanel.users.find((u) => u.userId === userPanel.activeUserId)
      || { userId: userPanel.activeUserId, name: "User", email: "local@device" };
  }

  function userAvatar(name, size) {
    return el("div", {
      style: `width:${size}px;height:${size}px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:${Math.round(size * 0.42)}px;font-weight:700;color:#fff;background-image:linear-gradient(145deg,#5DABFE 0%,#3391FF 100%);user-select:none;`,
    }, [initialOf(name)]);
  }

  function userBtnStyle(primary) {
    const base = `border:none;border-radius:8px;font-family:${FONT};font-size:12px;font-weight:700;padding:7px 12px;cursor:pointer;`;
    if (primary) return base + `background-image:linear-gradient(145deg,#5DABFE 0%,#3391FF 100%);color:#fff;`;
    return base + `background:var(--chakra-colors-categoriesBg,#E6EAEF);color:var(--chakra-colors-catText,#353C49);`;
  }

  function userActionRow(label, onClick) {
    const row = el("div", {
      style: `display:flex;align-items:center;gap:8px;padding:8px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;color:var(--chakra-colors-catText,#353C49);`,
    }, [label]);
    row.addEventListener("mouseenter", () => { row.style.background = "var(--chakra-colors-noteBg,#EDF0F4)"; });
    row.addEventListener("mouseleave", () => { row.style.background = "transparent"; });
    row.addEventListener("click", onClick);
    return row;
  }

  function userDivider() {
    return el("div", { style: "height:1px;background:var(--chakra-colors-mainButtonBg,#f4f5f7);margin:6px 4px;" }, []);
  }

  function positionUserPanel(p, anchor) {
    const r = anchor.getBoundingClientRect();
    const w = p.offsetWidth || 280;
    const h = p.offsetHeight || 240;
    let left = r.right - w;
    let top = r.bottom + 8;
    if (left < 8) left = 8;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
    p.style.left = left + "px";
    p.style.top = top + "px";
  }

  function closeUserPanel() {
    if (userPanel.panelEl) { userPanel.panelEl.remove(); userPanel.panelEl = null; }
  }
  function closeUserChooser() {
    if (userPanel.chooserEl) { userPanel.chooserEl.remove(); userPanel.chooserEl = null; }
  }
  function closeUserDel() {
    if (userPanel.delEl) { userPanel.delEl.remove(); userPanel.delEl = null; }
  }

  /* small trash button shown on each user row */
  function userTrashBtn(userId, name) {
    const b = el("button", {
      type: "button",
      title: "Delete user",
      style: `flex-shrink:0;display:flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:none;border-radius:6px;background:transparent;cursor:pointer;color:var(--chakra-colors-iconMd,#555d6c);`,
    }, []);
    b.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/></svg>';
    b.addEventListener("mouseenter", () => { b.style.background = "rgba(229,72,77,.14)"; b.style.color = "#e5484d"; });
    b.addEventListener("mouseleave", () => { b.style.background = "transparent"; b.style.color = "var(--chakra-colors-iconMd,#555d6c)"; });
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      askDeleteUser(userId, name);
    });
    return b;
  }

  async function askDeleteUser(userId, name) {
    if (userPanel.users.length <= 1) {
      openDeleteConfirm({ userId, name: name || "User" }, null);
      return;
    }
    let stats = null;
    const r = await send({ msg: "getUserStats", userId });
    if (r && r.stats) stats = r.stats;
    else if (r === null) userPanel.bgOk = false;
    openDeleteConfirm({ userId, name: name || "User" }, stats);
  }

  function openDeleteConfirm(user, stats) {
    closeUserDel();
    const isLast = userPanel.users.length <= 1;
    const hasData = !!(stats && ((stats.tabs || 0) > 0 || (stats.workspaces || 0) > 1));
    const isActive = user.userId === userPanel.activeUserId;

    const ov = el("div", {
      "data-tabx-userdel": "1",
      style: `position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;font-family:${FONT};`,
    }, []);
    const card = el("div", {
      style: "width:360px;max-width:90vw;background:var(--chakra-colors-modalBg,#fff);border-radius:16px;padding:22px;box-shadow:0 8px 40px rgba(0,0,0,.3);",
    }, []);

    card.appendChild(el("div", {
      style: `font-size:16px;font-weight:800;color:var(--chakra-colors-catText,#353C49);margin-bottom:8px;`,
    }, [isLast ? "Can't delete this user" : `Delete \u0022${user.name}\u0022?`]));

    if (isLast) {
      card.appendChild(el("div", {
        style: "font-size:12.5px;line-height:1.6;color:var(--chakra-colors-secondaryText,#828b9a);",
      }, ["You need at least one user on this device. Create another user before deleting this one."]));
    } else if (hasData) {
      const bits = [];
      if (stats.tabs) bits.push(stats.tabs + (stats.tabs === 1 ? " saved tab" : " saved tabs"));
      if (stats.workspaces > 1) bits.push(stats.workspaces + " workspaces");
      if (stats.tags) bits.push(stats.tags + " tags");
      const warn = el("div", {
        style: `font-size:12.5px;line-height:1.6;color:#e5484d;font-weight:600;background:rgba(229,72,77,.1);border:1px solid rgba(229,72,77,.35);border-radius:10px;padding:10px 12px;margin-bottom:4px;`,
      }, []);
      warn.appendChild(el("div", { style: "margin-bottom:4px;" }, ["This user has data: " + bits.join(" · ") + "."]));
      warn.appendChild(el("div", { style: "font-weight:500;opacity:.9;" }, ["Deleting removes everything and can't be undone."]));
      card.appendChild(warn);
      if (isActive) card.appendChild(el("div", {
        style: "font-size:12px;color:var(--chakra-colors-secondaryText,#828b9a);margin-top:8px;",
      }, ["This is your current user — you'll be switched to another one."]));
    } else {
      card.appendChild(el("div", {
        style: "font-size:12.5px;line-height:1.6;color:var(--chakra-colors-secondaryText,#828b9a);margin-bottom:4px;",
      }, [isActive ? "This is your current user and it has no saved data." : "This user has no saved data."]));
    }

    const bar = el("div", { style: "display:flex;gap:8px;justify-content:flex-end;padding-top:16px;" }, []);
    const cancel = el("button", { type: "button", style: userBtnStyle(false) }, ["Cancel"]);
    cancel.addEventListener("click", closeUserDel);
    bar.appendChild(cancel);

    if (!isLast) {
      const del = el("button", {
        type: "button",
        style: `border:none;border-radius:8px;font-family:${FONT};font-size:12px;font-weight:700;padding:7px 12px;cursor:pointer;background:#e5484d;color:#fff;` + (hasData ? "" : ""),
      }, ["Delete"]);
      del.addEventListener("click", async () => {
        const r = await send({ msg: "deleteUser", userId: user.userId });
        if (!r || r.msg !== "success") {
          userPanel.bgOk = false;
          closeUserDel();
          if (userPanel.panelEl) renderUserPanel(userPanel.anchorBtn);
          else if (userPanel.chooserEl) openUserChooser();
          return;
        }
        closeUserDel();
        closeUserPanel();
        closeUserChooser();
        window.location.reload();
      });
      bar.appendChild(del);
    }
    card.appendChild(bar);

    ov.appendChild(card);
    ov.addEventListener("click", (e) => { if (e.target === ov) closeUserDel(); });
    document.body.appendChild(ov);
    userPanel.delEl = ov;
  }

  /* identify the app's user button (top-right 32px avatar) */
  function isUserButton(node) {
    if (!node || node.nodeType !== 1) return false;
    if (isOwnNode(node)) return false;
    const role = node.getAttribute && node.getAttribute("role");
    if (node.tagName !== "BUTTON" && role !== "button") return false;
    const r = node.getBoundingClientRect();
    if (r.width < 26 || r.width > 42 || r.height < 26 || r.height > 42) return false;
    if (r.top > 110) return false;
    if (r.left < window.innerWidth * 0.45) return false;
    const span = node.querySelector("span");
    if (span && /^[A-Za-z]$/.test((span.textContent || "").trim())) return true;
    if (node.querySelector('svg[viewBox="0 0 22 20"], svg[viewBox="0 0 20 22"]')) return true;
    return false;
  }

  function userButtonFromNode(node) {
    let el = node;
    while (el && el !== document.documentElement) {
      if (isUserButton(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function showUserNameInput(panel, opts) {
    panel.replaceChildren();
    panel.appendChild(el("div", {
      style: `font-size:12px;font-weight:700;color:var(--chakra-colors-catText,#353C49);padding:4px 6px 8px;`,
    }, [opts.title]));

    const inp = el("input", {
      type: "text",
      value: opts.value || "",
      placeholder: "User name",
      style: `width:100%;box-sizing:border-box;height:34px;border-radius:8px;background:var(--chakra-colors-inputBg,#EDF0F4);border:var(--chakra-colors-teBorder, 1px solid #e4eaf0);padding:0 10px;font-size:13px;font-family:${FONT};color:var(--chakra-colors-catText,#353C49);outline:none;`,
    }, []);
    inp.addEventListener("focus", () => { inp.style.border = "1px solid #5ba6ff"; inp.style.background = "var(--chakra-colors-modalBg,#fff)"; });
    inp.addEventListener("blur", () => { inp.style.border = "var(--chakra-colors-teBorder, 1px solid #e4eaf0)"; inp.style.background = "var(--chakra-colors-inputBg,#EDF0F4)"; });
    panel.appendChild(inp);

    const bar = el("div", { style: "display:flex;gap:8px;justify-content:flex-end;padding:10px 0 2px;" }, []);
    const cancel = el("button", { type: "button", style: userBtnStyle(false) }, ["Cancel"]);
    const ok = el("button", { type: "button", style: userBtnStyle(true) }, [opts.submitLabel]);
    const submit = () => { const v = inp.value.trim(); if (v) opts.onSubmit(v); };
    const back = () => { if (opts.onCancel) opts.onCancel(); };
    cancel.addEventListener("click", back);
    ok.addEventListener("click", submit);
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
      if (e.key === "Escape") back();
    });
    bar.appendChild(cancel);
    bar.appendChild(ok);
    panel.appendChild(bar);
    setTimeout(() => { try { inp.focus(); inp.select(); } catch {} }, 30);
  }

  async function switchUserAction(userId) {
    if (!userId || userId === userPanel.activeUserId) { closeUserPanel(); return; }
    const r = await send({ msg: "switchUser", userId });
    if (!r || r.msg !== "success") {
      userPanel.bgOk = false;
      renderUserPanel(userPanel.anchorBtn);
      return;
    }
    closeUserPanel();
    closeUserChooser();
    window.location.reload();
  }

  function renderUserPanel(anchor) {
    closeUserPanel();
    userPanel.anchorBtn = anchor;
    const panel = el("div", {
      "data-tabx-userpanel": "1",
      style: `position:fixed;z-index:2147483647;min-width:264px;max-width:300px;background:var(--chakra-colors-modalBg,#fff);box-shadow:var(--chakra-colors-popoverShadowLight);border:var(--chakra-colors-teBorder, 1px solid #e4eaf0);border-radius:12px;padding:10px;font-family:${FONT};`,
    }, []);

    const active = activeUserObj();

    const head = el("div", { style: "display:flex;align-items:center;gap:10px;padding:6px 6px 10px;" }, []);
    head.appendChild(userAvatar(active.name, 36));
    const hi = el("div", { style: "min-width:0;flex:1;" }, []);
    hi.appendChild(el("div", {
      style: "font-size:14px;font-weight:700;color:var(--chakra-colors-catText,#353C49);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;",
    }, [active.name || "User"]));
    hi.appendChild(el("div", {
      style: "font-size:11px;color:var(--chakra-colors-secondaryText,#828b9a);",
    }, [active.email || "local@device"]));
    head.appendChild(hi);
    panel.appendChild(head);

    if (userPanel.bgOk === false) panel.appendChild(bgNoticeEl());

    panel.appendChild(el("div", {
      style: "font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--chakra-colors-secondaryText,#828b9a);padding:4px 6px;",
    }, ["Users"]));

    userPanel.users.forEach((u) => {
      const isActive = u.userId === userPanel.activeUserId;
      const row = el("div", {
        style: `display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px;cursor:pointer;${isActive ? "background:var(--chakra-colors-noteBg,#EDF0F4);" : ""}`,
      }, []);
      row.addEventListener("mouseenter", () => { row.style.background = "var(--chakra-colors-noteBg,#EDF0F4)"; });
      row.addEventListener("mouseleave", () => { if (!isActive) row.style.background = "transparent"; });
      row.appendChild(userAvatar(u.name, 26));
      row.appendChild(el("span", {
        style: "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;color:var(--chakra-colors-catText,#353C49);",
      }, [u.name || "User"]));
      row.appendChild(el("span", { style: `font-size:11px;font-weight:700;color:#3690fb;${isActive ? "" : "visibility:hidden;"}` }, ["✓"]));
      row.appendChild(userTrashBtn(u.userId, u.name));
      row.addEventListener("click", () => switchUserAction(u.userId));
      panel.appendChild(row);
    });

    panel.appendChild(userDivider());
    panel.appendChild(userActionRow("＋  New user", () => {
      showUserNameInput(panel, {
        title: "Create a new local user",
        submitLabel: "Create",
        onCancel: () => renderUserPanel(userPanel.anchorBtn),
        onSubmit: async (name) => {
          const r = await send({ msg: "createUser", name });
          if (!r || !r.userId) {
            userPanel.bgOk = false;
            renderUserPanel(userPanel.anchorBtn);
            return;
          }
          const s = await send({ msg: "switchUser", userId: r.userId });
          if (!s || s.msg !== "success") {
            userPanel.bgOk = false;
            renderUserPanel(userPanel.anchorBtn);
            return;
          }
          window.location.reload();
        },
      });
    }));
    panel.appendChild(userActionRow("✎  Rename current user", () => {
      showUserNameInput(panel, {
        title: "Rename user",
        value: active.name || "",
        submitLabel: "Save",
        onCancel: () => renderUserPanel(userPanel.anchorBtn),
        onSubmit: async (name) => {
          const r = await send({ msg: "renameUser", userId: userPanel.activeUserId, name });
          if (!r || r.msg !== "success") {
            userPanel.bgOk = false;
            renderUserPanel(userPanel.anchorBtn);
            return;
          }
          await refreshUserState();
          renderUserPanel(userPanel.anchorBtn);
        },
      });
    }));
    panel.appendChild(userActionRow("⎋  Sign out", () => {
      closeUserPanel();
      openUserChooser();
    }));

    document.body.appendChild(panel);
    userPanel.panelEl = panel;
    positionUserPanel(panel, anchor);
  }

  async function openUserPanel(anchor) {
    await refreshUserState();
    renderUserPanel(anchor);
  }

  /* full-screen "choose a user" (sign-out / login screen) */
  async function openUserChooser() {
    closeUserChooser();
    await refreshUserState();
    const ov = el("div", {
      "data-tabx-userchooser": "1",
      style: `position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;font-family:${FONT};`,
    }, []);
    const card = el("div", {
      style: "width:340px;max-width:90vw;background:var(--chakra-colors-modalBg,#fff);border-radius:16px;padding:22px;box-shadow:0 8px 40px rgba(0,0,0,.3);",
    }, []);
    ov.appendChild(card);
    document.body.appendChild(ov);
    userPanel.chooserEl = ov;

    const renderList = () => {
      card.replaceChildren();
      card.appendChild(el("div", {
        style: "font-size:16px;font-weight:800;color:var(--chakra-colors-catText,#353C49);margin-bottom:2px;",
      }, ["Choose a user"]));
      card.appendChild(el("div", {
        style: "font-size:12px;color:var(--chakra-colors-secondaryText,#828b9a);margin-bottom:14px;",
      }, ["All data is stored locally on this device."]));

      if (userPanel.bgOk === false) card.appendChild(bgNoticeEl());

      userPanel.users.forEach((u) => {
        const isActive = u.userId === userPanel.activeUserId;
        const row = el("div", {
          style: `display:flex;align-items:center;gap:10px;padding:10px;border-radius:10px;cursor:pointer;margin-bottom:6px;background:var(--chakra-colors-mainButtonBg,#f4f5f7);${isActive ? "outline:2px solid #5ba6ff;" : ""}`,
        }, []);
        row.appendChild(userAvatar(u.name, 32));
        const col = el("div", { style: "min-width:0;flex:1;" }, []);
        col.appendChild(el("div", {
          style: "font-size:13px;font-weight:700;color:var(--chakra-colors-catText,#353C49);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;",
        }, [u.name || "User"]));
        col.appendChild(el("div", {
          style: "font-size:11px;color:var(--chakra-colors-secondaryText,#828b9a);",
        }, [u.email || "local@device"]));
        row.appendChild(col);
        if (isActive) row.appendChild(el("span", { style: "font-size:11px;font-weight:700;color:#3690fb;" }, ["Current"]));
        row.appendChild(userTrashBtn(u.userId, u.name));
        row.addEventListener("click", () => switchUserAction(u.userId));
        card.appendChild(row);
      });

      const addBtn = el("button", { type: "button", style: userBtnStyle(true) + "width:100%;margin-top:6px;padding:10px;" }, ["＋  Add user"]);
      addBtn.addEventListener("click", () => {
        showUserNameInput(card, {
          title: "Create a new local user",
          submitLabel: "Create",
          onCancel: renderList,
          onSubmit: async (name) => {
            const r = await send({ msg: "createUser", name });
            if (!r || !r.userId) { userPanel.bgOk = false; renderList(); return; }
            const s = await send({ msg: "switchUser", userId: r.userId });
            if (!s || s.msg !== "success") { userPanel.bgOk = false; renderList(); return; }
            window.location.reload();
          },
        });
      });
      card.appendChild(addBtn);

      const cancel = el("button", { type: "button", style: userBtnStyle(false) + "width:100%;margin-top:8px;padding:9px;" }, ["Cancel"]);
      cancel.addEventListener("click", closeUserChooser);
      card.appendChild(cancel);
    };

    renderList();
  }

  /* intercept the app's user button + click-away */
  document.addEventListener("click", (e) => {
    const btn = userButtonFromNode(e.target);
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      openUserPanel(btn);
      return;
    }
    if (userPanel.panelEl && !userPanel.panelEl.contains(e.target) && !(userPanel.delEl && userPanel.delEl.contains(e.target))) closeUserPanel();
  }, true);

  /* ── global events ── */
  document.addEventListener("contextmenu", onContextMenu, true);
  document.addEventListener("click", (e) => {
    if (e.target.closest && !e.target.closest("#tabx-tag-root")) closeMenu();
    if (e.target.closest && !e.target.closest("[data-tabx-tag-popover]")) closeTagPopover();
  }, true);
  window.addEventListener("scroll", () => { closeMenu(); closeTagPopover(); }, true);
  window.addEventListener("keydown", (e) => { 
    if (e.key === "Escape") { closeMenu(); closeTagPopover(); closeUserPanel(); closeUserChooser(); closeUserDel(); } 
    // Ctrl+Shift+T to open tag filter
    if (e.key === "T" && e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      openTagFilter();
    }
  }, true);

  /* badges survive re-renders */
  const observer = new MutationObserver(() => injectBadges());
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });

  function boot() {
    refreshTags();
    installEditMonitoring();
    installSearchMonitor();
    refreshUserState();
    setInterval(refreshUserState, 4000);
    setTimeout(injectBadges, 600);
    setTimeout(injectBadges, 2000);

    /* Expand Chakra modal content to give footer more room for tags */
    const style = document.createElement("style");
    style.textContent = `
      .chakra-modal__content {
        max-width: 720px !important;
        width: 90vw !important;
      }
      .chakra-modal__footer {
        padding: 16px 24px !important;
        gap: 12px !important;
        flex-wrap: wrap !important;
      }
      .chakra-modal__footer > * {
        flex-shrink: 0 !important;
      }
      /* Hide native datalist dropdown arrow globally */
      input[list]::-webkit-calendar-picker-indicator,
      input[list]::-webkit-inner-spin-button,
      input[list]::-webkit-outer-spin-button,
      input[list]::-webkit-dropdown-button {
        display: none !important;
        appearance: none !important;
        -webkit-appearance: none !important;
        opacity: 0 !important;
        width: 0 !important;
        height: 0 !important;
      }
      input[list] {
        appearance: none !important;
        -webkit-appearance: none !important;
        -moz-appearance: textfield !important;
      }
      /* Explicit colours for our tag inputs: never white-on-light, no autofill flash */
      #tabx-tag-dropdown,
      [data-tabx-footer-injected] input,
      [data-tabx-tagsearch] {
        color: var(--chakra-colors-catText, #353C49);
        caret-color: var(--chakra-colors-catText, #353C49);
      }
      #tabx-tag-dropdown::placeholder,
      [data-tabx-footer-injected] input::placeholder,
      [data-tabx-tagsearch]::placeholder {
        color: var(--chakra-colors-secondaryText, #828b9a);
        opacity: 1;
        -webkit-text-fill-color: var(--chakra-colors-secondaryText, #828b9a);
      }
      #tabx-tag-dropdown:-webkit-autofill,
      [data-tabx-footer-injected] input:-webkit-autofill,
      [data-tabx-footer-injected] input:-webkit-autofill:focus,
      [data-tabx-tagsearch]:-webkit-autofill,
      [data-tabx-tagsearch]:-webkit-autofill:focus {
        -webkit-text-fill-color: var(--chakra-colors-catText, #353C49) !important;
        transition: background-color 9999s ease-in-out 0s;
      }
    `;
    document.head.appendChild(style);
  }
  if (document.readyState === "complete" || document.readyState === "interactive") boot();
  else document.addEventListener("DOMContentLoaded", boot);

  /* ═══ SMART HORIZONTAL WHEEL ═══
     Hover any horizontally-scrollable row (categories bar, groups row) and use
     the vertical wheel to scroll it sideways — no Shift needed.  Vertical
     scrollers (tab/note lists) are left untouched.                        */
  document.addEventListener(
    "wheel",
    function smartWheel(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.defaultPrevented || e.shiftKey) return;
      var t = e.target && e.target.nodeType === 1 ? e.target : null;
      if (!t || isOwnNode(t)) return;
      var el = t;
      while (el && el !== document.body && el !== document.documentElement) {
        var cs = getComputedStyle(el);
        var ovy = cs.overflowY, ovx = cs.overflowX;
        var isY = (ovy === "auto" || ovy === "scroll") && el.scrollHeight > el.clientHeight + 1;
        var isX = (ovx === "auto" || ovx === "scroll" || ovx === "overlay") && el.scrollWidth > el.clientWidth + 1;
        if (isY) return;                                           /* vertical scroller → let it scroll natively */
        if (isX) {
          var before = el.scrollLeft;
          el.scrollLeft += e.deltaY || e.deltaX;
          if (el.scrollLeft !== before) e.preventDefault();
          return;
        }
        el = el.parentElement;
      }
    },
    { passive: false, capture: true }
  );

  /* expose for debugging */
  window.__TabXTag = { refresh: refreshTags, openManager: openTagManager, filterByTag: openTagFilter };
})();
