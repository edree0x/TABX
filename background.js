/* ═══════════════════════════════════════════════════════════
   TabX Local — Service Worker
   100% offline, all data in chrome.storage.local
   No Firebase, no cloud, no login required.
   ═══════════════════════════════════════════════════════════ */
"use strict";

const UKEY = "TabX_userData";
const DKEY = "TabX_deletedData";
const RKEY = "TabX_reminders";

/* ── helpers ── */
function uid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
function now() {
  return new Date().toString();
}
function rnd(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const EMOJIS = [
  "📌","⭐","🔥","📚","🛠","🎨","🧪","💡","🧮","🍳",
  "🎬","🌍","☕","📷","👾","💼","❤","🚀","🧠","🎵",
];
const COLORS = [
  "#EB4034","#F97316","#F7C948","#22C55E","#3B82F6",
  "#6366F1","#8B5CF6","#EC4899","#64748B","#14B8A6",
];

async function getStorage(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => resolve(result[key] || null));
  });
}
async function setStorage(key, value) {
  return new Promise((resolve) => {
    const obj = {};
    obj[key] = value;
    chrome.storage.local.set(obj, () => resolve(true));
  });
}

/* ── broadcast to all newtab/sidebar tabs ── */
function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

async function setActiveWs(wsId) {
  await setStorage("TabX_activeWs", wsId);
}

async function getActiveWs() {
  return (await getStorage("TabX_activeWs")) || null;
}

async function broadcastWsData(userData, ws, tabData) {
  await setActiveWs(ws.id);
  broadcast({ msg: "wsDataSub", data: buildWsData(tabData, ws.id, ws.catData, userData.userId) });
}

function buildUserCargo(userData) {
  return {
    userId: userData.userId,
    email: userData.email || "local@device",
    name: userData.name || "Local User",
    tour: userData.tour !== undefined ? userData.tour : false,
    stripeSubscriptionStatus: "active",
    workspaces: userData.workspaces || [],
    uploadedEmojis: userData.uploadedEmojis || [],
    updateId: uid(),
  };
}

function buildWsData(tabData, wsId, categories, owner) {
  return {
    tabData: tabData || [],
    updateId: uid(),
    WSid: wsId,
    categories: categories || [],
    owner: owner || "local",
    roles: [],
  };
}

function findGroup(tabData, groupId) {
  if (!tabData) return null;
  return tabData.find((g) => g.id === groupId) || null;
}

function findTab(group, tabId) {
  if (!group || !group.tabs) return null;
  return group.tabs.find((t) => t.id === tabId) || null;
}

/* ── default data ── */
function createDefaultData() {
  const userId = uid();
  const wsId = uid();
  const catId = uid();

  const defaultWs = {
    id: wsId,
    name: "My Workspace",
    emoji: "🏠",
    catData: [
      { id: catId, name: "General", slug: "general", emoji: "📁" },
    ],
    catLength: 1,
    shared: false,
    owner: userId,
    public: false,
  };

  const defaultTabData = [
    {
      id: uid(),
      title: "Getting Started",
      emoji: "🚀",
      color: "#3B82F6",
      categoryID: catId,
      createdBy: userId,
      lastAdded: now(),
      focus: false,
      comments: 0,
      tabs: [
        {
          id: uid(),
          title: "TabX Website",
          url: "https://www.tabx.com",
          favIcon: "",
          type: "Site",
          comment: "",
          commentColor: false,
          note: false,
          todo: false,
          isStacked: false,
          stackedItems: [],
          hasAlarm: [],
          dateCreated: now(),
          WSid: wsId,
          spaceId: "",
          justAdded: false,
        },
      ],
    },
  ];

  const userData = {
    userId,
    email: "local@device",
    name: "Local User",
    tour: false,
    stripeSubscriptionStatus: "active",
    workspaces: [defaultWs],
    uploadedEmojis: [],
    updateId: uid(),
  };

  return { userData, tabData: defaultTabData, wsId };
}

/* ═══════════════════════════════════════════════════════════
   MESSAGE HANDLER
   ═══════════════════════════════════════════════════════════ */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const respond = (data) => {
    try { sendResponse(data); } catch {}
  };

  switch (msg.msg) {
    /* ── init ── */
    case "initAppData":
      handleInitApp(respond);
      return true;

    /* ── auth stubs ── */
    case "signInGoogle":
    case "newSignInGoogle":
    case "signInEmailPassword":
    case "newSignInEmailPassword":
    case "guestSignUpEmailPassword":
    case "guestSignUpGoogle":
    case "newSignUpGoogle":
    case "newSignUpEmailPassword":
    case "signUpEmailPassword":
    case "signUpGoogle":
    case "createAnonAccount":
      handleInitApp(respond);
      return true;

    case "getUserToken":
      respond({ token: "local-device-token" });
      return false;

    case "signOut":
      /* no-op, keep data */
      respond({ msg: "success" });
      return false;

    case "sendPasswordResetEmail":
      respond({ msg: "success" });
      return false;

    /* ── workspace ops ── */
    case "changeWorkspace":
      handleChangeWorkspace(msg, respond);
      return true;

    case "createWorkspace":
      handleCreateWorkspace(respond);
      return true;

    case "deleteWorkspace":
      handleDeleteWorkspace(msg, respond);
      return true;

    case "updateWsMeta":
      handleUpdateWsMeta(msg, respond);
      return true;

    case "fetchAllWS":
      handleFetchAllWS(respond);
      return true;

    /* ── tab/group data ── */
    case "updateTabData":
      handleUpdateTabData(msg, respond);
      return true;

    case "getWsData":
      handleGetWsData(msg, respond);
      return true;

    /* ── categories ── */
    case "updateCategories":
      handleUpdateCategories(msg, respond);
      return true;

    case "moveCategory":
      handleMoveCategory(msg, respond);
      return true;

    /* ── group moves ── */
    case "moveGroupData":
      handleMoveGroupData(msg, respond);
      return true;

    case "moveTabBetweenGroups":
      handleMoveTabBetweenGroups(msg, respond);
      return true;

    /* ── deleted items / bin ── */
    case "getDeletedItemsData":
      handleGetDeletedItems(respond);
      return true;

    case "updateDeletedItems":
      handleUpdateDeletedItems(msg, respond);
      return true;

    case "updateFullDeletedItem":
      handleUpdateFullDeletedItem(msg, respond);
      return true;

    case "deleteDeletedItemsDataById":
      handleDeleteDeletedItemsById(msg, respond);
      return true;

    /* ── reminders ── */
    case "getRemindersData":
      handleGetReminders(respond);
      return true;

    case "setRemindersData":
      handleSetReminders(msg, respond);
      return true;

    case "clearAllReminders":
      handleClearAllReminders(msg, respond);
      return true;

    /* ── sharing stubs (no-op) ── */
    case "resolveSharedInvite":
    case "removeUserFromShared":
    case "sendInviteToWS":
    case "shareWsPublic":
    case "getTeamEmails":
    case "fetchWsRoles":
      respond({ msg: "success", roles: [] });
      return false;

    /* ── popover: item ops ── */
    case "updateItemInWS":
      handleUpdateItemInWS(msg, respond);
      return true;

    case "saveToGroup":
      handleSaveToGroup(msg, respond);
      return true;

    case "saveToNewGroup":
      handleSaveToNewGroup(msg, respond);
      return true;

    case "setBadge":
      setBadge(msg);
      respond({ msg: "success" });
      return false;

    case "openUrl":
      handleOpenUrl(msg, respond);
      return true;

    case "openDashboard":
      handleOpenDashboard(respond);
      return true;

    case "closePopover":
    case "closeFromToaster":
    case "closeFromToasterShadow":
      respond({ msg: "success" });
      return false;

    /* ── misc ── */
    case "signedInInOtherFront":
      respond({ msg: "success" });
      return false;

    case "importData":
      handleImportData(msg, respond);
      return true;

    case "newUserData":
      handleNewUserData(msg, respond);
      return true;

    case "postFeedback":
      respond({ msg: "success" });
      return false;

    case "fetchMetaFromUrl":
      handleFetchMetaFromUrl(msg, respond);
      return true;

    default:
      respond({ msg: "success" });
      return false;
  }
});

/* ═══════════════════════════════════════════════════════════
   HANDLERS
   ═══════════════════════════════════════════════════════════ */

async function handleInitApp(respond) {
  let userData = await getStorage(UKEY);

  if (!userData) {
    const d = createDefaultData();
    userData = d.userData;
    await setStorage(UKEY, userData);
    await setStorage("TabX_ws_" + d.wsId, d.tabData);
  }

  /* ensure stripeSubscriptionStatus is always "active" (no trial limits) */
  if (userData.stripeSubscriptionStatus !== "active") {
    userData.stripeSubscriptionStatus = "active";
    await setStorage(UKEY, userData);
  }

  const cargo = buildUserCargo(userData);
  respond({ msg: "signedIn", userCargo: cargo });

  /* push first workspace data subscription */
  const firstWs = userData.workspaces[0];
  if (firstWs) {
    const tabData = await getStorage("TabX_ws_" + firstWs.id);
    await broadcastWsData(userData, firstWs, tabData || []);
  }
}

async function handleChangeWorkspace(msg, respond) {
  const userData = await getStorage(UKEY);
  if (!userData) return respond({ msg: "error" });

  const ws = userData.workspaces.find((w) => w.id === msg.newWsId);
  if (!ws) return respond({ msg: "error" });

  const tabData = await getStorage("TabX_ws_" + ws.id);
  await broadcastWsData(userData, ws, tabData || []);
  respond({ msg: "success" });
}

async function handleCreateWorkspace(respond) {
  const userData = await getStorage(UKEY);
  if (!userData) return respond({ msg: "error" });

  const wsId = uid();
  const catId = uid();
  const newWs = {
    id: wsId,
    name: "New Workspace",
    emoji: "📂",
    catData: [{ id: catId, name: "General", slug: "general", emoji: "📁" }],
    catLength: 1,
    shared: false,
    owner: userData.userId,
    public: false,
  };

  userData.workspaces.push(newWs);
  userData.updateId = uid();
  await setStorage(UKEY, userData);
  await setStorage("TabX_ws_" + wsId, []);

  /* frontend expects { success, data: <userData> } */
  respond({ success: true, data: userData });
  broadcast({ msg: "newUserData", data: userData });

  const newWsData = [];
  await broadcastWsData(userData, newWs, newWsData);
}

async function handleDeleteWorkspace(msg, respond) {
  const userData = await getStorage(UKEY);
  if (!userData) return respond({ msg: "error" });

  const wsId = msg.payload?.wsId;
  const changeToWs = msg.payload?.changeToWs;

  userData.workspaces = userData.workspaces.filter((w) => w.id !== wsId);
  userData.updateId = uid();
  await setStorage(UKEY, userData);
  chrome.storage.local.remove("TabX_ws_" + wsId);

  respond({ msg: "success", data: { success: true } });
  broadcast({ msg: "newUserData", data: userData });

  if (changeToWs) {
    const ws = userData.workspaces.find((w) => w.id === changeToWs);
    if (ws) {
      const tabData = await getStorage("TabX_ws_" + ws.id);
      await broadcastWsData(userData, ws, tabData || []);
    }
  }
}

async function handleUpdateWsMeta(msg, respond) {
  const userData = await getStorage(UKEY);
  if (!userData) return respond({ msg: "error" });

  const payload = msg.payload || {};
  const wsId = payload.wsId;
  const newData = payload.newData;
  const ws = userData.workspaces.find((w) => w.id === wsId);
  if (!ws) return respond({ msg: "error" });

  Object.assign(ws, newData);
  userData.updateId = uid();
  await setStorage(UKEY, userData);
  respond({ msg: "success" });
  broadcast({ msg: "newUserData", data: buildUserCargo(userData) });
}

async function handleFetchAllWS(respond) {
  const userData = await getStorage(UKEY);
  if (!userData) return respond({ msg: "error" });

  const allWSdata = [];
  for (const ws of userData.workspaces) {
    allWSdata.push({
      wsId: ws.id,
      tabData: (await getStorage("TabX_ws_" + ws.id)) || [],
      categories: ws.catData || [],
    });
  }
  respond({ msg: "success", allWSdata });
}

async function handleUpdateTabData(msg, respond) {
  const userData = await getStorage(UKEY);
  if (!userData) return respond({ msg: "error" });

  const wsId = msg.wsId || msg.data?.wsId;
  const tabData = msg.data?.tabData;
  if (!wsId || !tabData) return respond({ msg: "error" });

  await setStorage("TabX_ws_" + wsId, tabData);
  respond({ msg: "success" });

  const ws = userData.workspaces.find((w) => w.id === wsId);
  if (ws) {
    await broadcastWsData(userData, ws, tabData);
  }
}

async function handleGetWsData(msg, respond) {
  const tabData = await getStorage("TabX_ws_" + msg.wsId);
  respond({ msg: "success", data: { tabData: tabData || [] } });
}

async function handleUpdateCategories(msg, respond) {
  const userData = await getStorage(UKEY);
  if (!userData) return respond({ msg: "error" });

  const newCategories = msg.newCategories;
  if (!Array.isArray(newCategories)) return respond({ msg: "error" });

  /* Frontend often omits currentWsId → fall back to the active workspace */
  let wsId = msg.currentWsId;
  if (!wsId || !userData.workspaces.some((w) => w.id === wsId)) {
    wsId = await getActiveWs();
  }
  if (!wsId || !userData.workspaces.some((w) => w.id === wsId)) {
    wsId = userData.workspaces[0].id;
  }

  const ws = userData.workspaces.find((w) => w.id === wsId);
  if (!ws) return respond({ msg: "error" });

  /* newWsData may be a raw array, an opaque {categories,updateId,tabData} object, or undefined */
  const rawWs = msg.newWsData;
  const newTabData = Array.isArray(rawWs) ? rawWs : (rawWs && Array.isArray(rawWs.tabData) ? rawWs.tabData : undefined);
  const wrappedCategories = rawWs && Array.isArray(rawWs.categories) ? rawWs.categories : newCategories;

  ws.catData = wrappedCategories;
  ws.catLength = wrappedCategories.length;

  userData.updateId = uid();
  await setStorage(UKEY, userData);

  if (newTabData) {
    await setStorage("TabX_ws_" + wsId, newTabData);
  }

  respond({ msg: "success" });

  const tabData = newTabData || (await getStorage("TabX_ws_" + wsId)) || [];
  await broadcastWsData(userData, ws, tabData);
}

async function handleMoveCategory(msg, respond) {
  const userData = await getStorage(UKEY);
  if (!userData) return respond({ msg: "error" });

  const { originalWsId, newWsId, catIdToMove, newIndex } = msg.payload || msg;
  const fromWs = userData.workspaces.find((w) => w.id === originalWsId);
  const toWs = userData.workspaces.find((w) => w.id === newWsId);
  if (!fromWs || !toWs) return respond({ msg: "error" });

  const catIdx = fromWs.catData.findIndex((c) => c.id === catIdToMove);
  if (catIdx === -1) return respond({ msg: "error" });

  const [cat] = fromWs.catData.splice(catIdx, 1);
  toWs.catData.splice(newIndex, 0, cat);
  fromWs.catLength = fromWs.catData.length;
  toWs.catLength = toWs.catData.length;

  userData.updateId = uid();
  await setStorage(UKEY, userData);
  respond({ msg: "success" });

  const tabData = await getStorage("TabX_ws_" + newWsId) || [];
  await broadcastWsData(userData, toWs, tabData);
}

async function handleMoveGroupData(msg, respond) {
  const userData = await getStorage(UKEY);
  if (!userData) return respond({ msg: "error" });

  const { groupToMoveId, toWsId, toCatId, currentWsId } = msg.payload || msg;
  const fromTabData = (await getStorage("TabX_ws_" + currentWsId)) || [];
  const toTabData = currentWsId === toWsId ? fromTabData : ((await getStorage("TabX_ws_" + toWsId)) || []);

  const groupIdx = fromTabData.findIndex((g) => g.id === groupToMoveId);
  if (groupIdx === -1) return respond({ msg: "error" });

  const [group] = fromTabData.splice(groupIdx, 1);
  group.categoryID = toCatId;
  toTabData.push(group);

  await setStorage("TabX_ws_" + currentWsId, fromTabData);
  if (currentWsId !== toWsId) {
    await setStorage("TabX_ws_" + toWsId, toTabData);
  }

  respond({ msg: "success" });

  const ws = userData.workspaces.find((w) => w.id === currentWsId);
  if (ws) {
    await broadcastWsData(userData, ws, fromTabData);
  }
}

async function handleMoveTabBetweenGroups(msg, respond) {
  const userData = await getStorage(UKEY);
  if (!userData) return respond({ msg: "error" });

  const { tabIds, toWsId, toGroupId, currentWsId } = msg.payload || msg;
  const fromTabData = (await getStorage("TabX_ws_" + currentWsId)) || [];
  const toTabData = currentWsId === toWsId ? fromTabData : ((await getStorage("TabX_ws_" + toWsId)) || []);

  const movingTabs = [];
  for (const g of fromTabData) {
    const before = g.tabs.length;
    g.tabs = g.tabs.filter((t) => {
      if (tabIds.includes(t.id)) {
        movingTabs.push(t);
        return false;
      }
      return true;
    });
  }

  const toGroup = toTabData.find((g) => g.id === toGroupId);
  if (toGroup) {
    toGroup.tabs.push(...movingTabs);
  }

  await setStorage("TabX_ws_" + currentWsId, fromTabData);
  if (currentWsId !== toWsId) {
    await setStorage("TabX_ws_" + toWsId, toTabData);
  }

  respond({ msg: "success" });

  const ws = userData.workspaces.find((w) => w.id === currentWsId);
  if (ws) {
    await broadcastWsData(userData, ws, fromTabData);
  }
}

async function handleGetDeletedItems(respond) {
  const data = await getStorage(DKEY);
  respond({ msg: "success", docData: { deletedItems: data || [] } });
}

async function handleUpdateDeletedItems(msg, respond) {
  const existing = (await getStorage(DKEY)) || [];
  const incoming = msg.newData || [];
  const merged = existing.concat(incoming.filter(
    (n) => n && !existing.some((e) => e && e.deletedData && n.deletedData && e.deletedData.id === n.deletedData.id)
  ));
  await setStorage(DKEY, merged);
  respond({ msg: "success" });
}

async function handleUpdateFullDeletedItem(msg, respond) {
  await setStorage(DKEY, msg.newData || []);
  respond({ msg: "success" });
}

async function handleDeleteDeletedItemsById(msg, respond) {
  const ids = msg.idsToDelete || [];
  const data = (await getStorage(DKEY)) || [];
  const filtered = data.filter((item) => !ids.includes(item.id));
  await setStorage(DKEY, filtered);
  respond({ msg: "success" });
}

async function handleGetReminders(respond) {
  const data = await getStorage(RKEY);
  respond({ reminders: data || [] });
}

async function handleSetReminders(msg, respond) {
  await setStorage(RKEY, msg.reminders || []);
  respond({ success: true });
}

async function handleClearAllReminders(msg, respond) {
  await setStorage(RKEY, []);
  respond({ msg: "success" });
}

async function handleImportData(msg, respond) {
  const payload = msg.payload || msg.data;
  if (payload?.userData) {
    await setStorage(UKEY, payload.userData);
    if (payload.tabData) {
      const wsId = payload.userData.workspaces?.[0]?.id;
      if (wsId) await setStorage("TabX_ws_" + wsId, payload.tabData);
    }
    respond({ msg: "success" });
    broadcast({ msg: "newUserData", data: buildUserCargo(payload.userData) });
  } else {
    respond({ msg: "error" });
  }
}

async function handleNewUserData(msg, respond) {
  const userData = await getStorage(UKEY);
  if (!userData) return respond({ msg: "error" });
  Object.assign(userData, msg.data);
  userData.updateId = uid();
  await setStorage(UKEY, userData);
  respond({ msg: "success" });
  broadcast({ msg: "newUserData", data: buildUserCargo(userData) });
}

async function handleFetchMetaFromUrl(msg, respond) {
  /* Return empty meta — no network needed */
  respond({
    msg: "success",
    data: {
      title: "",
      description: "",
      imageUrl: null,
      favIcon: null,
    },
  });
}

/* ═══════════════════════════════════════════════════════════
   POPOVER HANDLERS
   ═══════════════════════════════════════════════════════════ */

function tabItemShape(wsId, groupId, tabInfo, extra) {
  return {
    id: tabInfo?.id && typeof tabInfo.id === "string" ? tabInfo.id : uid(),
    title: tabInfo?.title || tabInfo?.url || "Untitled",
    url: tabInfo?.url || "",
    favIcon: tabInfo?.favIcon || "",
    type: "Site",
    comment: extra?.comment || "",
    commentColor: extra?.commentColor || false,
    note: extra?.note || false,
    todo: !!extra?.todo,
    doneStatus: extra?.doneStatus || false,
    isStacked: extra?.isStacked || false,
    stackedItems: extra?.stackedItems || [],
    hasAlarm: [],
    dateCreated: now(),
    WSid: wsId,
    spaceId: groupId,
    justAdded: true,
    saved: true,
  };
}

async function handleUpdateItemInWS(msg, respond) {
  const userData = await getStorage(UKEY);
  if (!userData) return respond({ msg: "error" });

  const wsId = await getActiveWs();
  const ws = userData.workspaces.find((w) => w.id === wsId) || userData.workspaces[0];
  if (!ws) return respond({ msg: "error" });

  const tabData = (await getStorage("TabX_ws_" + ws.id)) || [];

  const type = msg.type;
  const isStacked = msg.isStacked;
  const stackIndex = msg.stackIndex;

  if (type === "delete") {
    const group = tabData[msg.groupIndex];
    if (group && Array.isArray(group.tabs)) {
      if (isStacked && Number.isInteger(stackIndex)) {
        group.tabs.splice(stackIndex, 1);
      } else if (Number.isInteger(msg.itemIndex)) {
        group.tabs.splice(msg.itemIndex, 1);
      } else if (msg.refId) {
        group.tabs = group.tabs.filter((t) => t.id !== msg.refId);
      }
    }
  } else if (type === "tab" && msg.itemObj) {
    const group = tabData[msg.groupIndex];
    if (group && Array.isArray(group.tabs)) {
      if (isStacked && Number.isInteger(stackIndex)) {
        group.tabs[stackIndex] = { ...group.tabs[stackIndex], ...msg.itemObj };
      } else if (msg.itemObj.id) {
        const idx = group.tabs.findIndex((t) => t.id === msg.itemObj.id);
        if (idx > -1) group.tabs[idx] = { ...group.tabs[idx], ...msg.itemObj };
        else if (Number.isInteger(msg.itemIndex) && group.tabs[msg.itemIndex]) {
          group.tabs[msg.itemIndex] = { ...group.tabs[msg.itemIndex], ...msg.itemObj };
        }
      } else if (Number.isInteger(msg.itemIndex) && group.tabs[msg.itemIndex]) {
        group.tabs[msg.itemIndex] = { ...group.tabs[msg.itemIndex], ...msg.itemObj };
      }
    }
  }

  await setStorage("TabX_ws_" + ws.id, tabData);
  respond({ msg: "success" });
  await broadcastWsData(userData, ws, tabData);
}

async function handleSaveToGroup(msg, respond) {
  const userData = await getStorage(UKEY);
  if (!userData) return respond({ msg: "error" });

  const ws = userData.workspaces.find(
    (w) => w.id === msg.WSidOrSlug || w.id === msg.wsId || w.slug === msg.WSidOrSlug
  ) || userData.workspaces[0];
  if (!ws) return respond({ msg: "error" });

  const tabData = (await getStorage("TabX_ws_" + ws.id)) || [];
  const group = tabData.find((g) => g.id === msg.groupId || g.groupId === msg.groupId);
  if (!group) return respond({ msg: "error" });

  group.tabs.push(tabItemShape(ws.id, group.id, msg.tab, msg));
  await setStorage("TabX_ws_" + ws.id, tabData);
  respond({ msg: "success" });
  await broadcastWsData(userData, ws, tabData);
}

async function handleSaveToNewGroup(msg, respond) {
  const userData = await getStorage(UKEY);
  if (!userData) return respond({ msg: "error" });

  const ws = userData.workspaces.find((w) => w.id === msg.WSid) || userData.workspaces[0];
  if (!ws) return respond({ msg: "error" });

  const catId = msg.categoryId || ws.catData[0]?.id;
  const tabData = (await getStorage("TabX_ws_" + ws.id)) || [];

  const group = {
    id: uid(),
    title: "New Group",
    emoji: "📂",
    color: rnd(COLORS),
    categoryID: catId,
    createdBy: userData.userId,
    lastAdded: now(),
    focus: false,
    comments: 0,
    tabs: [tabItemShape(ws.id, null, msg.tab, msg)],
  };
  group.tabs[0].spaceId = group.id;

  tabData.push(group);
  await setStorage("TabX_ws_" + ws.id, tabData);
  respond({ msg: "success" });
  await broadcastWsData(userData, ws, tabData);
}

function setBadge(msg) {
  try {
    if (msg.tabId) {
      chrome.action.setBadgeText({ text: msg.text || "", tabId: msg.tabId });
    }
  } catch {}
}

function handleOpenUrl(msg, respond) {
  if (msg.url) {
    chrome.tabs.create({ url: msg.url });
  }
  respond({ msg: "success" });
}

function handleOpenDashboard(respond) {
  chrome.tabs.create({ url: chrome.runtime.getURL("assets/html/tabx.html") });
  respond({ msg: "success" });
}

/* ── context menu ── */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "tabx-save",
    title: "Save to TabX",
    contexts: ["page", "link"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "tabx-save" && tab) {
    saveTabToWorkspace(tab);
  }
});

async function saveTabToWorkspace(tab) {
  const userData = await getStorage(UKEY);
  if (!userData || !userData.workspaces[0]) return;

  const wsId = userData.workspaces[0].id;
  const ws = userData.workspaces[0];
  const catId = ws.catData[0]?.id;
  const tabData = (await getStorage("TabX_ws_" + wsId)) || [];

  /* find or create a "Saved" group */
  let group = tabData.find((g) => g.title === "Saved" && g.categoryID === catId);
  if (!group) {
    group = {
      id: uid(),
      title: "Saved",
      emoji: "💾",
      color: rnd(COLORS),
      categoryID: catId,
      createdBy: userData.userId,
      lastAdded: now(),
      focus: false,
      comments: 0,
      tabs: [],
    };
    tabData.push(group);
  }

  group.tabs.push({
    id: uid(),
    title: tab.title || tab.url,
    url: tab.url,
    favIcon: tab.favIcon || "",
    type: "Site",
    comment: "",
    commentColor: false,
    note: false,
    todo: false,
    isStacked: false,
    stackedItems: [],
    hasAlarm: [],
    dateCreated: now(),
    WSid: wsId,
    spaceId: group.id,
    justAdded: true,
  });

  await setStorage("TabX_ws_" + wsId, tabData);
  await broadcastWsData(userData, ws, tabData);
}
