"use strict";

/* =====================================================================
   CONFIG — the ONLY place that needs editing after deployment.
   ===================================================================== */
const CONFIG = {
  // >>> TO BE FILLED AFTER DEPLOYMENT <<<
  // Address of the deployed AgentRollCall contract on BNB Smart Chain.
  CONTRACT_ADDRESS: "0x65f916589D30ea97e1f38C39D5b99aa99f111eDA",
  // >>> TO BE FILLED AFTER DEPLOYMENT <<<
  // Block number the contract was deployed at (used as the event scan floor).
  DEPLOY_BLOCK: 135044164,

  CHAIN_ID: 56, // BNB Smart Chain
  CHAIN_HEX: "0x38",
  RPC_URL: "https://bsc-dataseed.binance.org",
  EXPLORER: "https://bscscan.com",
  // Agent ID registry on BNB Smart Chain (ERC-721 "SPACE ID Agent ID").
  // An address holds an Agent ID iff balanceOf(address) > 0 here.
  AGENT_ID_REGISTRY: "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F",
};

const TIERS = [
  { tier: 0, name: "3-Day Streak", days: 3, emoji: "🥉" },
  { tier: 1, name: "7-Day Streak", days: 7, emoji: "🥈" },
  { tier: 2, name: "14-Day Streak", days: 14, emoji: "🥇" },
  { tier: 3, name: "30-Day Streak", days: 30, emoji: "👑" },
];

/* =====================================================================
   State + element handles
   ===================================================================== */
const $ = (id) => document.getElementById(id);
const els = {
  connectBtn: $("connectBtn"), checkInBtn: $("checkInBtn"), checkInHint: $("checkInHint"),
  agentIdStatus: $("agentIdStatus"), noticeBar: $("noticeBar"), errorBar: $("errorBar"),
  statAgents: $("statAgents"), statCheckIns: $("statCheckIns"),
  statMyStreak: $("statMyStreak"), statMyBest: $("statMyBest"),
  statMyTotal: $("statMyTotal"), statMyBadges: $("statMyBadges"),
  badgeGrid: $("badgeGrid"), leaderboard: $("leaderboard"), feed: $("activityFeed"),
};

let walletProvider = null; // ethers BrowserProvider (injected wallet)
let signer = null;
let userAddress = null;
let userInfo = null;       // { currentStreak, bestStreak, totalCheckIns, lastDay, checkedInToday }
let holdsAgentId = false;
let claimedBadges = [false, false, false, false];
let busy = false;

const contractConfigured = () =>
  typeof CONFIG.CONTRACT_ADDRESS === "string" &&
  /^0x[0-9a-fA-F]{40}$/.test(CONFIG.CONTRACT_ADDRESS);

const readProvider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
const readContract = contractConfigured()
  ? new ethers.Contract(CONFIG.CONTRACT_ADDRESS, ROLLCALL_ABI, readProvider)
  : null;
const registryRead = new ethers.Contract(CONFIG.AGENT_ID_REGISTRY, AGENT_ID_REGISTRY_ABI, readProvider);

const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
const dayToDate = (day) => new Date(Number(day) * 86400 * 1000).toISOString().slice(0, 10);

function showError(msg) {
  els.errorBar.textContent = msg;
  els.errorBar.classList.remove("hidden");
  setTimeout(() => els.errorBar.classList.add("hidden"), 9000);
}
function friendlyError(e) {
  return e?.reason || e?.shortMessage || e?.message || "Something went wrong.";
}

/* =====================================================================
   Wallet connection (injected wallet ONLY — no QR / pairing codes)
   ===================================================================== */
async function ensureBscNetwork() {
  const current = await walletProvider.getNetwork();
  if (Number(current.chainId) === CONFIG.CHAIN_ID) return;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CONFIG.CHAIN_HEX }],
    });
  } catch (e) {
    if (e.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: CONFIG.CHAIN_HEX,
          chainName: "BNB Smart Chain",
          nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
          rpcUrls: [CONFIG.RPC_URL],
          blockExplorerUrls: [CONFIG.EXPLORER],
        }],
      });
    } else {
      throw e;
    }
  }
}

async function connectWallet() {
  if (!window.ethereum) {
    showError("No wallet found. Please open this page in a browser with a Web3 wallet extension or an in-app wallet browser.");
    return;
  }
  try {
    walletProvider = new ethers.BrowserProvider(window.ethereum);
    await walletProvider.send("eth_requestAccounts", []);
    await ensureBscNetwork();
    signer = await walletProvider.getSigner();
    userAddress = await signer.getAddress();
    els.connectBtn.textContent = shortAddr(userAddress);
    await refreshUser();
  } catch (e) {
    showError(friendlyError(e));
  }
}

if (window.ethereum) {
  window.ethereum.on?.("accountsChanged", () => window.location.reload());
  window.ethereum.on?.("chainChanged", () => window.location.reload());
}

/* =====================================================================
   Data loading
   ===================================================================== */
async function refreshGlobals() {
  if (!readContract) return;
  try {
    const [agents, checkIns] = await Promise.all([
      readContract.totalAgents(),
      readContract.totalCheckInsAll(),
    ]);
    els.statAgents.textContent = agents.toString();
    els.statCheckIns.textContent = checkIns.toString();
  } catch { /* keep last shown values */ }
}

async function refreshUser() {
  if (!userAddress) return;
  try {
    const bal = await registryRead.balanceOf(userAddress);
    holdsAgentId = bal > 0n;
    els.agentIdStatus.className = `id-status ${holdsAgentId ? "yes" : "no"}`;
    els.agentIdStatus.textContent = holdsAgentId
      ? `✅ Agent ID detected for ${shortAddr(userAddress)} — you're on the list.`
      : `❌ No Agent ID found for ${shortAddr(userAddress)}. Agent IDs are claimed inside the Binance app (Wallet → Agent ID).`;

    if (readContract) {
      const u = await readContract.getUser(userAddress);
      userInfo = {
        currentStreak: Number(u.currentStreak),
        bestStreak: Number(u.bestStreak),
        totalCheckIns: Number(u.totalCheckIns),
        lastDay: Number(u.lastDay),
        checkedInToday: u.checkedInToday,
      };
      els.statMyStreak.textContent = userInfo.currentStreak;
      els.statMyBest.textContent = userInfo.bestStreak;
      els.statMyTotal.textContent = userInfo.totalCheckIns;
      els.statMyBadges.textContent = (await readContract.balanceOf(userAddress)).toString();
      claimedBadges = await Promise.all(
        TIERS.map((t) => readContract.badgeClaimed(userAddress, t.tier))
      );
    }
  } catch (e) {
    showError(friendlyError(e));
  }
  renderCheckInButton();
  renderBadges();
}

/* Fetch recent CheckedIn events, scanning backwards in chunks. */
async function fetchRecentCheckIns(maxEvents = 300) {
  if (!readContract) return [];
  const latest = await readProvider.getBlockNumber();
  const floor = Math.max(CONFIG.DEPLOY_BLOCK || 0, latest - 250000);
  const events = [];
  let to = latest;
  while (to > floor && events.length < maxEvents) {
    const from = Math.max(floor, to - 4999);
    try {
      const batch = await readContract.queryFilter(readContract.filters.CheckedIn(), from, to);
      events.unshift(...batch);
    } catch { /* skip chunk on RPC limits */ }
    to = from - 1;
  }
  return events.slice(-maxEvents);
}

async function refreshFeedAndLeaderboard() {
  if (!readContract) {
    els.feed.innerHTML = `<li class="muted">Contract not deployed yet.</li>`;
    els.leaderboard.innerHTML = `<li class="muted">Contract not deployed yet.</li>`;
    return;
  }
  try {
    const events = await fetchRecentCheckIns(300);

    // Activity feed: latest 15, newest first.
    const last15 = events.slice(-15).reverse();
    els.feed.innerHTML = last15.length
      ? last15.map((ev) => {
          const a = ev.args;
          return `<li><span class="mono">${shortAddr(a.user)}</span> checked in · streak <strong>${a.currentStreak.toString()}</strong> · <span class="muted">${dayToDate(a.day)} (UTC)</span></li>`;
        }).join("")
      : `<li class="muted">No check-ins yet — be the first.</li>`;

    // Leaderboard: unique recent users → live streaks via getUser.
    const users = [...new Set(events.map((ev) => ev.args.user))].slice(-40);
    const rows = [];
    for (const addr of users) {
      try {
        const u = await readContract.getUser(addr);
        if (Number(u.currentStreak) > 0) {
          rows.push({
            addr,
            streak: Number(u.currentStreak),
            best: Number(u.bestStreak),
            total: Number(u.totalCheckIns),
          });
        }
      } catch { /* skip */ }
    }
    rows.sort((x, y) => y.streak - x.streak || y.best - x.best || y.total - x.total);
    els.leaderboard.innerHTML = rows.length
      ? rows.slice(0, 10).map((r, i) =>
          `<li><span class="rank">#${i + 1}</span> <span class="mono">${shortAddr(r.addr)}</span> — <strong>${r.streak} day${r.streak === 1 ? "" : "s"}</strong> <span class="muted">(best ${r.best})</span></li>`
        ).join("")
      : `<li class="muted">No active streaks right now.</li>`;
  } catch { /* keep previous render */ }
}

/* =====================================================================
   Rendering
   ===================================================================== */
function nextUtcMidnightText() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const mins = Math.max(1, Math.round((next - now.getTime()) / 60000));
  return `Next check-in opens in about ${Math.floor(mins / 60)}h ${mins % 60}m (UTC day rollover).`;
}

function renderCheckInButton() {
  const btn = els.checkInBtn;
  btn.disabled = true;
  if (!contractConfigured()) {
    btn.textContent = "Check In Today";
    els.checkInHint.textContent = "The contract is not deployed yet — check back soon.";
    return;
  }
  if (!userAddress) {
    btn.textContent = "Check In Today";
    els.checkInHint.textContent = "Connect your wallet first.";
    return;
  }
  if (!holdsAgentId) {
    btn.textContent = "Agent ID Required";
    els.checkInHint.textContent = "Only Agent ID holders can check in.";
    return;
  }
  if (userInfo?.checkedInToday) {
    btn.textContent = "✅ Checked In — See You Tomorrow";
    els.checkInHint.textContent = nextUtcMidnightText();
    return;
  }
  btn.textContent = "📋 Check In Today";
  els.checkInHint.textContent = userInfo && userInfo.currentStreak > 0
    ? `Your streak is alive at ${userInfo.currentStreak} day(s). Don't break it!`
    : "Start (or restart) your streak — it only takes one tap.";
  btn.disabled = busy;
}

function renderBadges() {
  els.badgeGrid.innerHTML = TIERS.map((t) => {
    const claimed = claimedBadges[t.tier];
    let action;
    if (claimed) {
      action = `<div class="badge-state claimed">✅ Claimed</div>`;
    } else if (!userAddress) {
      action = `<div class="badge-state muted">Connect wallet to claim</div>`;
    } else if (!holdsAgentId) {
      action = `<div class="badge-state muted">Requires an Agent ID</div>`;
    } else if (userInfo && userInfo.currentStreak >= t.days) {
      action = `<button class="btn btn-primary claim-btn" data-tier="${t.tier}" ${busy ? "disabled" : ""}>Claim Badge</button>`;
    } else {
      const have = userInfo ? userInfo.currentStreak : 0;
      action = `<div class="badge-state muted">🔒 ${t.days - have} more day(s) of streak needed</div>`;
    }
    return `<div class="badge-card">
      <div class="badge-emoji">${t.emoji}</div>
      <div class="badge-name">${t.name}</div>
      <div class="badge-req">Reach a ${t.days}-day streak</div>
      ${action}
    </div>`;
  }).join("");

  els.badgeGrid.querySelectorAll(".claim-btn").forEach((b) =>
    b.addEventListener("click", () => claimBadge(Number(b.dataset.tier)))
  );
}

/* =====================================================================
   Actions (every action requires explicit confirmation in the wallet)
   ===================================================================== */
function walletContract() {
  return new ethers.Contract(CONFIG.CONTRACT_ADDRESS, ROLLCALL_ABI, signer);
}

async function checkIn() {
  if (!signer || busy) return;
  busy = true;
  renderCheckInButton();
  try {
    const tx = await walletContract().checkIn();
    els.checkInHint.textContent = "Confirming on-chain…";
    await tx.wait();
    await refreshUser();
    await refreshGlobals();
    await refreshFeedAndLeaderboard();
  } catch (e) {
    showError(friendlyError(e));
  } finally {
    busy = false;
    renderCheckInButton();
    renderBadges();
  }
}

async function claimBadge(tier) {
  if (!signer || busy) return;
  busy = true;
  renderBadges();
  try {
    const tx = await walletContract().claimBadge(tier);
    await tx.wait();
    await refreshUser();
  } catch (e) {
    showError(friendlyError(e));
  } finally {
    busy = false;
    renderCheckInButton();
    renderBadges();
  }
}

/* =====================================================================
   Boot
   ===================================================================== */
els.connectBtn.addEventListener("click", connectWallet);
els.checkInBtn.addEventListener("click", checkIn);

if (!contractConfigured()) {
  els.noticeBar.textContent =
    "🚧 Agent Roll Call is not deployed yet. This page is a preview — the contract address will appear here once deployment is complete.";
  els.noticeBar.classList.remove("hidden");
}

renderBadges();
refreshGlobals();
refreshFeedAndLeaderboard();
setInterval(() => { refreshGlobals(); refreshFeedAndLeaderboard(); }, 60000);
