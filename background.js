/* ═══════════════════════════════════════════════════════════
   TabX Local — Service Worker
   100% offline, all data in chrome.storage.local
   No Firebase, no cloud, no login required.
   ═══════════════════════════════════════════════════════════ */
"use strict";

const UKEY = "TabX_userData";
const DKEY = "TabX_deletedData";
const RKEY = "TabX_reminders";
const TKEY = "TabX_tags";
const USERS_KEY = "TabX_users";
const ACTIVE_USER_KEY = "TabX_activeUser";

/* ── active user (in-memory, set on init / switch) ── */
let ACTIVE_USER_ID = null;

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

/* ── user-key prefix: transparently namespaces storage per active user ── */
function userKey(key) {
  if (!ACTIVE_USER_ID) return key;
  if (key.startsWith(`TabX_${ACTIVE_USER_ID}_`)) return key;
  const bare = key.startsWith("TabX_") ? key.slice(5) : key;
  return `TabX_${ACTIVE_USER_ID}_${bare}`;
}

/* non-scoped storage (user registry, active user ID) */
async function getStorageRaw(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => resolve(result[key] || null));
  });
}
async function setStorageRaw(key, value) {
  return new Promise((resolve) => {
    const obj = {};
    obj[key] = value;
    chrome.storage.local.set(obj, () => resolve(true));
  });
}

/* scoped storage (all app data goes through these) */
async function getStorage(key) {
  const ukey = userKey(key);
  return new Promise((resolve) => {
    chrome.storage.local.get([ukey], (result) => resolve(result[ukey] || null));
  });
}
async function setStorage(key, value) {
  const ukey = userKey(key);
  return new Promise((resolve) => {
    const obj = {};
    obj[ukey] = value;
    chrome.storage.local.set(obj, () => resolve(true));
  });
}
async function removeStorage(key) {
  const ukey = userKey(key);
  return new Promise((resolve) => {
    chrome.storage.local.remove(ukey, () => resolve(true));
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

/* ═══════════════════════════════════════════════════════════
   MULTI-USER SYSTEM
   ═══════════════════════════════════════════════════════════ */

async function getUsers() {
  return (await getStorageRaw(USERS_KEY)) || [];
}

async function getActiveUserId() {
  return await getStorageRaw(ACTIVE_USER_KEY);
}

async function setActiveUser(userId) {
  ACTIVE_USER_ID = userId;
  await setStorageRaw(ACTIVE_USER_KEY, userId);
}

/* Migrate old flat keys → user-scoped keys (runs once) */
async function migrateToMultiUser() {
  const users = await getStorageRaw(USERS_KEY);
  if (users && users.length > 0) return;

  const oldUserData = await getStorageRaw("TabX_userData");
  if (!oldUserData) return; // fresh install

  const userId = oldUserData.userId || uid();
  ACTIVE_USER_ID = userId;

  // copy old data under user-scoped keys
  await setStorage(UKEY, oldUserData);
  if (oldUserData.workspaces) {
    for (const ws of oldUserData.workspaces) {
      const wsData = await getStorageRaw("TabX_ws_" + ws.id);
      if (wsData) await setStorage("TabX_ws_" + ws.id, wsData);
    }
  }
  for (const k of [TKEY, DKEY, RKEY, "TabX_activeWs"]) {
    const v = await getStorageRaw(k);
    if (v !== null && v !== undefined) await setStorage(k, v);
  }

  // save registry
  await setStorageRaw(USERS_KEY, [{
    userId,
    name: oldUserData.name || "Local User",
    email: oldUserData.email || "local@device",
    createdAt: new Date().toISOString(),
  }]);
  await setStorageRaw(ACTIVE_USER_KEY, userId);

  // remove old flat keys
  const removeKeys = ["TabX_userData", "TabX_tags", "TabX_deletedData", "TabX_reminders", "TabX_activeWs"];
  if (oldUserData.workspaces) {
    for (const ws of oldUserData.workspaces) removeKeys.push("TabX_ws_" + ws.id);
  }
  chrome.storage.local.remove(removeKeys);
}

/* Create a new local user — returns the userId */
async function createUser(name) {
  const userId = uid();
  const wsId = uid();
  const catId = uid();

  const defaultWs = {
    id: wsId, name: "My Workspace", emoji: "🏠",
    catData: [{ id: catId, name: "General", slug: "general", emoji: "📁" }],
    catLength: 1, shared: false, owner: userId, public: false,
  };

  const userData = {
    userId, email: "local@device", name: name || "New User",
    tour: false, stripeSubscriptionStatus: "active",
    workspaces: [defaultWs], uploadedEmojis: [], updateId: uid(),
  };

  const prev = ACTIVE_USER_ID;
  ACTIVE_USER_ID = userId;
  await setStorage(UKEY, userData);
  await setStorage("TabX_ws_" + wsId, []);
  ACTIVE_USER_ID = prev;

  const users = await getUsers();
  users.push({ userId, name: userData.name, email: userData.email, createdAt: new Date().toISOString() });
  await setStorageRaw(USERS_KEY, users);
  return userId;
}

async function renameUser(userId, newName) {
  const users = await getUsers();
  const u = users.find((x) => x.userId === userId);
  if (u) { u.name = newName; await setStorageRaw(USERS_KEY, users); }
  if (ACTIVE_USER_ID === userId) {
    const ud = await getStorage(UKEY);
    if (ud) { ud.name = newName; ud.updateId = uid(); await setStorage(UKEY, ud); }
  }
}

async function deleteUser(userId) {
  const users = await getUsers();
  const filtered = users.filter((x) => x.userId !== userId);
  await setStorageRaw(USERS_KEY, filtered);

  // remove every user-scoped key (userData, workspaces, tags, reminders, deletedData, …)
  const prefix = "TabX_" + userId + "_";
  const all = await new Promise((res) => chrome.storage.local.get(null, (o) => res(o || {})));
  const keys = Object.keys(all).filter((k) => k.startsWith(prefix));
  if (keys.length) await new Promise((res) => chrome.storage.local.remove(keys, () => res(true)));

  if (ACTIVE_USER_ID === userId) {
    if (filtered.length > 0) await switchToUser(filtered[0].userId);
    else {
      const newId = await createUser("Local User");
      await switchToUser(newId);
    }
  }
}

async function switchToUser(userId) {
  await setActiveUser(userId);
  let ud = await getStorage(UKEY);
  if (!ud) {
    const d = createDefaultData();
    ud = d.userData; ud.userId = userId;
    await setStorage(UKEY, ud);
    await setStorage("TabX_ws_" + d.wsId, d.tabData);
  }
  return buildUserCargo(ud);
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
          tags: [],
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

    /* ── multi-user ops ── */
    case "getUsers":
      handleGetUsers(respond);
      return true;

    case "getActiveUser":
      handleGetActiveUser(respond);
      return true;

    case "createUser":
      handleCreateUser(msg, respond);
      return true;

    case "renameUser":
      handleRenameUser(msg, respond);
      return true;

    case "deleteUser":
      handleDeleteUser(msg, respond);
      return true;

    case "getUserStats":
      handleGetUserStats(msg, respond);
      return true;

    case "switchUser":
      handleSwitchUser(msg, respond);
      return true;

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

    /* ── tags ── */
    case "getAllTags":
      handleGetAllTags(respond);
      return true;

    case "saveAllTags":
      handleSaveAllTags(msg, respond);
      return true;

    case "tagTabByRef":
      handleTagTabByRef(msg, respond);
      return true;

    case "getTabByRef":
      handleGetTabByRef(msg, respond);
      return true;

    case "getTabsByTag":
      handleGetTabsByTag(msg, respond);
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

    case "openTabByUrl":
      handleOpenTabByUrl(msg, respond);
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

async function handleGetUsers(respond) {
  if (!ACTIVE_USER_ID) ACTIVE_USER_ID = await getStorageRaw(ACTIVE_USER_KEY);
  respond({ msg: "success", users: await getUsers(), activeUserId: ACTIVE_USER_ID });
}
async function handleGetActiveUser(respond) {
  if (!ACTIVE_USER_ID) ACTIVE_USER_ID = await getStorageRaw(ACTIVE_USER_KEY);
  respond({ msg: "success", activeUserId: ACTIVE_USER_ID });
}
/* how much data a user owns — used for the delete confirmation */
async function getUserStats(userId) {
  const prefix = "TabX_" + userId + "_";
  const all = await new Promise((res) => chrome.storage.local.get(null, (o) => res(o || {})));
  let tabs = 0, workspaces = 0, tags = 0;
  const ud = all[prefix + UKEY];
  if (ud && Array.isArray(ud.workspaces)) workspaces = ud.workspaces.length;
  const tg = all[prefix + TKEY];
  if (Array.isArray(tg)) tags = tg.length;
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith(prefix + "TabX_ws_") && Array.isArray(v)) tabs += v.length;
  }
  return { tabs, workspaces, tags };
}
async function handleGetUserStats(msg, respond) {
  respond({ msg: "success", stats: await getUserStats(msg.userId) });
}
async function handleCreateUser(msg, respond) {
  const userId = await createUser(msg.name || "New User");
  respond({ msg: "success", userId });
}
async function handleRenameUser(msg, respond) {
  await renameUser(msg.userId, msg.name || "User");
  respond({ msg: "success" });
  broadcast({ msg: "newUserData", data: buildUserCargo(await getStorage(UKEY)) });
}
async function handleDeleteUser(msg, respond) {
  await deleteUser(msg.userId);
  const ud = await getStorage(UKEY);
  respond({ msg: "success", userCargo: ud ? buildUserCargo(ud) : null });
  if (ud) {
    const firstWs = ud.workspaces[0];
    if (firstWs) {
      const tabData = await getStorage("TabX_ws_" + firstWs.id);
      await broadcastWsData(ud, firstWs, tabData || []);
    }
  }
}
async function handleSwitchUser(msg, respond) {
  const cargo = await switchToUser(msg.userId);
  respond({ msg: "success", userCargo: cargo });
  const ud = await getStorage(UKEY);
  if (ud) {
    const firstWs = ud.workspaces[0];
    if (firstWs) {
      const tabData = await getStorage("TabX_ws_" + firstWs.id);
      await broadcastWsData(ud, firstWs, tabData || []);
    }
  }
}

async function handleInitApp(respond) {
  /* run migration from old flat keys if needed */
  await migrateToMultiUser();

  /* ensure ACTIVE_USER_ID is loaded */
  if (!ACTIVE_USER_ID) {
    ACTIVE_USER_ID = await getStorageRaw(ACTIVE_USER_KEY);
  }

  /* first-ever install: create default user */
  if (!ACTIVE_USER_ID) {
    const d = createDefaultData();
    ACTIVE_USER_ID = d.userData.userId;
    await setStorage(UKEY, d.userData);
    await setStorage("TabX_ws_" + d.wsId, d.tabData);
    await setStorageRaw(USERS_KEY, [{
      userId: d.userData.userId, name: "Local User",
      email: "local@device", createdAt: new Date().toISOString(),
    }]);
    await setStorageRaw(ACTIVE_USER_KEY, ACTIVE_USER_ID);
  }

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
  await removeStorage("TabX_ws_" + wsId);

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

/* ═══════════════════════════════════════════════════════════
   TAG HANDLERS
   ═══════════════════════════════════════════════════════════ */

async function handleGetAllTags(respond) {
  const tags = (await getStorage(TKEY)) || [];

  /* ensure every workspace tab has a tags array; collect used tags as fallback */
  const userData = await getStorage(UKEY);
  const used = new Set(tags);
  if (userData) {
    for (const ws of userData.workspaces) {
      const tabData = (await getStorage("TabX_ws_" + ws.id)) || [];
      let wsDirty = false;
      for (const g of tabData) {
        for (const t of g.tabs || []) {
          if (!Array.isArray(t.tags)) { t.tags = []; wsDirty = true; }
          else for (const tg of t.tags) used.add(tg);
        }
      }
      if (wsDirty) await setStorage("TabX_ws_" + ws.id, tabData);
    }
  }
  const finalList = tags.length ? tags : Array.from(used).filter(Boolean);
  if (finalList.length !== tags.length) await setStorage(TKEY, finalList);
  respond({ msg: "success", tags: finalList });
}

async function handleSaveAllTags(msg, respond) {
  await setStorage(TKEY, msg.tags || []);
  respond({ msg: "success" });
}

/* Find a tab across every workspace by tab id (refId) OR url */
function normUrl(u) {
  try { const x = new URL(u || ""); x.hash = ""; return x.href.replace(/\/+$/, ""); }
  catch { return ""; }
}

async function findTabAnywhere(ref) {
  const userData = await getStorage(UKEY);
  if (!userData) return null;

  const rk = typeof ref?.url === "string" ? normUrl(ref.url) : "";
  for (const ws of userData.workspaces) {
    const tabData = (await getStorage("TabX_ws_" + ws.id)) || [];
    for (const g of tabData) {
      if (!Array.isArray(g.tabs)) continue;
      for (const t of g.tabs) {
        let hit;
        if (ref?.refId) {
          hit = t.id === ref.refId || t.refId === ref.refId || t.spaceId === ref.refId;
        } else if (ref?.url) {
          hit = t.url === ref.url || (rk && normUrl(t.url) === rk);
        }
        if (hit) return { ws, group: g, tab: t };
      }
    }
  }
  return null;
}

async function handleGetTabByRef(msg, respond) {
  const found = await findTabAnywhere(msg.payload || msg);
  if (!found) return respond({ msg: "success", tab: null });
  respond({ msg: "success", tab: found.tab, groupId: found.group.id, wsId: found.ws.id });
}

async function handleTagTabByRef(msg, respond) {
  const ref = msg.payload || msg;
  const action = ref.action || "add"; /* add | remove | set */
  const tag = typeof ref.tag === "string" ? ref.tag.trim() : "";

  if (!["add", "remove", "set"].includes(action)) return respond({ msg: "error" });
  if (action !== "set" && !tag) return respond({ msg: "error" });

  const userData = await getStorage(UKEY);
  if (!userData) return respond({ msg: "error" });

  const found = await findTabAnywhere(ref);
  if (!found) return respond({ msg: "error", reason: "not-found" });

  const { ws, group, tab } = found;
  const tabData = (await getStorage("TabX_ws_" + ws.id)) || [];

  if (!Array.isArray(tab.tags)) tab.tags = [];

  if (action === "add") {
    if (!tab.tags.includes(tag)) tab.tags.push(tag);
  } else if (action === "remove") {
    tab.tags = tab.tags.filter((t) => t !== tag);
  } else {
    tab.tags = Array.isArray(ref.tags) ? ref.tags.filter(Boolean) : [tag];
  }

  /* persist under same group — find the group object in the latest tabData */
  const groupIdx = tabData.findIndex((g) => g.id === group.id);
  if (groupIdx > -1) {
    const tabIdx = tabData[groupIdx].tabs.findIndex((t) => t.id === tab.id);
    if (tabIdx > -1) tabData[groupIdx].tabs[tabIdx] = tab;
  }

  await setStorage("TabX_ws_" + ws.id, tabData);

  /* keep global tag list in sync with the union of tags actually in use */
  let tags = (await getStorage(TKEY)) || [];
  if (action === "add") {
    if (!tags.includes(tag)) { tags.push(tag); await setStorage(TKEY, tags); }
  } else if (action === "remove") {
    if (!findAnyTabWithTag(tabData, tag)) {
      tags = tags.filter((t) => t !== tag);
      await setStorage(TKEY, tags);
    }
  } else {
    /* set — rebuild the global list from every workspace */
    const allUsed = new Set();
    for (const w of userData.workspaces) {
      const td = (await getStorage("TabX_ws_" + w.id)) || [];
      for (const g of td) {
        for (const t of g.tabs || []) {
          if (Array.isArray(t.tags)) t.tags.forEach((x) => allUsed.add(x));
        }
      }
    }
    tags = Array.from(allUsed).filter(Boolean);
    await setStorage(TKEY, tags);
  }

  respond({ msg: "success", tag, action, tab: { id: tab.id, tags: tab.tags } });
  const wsMeta = userData.workspaces.find((w) => w.id === ws.id);
  if (wsMeta) await broadcastWsData(userData, wsMeta, tabData);
}

function findAnyTabWithTag(tabData, tag) {
  for (const g of tabData) {
    for (const t of g.tabs || []) {
      if (Array.isArray(t.tags) && t.tags.includes(tag)) return true;
    }
  }
  return false;
}

async function handleGetTabsByTag(msg, respond) {
  const tag = msg.tag;
  const results = [];
  const userData = await getStorage(UKEY);
  if (userData) {
    for (const ws of userData.workspaces) {
      const tabData = (await getStorage("TabX_ws_" + ws.id)) || [];
      for (const g of tabData) {
        for (const t of g.tabs || []) {
          if (Array.isArray(t.tags) && (!tag || t.tags.includes(tag)) && t.tags.length) {
            results.push({ ...t, groupId: g.id, groupTitle: g.title, wsId: ws.id, wsName: ws.name, catId: g.categoryID });
          }
        }
      }
    }
  }
  respond({ msg: "success", tabs: results, tag: tag || "" });
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
    tags: extra?.tags || [],
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

function handleOpenTabByUrl(msg, respond) {
  const url = msg.url;
  if (!url) {
    respond({ msg: "error", error: "no url" });
    return;
  }
  const n = normUrl(url);
  chrome.tabs.query({}, (tabs) => {
    const found = tabs.find((t) => t && t.url && !t.incognito && n && normUrl(t.url) === n);
    if (found && found.id != null) {
      chrome.tabs.update(found.id, { active: true }, () => {
        chrome.windows.update(found.windowId, { focused: true }, () => respond({ msg: "success", mode: "focus" }));
      });
    } else {
      chrome.tabs.create({ url, active: true }, () => respond({ msg: "success", mode: "create" }));
    }
  });
}

function handleOpenDashboard(respond) {
  chrome.tabs.create({ url: chrome.runtime.getURL("assets/html/tabx.html") });
  respond({ msg: "success" });
}

/* ── context menu ── */
const CM_ROOT = "tabx-tag-root";
const CM_MANAGE = "tabx-tag-manage";
const CM_CUSTOM = "tabx-tag-custom";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "tabx-save",
      title: "Save to TabX",
      contexts: ["page", "link"],
    });
    chrome.contextMenus.create({
      id: CM_ROOT,
      title: "Tag this tab",
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id: CM_CUSTOM,
      title: "Tag as…",
      parentId: CM_ROOT,
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id: CM_MANAGE,
      title: "Manage tags…",
      parentId: CM_ROOT,
      contexts: ["page"],
    });
    rebuildTagMenu();
  });
});

/* populate the tag submenu from stored tags */
const CM_TAG_ITEMS = new Set(); /* ids we have created so we can remove stale ones */

async function rebuildTagMenu() {
  const tags = (await getStorage(TKEY)) || [];
  const activeIds = new Set();

  for (const tag of tags) {
    const id = "tabx-tag-" + tag;
    activeIds.add(id);
    chrome.contextMenus.create({
      id,
      title: "📌 " + tag,
      parentId: CM_ROOT,
      contexts: ["page"],
    });
    CM_TAG_ITEMS.add(id);
  }

  /* remove menu items for tags that no longer exist */
  for (const id of CM_TAG_ITEMS) {
    if (!activeIds.has(id)) {
      chrome.contextMenus.remove(id, () => void chrome.runtime.lastError);
      CM_TAG_ITEMS.delete(id);
    }
  }
}

chrome.runtime.onStartup.addListener(() => {
  rebuildTagMenu();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[TKEY]) rebuildTagMenu();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "tabx-save" && tab) {
    saveTabToWorkspace(tab);
    return;
  }
  if (info.menuItemId === CM_MANAGE && tab) {
    chrome.tabs.sendMessage(tab.id, { msg: "tabx:openTagManager" }).catch(() => {});
    return;
  }
  if (info.menuItemId === CM_CUSTOM && tab) {
    promptForCustomTag(tab);
    return;
  }
  if (typeof info.menuItemId === "string" && info.menuItemId.startsWith("tabx-tag-") && tab) {
    const tag = info.menuItemId.slice("tabx-tag-".length);
    tagActiveTab(tab, tag);
  }
});

async function promptForCustomTag(chromeTab) {
  try {
    const resp = await chrome.tabs.sendMessage(chromeTab.id, { msg: "tabx:promptTag" });
    if (resp?.tag) tagActiveTab(chromeTab, resp.tag);
  } catch {}
}

/* Apply a tag to the active tab — resolve the internal TabX tab via URL */
async function tagActiveTab(chromeTab, tag) {
  const userData = await getStorage(UKEY);
  if (!userData) return;

  const found = await findTabAnywhere({ url: chromeTab.url });
  if (!found) {
    /* not saved in TabX yet — offer to save it first */
    try {
      await chrome.tabs.sendMessage(chromeTab.id, {
        msg: "tabx:notSaved",
        tag,
        url: chromeTab.url,
        title: chromeTab.title,
      });
    } catch {}
    notifyTagResult(chromeTab, tag, false);
    return;
  }

  const resp = await new Promise((resolve) => {
    handleTagTabByRef({ refId: found.tab.id, tag, action: "add" }, resolve);
  });

  try {
    await chrome.tabs.sendMessage(chromeTab.id, {
      msg: resp?.msg === "error" ? "tabx:tagFailed" : "tabx:tagged",
      tag,
      tabs: [found.tab],
    });
  } catch {}
  notifyTagResult(chromeTab, tag, resp?.msg !== "error");
}

function notifyTagResult(chromeTab, tag, ok) {
  try {
    if (!chromeTab || !chromeTab.id) return;
    if (ok) {
      chrome.action.setBadgeText({ text: "✓", tabId: chromeTab.id });
      setTimeout(() => chrome.action.setBadgeText({ text: "", tabId: chromeTab.id }), 1500);
    } else {
      chrome.action.setBadgeText({ text: "✕", tabId: chromeTab.id });
      setTimeout(() => chrome.action.setBadgeText({ text: "", tabId: chromeTab.id }), 1500);
    }
  } catch {}
}

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
    tags: [],
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
