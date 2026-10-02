import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  runTransaction,
  push,
  set,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

const config = window.APP_CONFIG || {};
const LOCAL_KEY = "job-app-wars-counts";
const LOCAL_AUDIT_KEY = "job-app-wars-audit";

const els = {
  sidCount: document.getElementById("sid-count"),
  arnavCount: document.getElementById("arnav-count"),
  sidPlus: document.getElementById("sid-plus"),
  sidMinus: document.getElementById("sid-minus"),
  arnavPlus: document.getElementById("arnav-plus"),
  arnavMinus: document.getElementById("arnav-minus"),
  sidSide: document.querySelector(".side--sid"),
  arnavSide: document.querySelector(".side--arnav"),
  sidPos: document.querySelector(".side--sid .side__pos"),
  arnavPos: document.querySelector(".side--arnav .side__pos"),
  leadText: document.getElementById("lead-text"),
  totalCount: document.getElementById("total-count"),
  dealBtn: document.getElementById("deal-btn"),
  dealModal: document.getElementById("deal-modal"),
  dealClose: document.getElementById("deal-close"),
  toast: document.getElementById("toast"),
  dbHealth: document.getElementById("db-health"),
  dbHealthLabel: document.getElementById("db-health-label"),
};

const state = {
  sid: 0,
  arnav: 0,
  busy: false,
  mode: "local",
  db: null,
  dbRef: null,
};

function isFirebaseConfigured() {
  const fb = config.firebase || {};
  return Boolean(fb.apiKey && fb.databaseURL && fb.projectId);
}

function isDiscordConfigured() {
  return Boolean(config.discordWebhookUrl && config.discordWebhookUrl.startsWith("https://"));
}

function readLocalCounts() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return { sid: 0, arnav: 0 };
    const parsed = JSON.parse(raw);
    return {
      sid: Number(parsed.sid) || 0,
      arnav: Number(parsed.arnav) || 0,
    };
  } catch {
    return { sid: 0, arnav: 0 };
  }
}

function writeLocalCounts(counts) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(counts));
}

function showToast(message) {
  els.toast.hidden = false;
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast._timer);
  showToast._timer = window.setTimeout(() => {
    els.toast.classList.remove("show");
  }, 2400);
}

function setDbHealth(status, label) {
  if (!els.dbHealth || !els.dbHealthLabel) return;
  els.dbHealth.dataset.status = status;
  els.dbHealthLabel.textContent = label;
  els.dbHealth.title = label;
}

function renderCounts() {
  const prevSid = els.sidCount.textContent;
  const prevArnav = els.arnavCount.textContent;

  els.sidCount.textContent = String(state.sid);
  els.arnavCount.textContent = String(state.arnav);
  els.totalCount.textContent = String(state.sid + state.arnav);

  if (prevSid !== String(state.sid)) {
    els.sidCount.classList.remove("pop");
    void els.sidCount.offsetWidth;
    els.sidCount.classList.add("pop");
  }
  if (prevArnav !== String(state.arnav)) {
    els.arnavCount.classList.remove("pop");
    void els.arnavCount.offsetWidth;
    els.arnavCount.classList.add("pop");
  }

  const sidLeading = state.sid > state.arnav;
  const arnavLeading = state.arnav > state.sid;

  els.sidSide.classList.toggle("leading", sidLeading);
  els.arnavSide.classList.toggle("leading", arnavLeading);

  if (els.sidPos && els.arnavPos) {
    if (sidLeading) {
      els.sidPos.textContent = "P1";
      els.arnavPos.textContent = "P2";
    } else if (arnavLeading) {
      els.sidPos.textContent = "P2";
      els.arnavPos.textContent = "P1";
    } else {
      els.sidPos.textContent = "P1";
      els.arnavPos.textContent = "P1";
    }
  }

  if (state.sid === state.arnav) {
    els.leadText.textContent = "Dead heat — lights out when you apply.";
  } else if (sidLeading) {
    els.leadText.textContent = `Sid in P1 by ${state.sid - state.arnav}. Arnav buys if it sticks.`;
  } else {
    els.leadText.textContent = `Arnav in P1 by ${state.arnav - state.sid}. Sid buys if it sticks.`;
  }

  updateButtonAvailability();
}

function updateButtonAvailability() {
  if (!els.sidMinus || !els.arnavMinus) return;
  els.sidMinus.disabled = state.busy || state.sid <= 0;
  els.arnavMinus.disabled = state.busy || state.arnav <= 0;
  els.sidPlus.disabled = state.busy;
  els.arnavPlus.disabled = state.busy;
}

function setBusy(isBusy) {
  state.busy = isBusy;
  updateButtonAvailability();
}

function auditEntry(person, action, from, to) {
  return {
    person,
    action,
    from,
    to,
    at: Date.now(),
    atIso: new Date().toISOString(),
  };
}

function writeLocalAudit(entry) {
  try {
    const raw = localStorage.getItem(LOCAL_AUDIT_KEY);
    const list = raw ? JSON.parse(raw) : [];
    list.push(entry);
    localStorage.setItem(LOCAL_AUDIT_KEY, JSON.stringify(list.slice(-200)));
  } catch (error) {
    console.error(error);
  }
}

async function writeFirebaseAudit(entry) {
  const auditRef = push(ref(state.db, "audit"));
  await set(auditRef, entry);
}

async function notifyDiscord(person, newCount, action) {
  if (!isDiscordConfigured()) return;

  const name = person === "sid" ? config.names?.sid || "Sid" : config.names?.arnav || "Arnav";
  const color = action === "minus" ? 0xff8f8f : person === "sid" ? 0xe10600 : 0x0090ff;
  const other = person === "sid" ? state.arnav : state.sid;
  const otherName = person === "sid" ? config.names?.arnav || "Arnav" : config.names?.sid || "Sid";
  const verb = action === "minus" ? "undid an app" : "just sent another app";

  const payload = {
    content: `**${name}** ${verb}.`,
    embeds: [
      {
        title: "Job App Wars",
        description: `${name} is now at **${newCount}** applications.`,
        color,
        fields: [
          {
            name: config.names?.sid || "Sid",
            value: String(person === "sid" ? newCount : state.sid),
            inline: true,
          },
          {
            name: config.names?.arnav || "Arnav",
            value: String(person === "arnav" ? newCount : state.arnav),
            inline: true,
          },
          {
            name: "Gap",
            value:
              newCount === other
                ? "Tied"
                : newCount > other
                  ? `${name} up by ${newCount - other}`
                  : `${otherName} still ahead by ${other - newCount}`,
            inline: true,
          },
        ],
        footer: { text: "Job App Wars · Loser pays for drinks" },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    const response = await fetch(config.discordWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`Discord webhook failed (${response.status})`);
    }
  } catch (error) {
    console.error(error);
    showToast("Count saved, but Discord notify failed.");
  }
}

async function changeLocal(person, delta) {
  const from = state[person];
  const to = from + delta;
  if (to < 0) return;

  const next = { sid: state.sid, arnav: state.arnav, [person]: to };
  writeLocalCounts(next);
  state.sid = next.sid;
  state.arnav = next.arnav;

  const action = delta > 0 ? "plus" : "minus";
  writeLocalAudit(auditEntry(person, action, from, to));
  renderCounts();
  await notifyDiscord(person, to, action);
}

async function changeFirebase(person, delta) {
  const personRef = ref(state.db, `counts/${person}`);
  let from = 0;
  let to = 0;

  const result = await runTransaction(personRef, (current) => {
    from = Number(current) || 0;
    to = from + delta;
    if (to < 0) return from;
    return to;
  });

  if (!result.committed) {
    throw new Error("Could not update count");
  }

  const committed = Number(result.snapshot.val()) || 0;
  if (committed === from && delta < 0 && from === 0) {
    showToast("Already at zero.");
    return;
  }

  state[person] = committed;
  const action = delta > 0 ? "plus" : "minus";
  await writeFirebaseAudit(auditEntry(person, action, from, committed));
  renderCounts();
  await notifyDiscord(person, committed, action);
}

async function handleChange(person, delta) {
  if (state.busy) return;
  if (delta < 0 && state[person] <= 0) return;

  setBusy(true);
  try {
    if (state.mode === "firebase") {
      await changeFirebase(person, delta);
    } else {
      await changeLocal(person, delta);
    }
  } catch (error) {
    console.error(error);
    showToast("Could not update the counter. Check Firebase rules.");
  } finally {
    setBusy(false);
  }
}

function initDealModal() {
  els.dealBtn.addEventListener("click", () => {
    if (typeof els.dealModal.showModal === "function") {
      els.dealModal.showModal();
    }
  });

  els.dealClose.addEventListener("click", () => {
    els.dealModal.close();
  });

  els.dealModal.addEventListener("click", (event) => {
    const rect = els.dealModal.getBoundingClientRect();
    const inDialog =
      rect.top <= event.clientY &&
      event.clientY <= rect.top + rect.height &&
      rect.left <= event.clientX &&
      event.clientX <= rect.left + rect.width;
    if (!inDialog) els.dealModal.close();
  });
}

function initButtons() {
  const buttons = [els.sidPlus, els.sidMinus, els.arnavPlus, els.arnavMinus];
  for (const button of buttons) {
    if (!button) continue;
    button.addEventListener("click", () => {
      const person = button.dataset.person;
      const delta = Number(button.dataset.delta);
      if (!person || !Number.isFinite(delta) || delta === 0) return;
      handleChange(person, delta);
    });
  }
}

function initFirebase() {
  setDbHealth("checking", "DB checking…");

  const app = initializeApp(config.firebase);
  state.db = getDatabase(app);
  state.dbRef = ref(state.db, "counts");
  state.mode = "firebase";

  const connectedRef = ref(state.db, ".info/connected");
  onValue(connectedRef, (snap) => {
    if (snap.val() === true) {
      setDbHealth("connected", "DB connected");
    } else if (state.mode === "firebase") {
      setDbHealth("checking", "DB reconnecting…");
    }
  });

  onValue(
    state.dbRef,
    (snapshot) => {
      const values = snapshot.val() || { sid: 0, arnav: 0 };
      state.sid = Number(values.sid) || 0;
      state.arnav = Number(values.arnav) || 0;
      renderCounts();
      setDbHealth("connected", "DB connected");
    },
    (error) => {
      console.error(error);
      setDbHealth("error", "DB denied — publish rules");
      showToast("Database blocked. Publish Realtime Database rules.");
    }
  );

  window.setTimeout(() => {
    if (els.dbHealth?.dataset.status === "checking") {
      setDbHealth("error", "DB timeout — check rules");
    }
  }, 8000);
}

function initLocal(reason) {
  state.mode = "local";
  const counts = readLocalCounts();
  state.sid = counts.sid;
  state.arnav = counts.arnav;
  renderCounts();
  setDbHealth("local", reason || "DB local only");
  showToast(reason || "Local mode — Firebase not configured.");
}

function boot() {
  initDealModal();
  initButtons();
  setDbHealth("checking", "DB checking…");

  if (isFirebaseConfigured()) {
    try {
      initFirebase();
    } catch (error) {
      console.error(error);
      initLocal("DB failed — local mode");
    }
  } else {
    initLocal("DB not configured");
  }

  if (!isDiscordConfigured()) {
    console.info("Discord webhook not set. Add discordWebhookUrl in config.js.");
  }
}

boot();
