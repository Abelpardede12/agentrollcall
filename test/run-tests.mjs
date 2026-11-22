// Local test suite for AgentRollCall, running against a Ganache server.
// Usage: node test/run-tests.mjs   (run scripts/compile.mjs first)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ganache from "ganache";
import { ethers } from "ethers";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (n) => JSON.parse(readFileSync(join(root, "artifacts", `${n}.json`), "utf8"));

let passed = 0;
let failed = 0;
const failures = [];

function ok(cond, label) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL  ${label}`);
  }
}

function errorHaystack(e) {
  let hay = [
    e?.message || "",
    e?.reason || "",
    e?.shortMessage || "",
    JSON.stringify(e?.info || {}),
    JSON.stringify(e?.error || {}),
    String(e?.data || ""),
  ].join(" ");
  // Ganache often embeds the revert reason only as raw Error(string) data
  // (selector 0x08c379a0) inside the error payload — decode it if present.
  const m = hay.match(/0x08c379a0[0-9a-fA-F]{16,}/);
  if (m) {
    try {
      hay += " " + ethers.AbiCoder.defaultAbiCoder().decode(["string"], "0x" + m[0].slice(10))[0];
    } catch { /* ignore */ }
  }
  return hay;
}

async function expectRevert(promise, reasonPart, label, staticThunk) {
  try {
    const res = await promise;
    if (res && typeof res.wait === "function") await res.wait();
    ok(false, `${label} (did NOT revert)`);
  } catch (e) {
    let hay = errorHaystack(e);
    // Repeat calls from the same account sometimes revert on-chain without
    // ethers surfacing the reason; replay as eth_call to harvest it.
    if (!hay.includes(reasonPart) && staticThunk) {
      try {
        await staticThunk();
      } catch (e2) {
        hay += " " + errorHaystack(e2);
      }
    }
    ok(
      hay.includes(reasonPart),
      `${label} (reverted${hay.includes(reasonPart) ? ` with "${reasonPart}"` : `, unexpected: ${hay.slice(0, 160)}`})`
    );
  }
}

const server = ganache.server({ logging: { quiet: true } });
await server.listen(8545);
const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
const deployer = await provider.getSigner(0);
const alice = await provider.getSigner(1);
const bob = await provider.getSigner(2);
const carol = await provider.getSigner(3);
const [aliceAddr, bobAddr] = await Promise.all([alice, bob].map((s) => s.getAddress()));
const carolAddr = await carol.getAddress();

async function advanceDays(n) {
  await provider.send("evm_increaseTime", [n * 86400]);
  await provider.send("evm_mine", []);
}

// --- Deploy ---------------------------------------------------------------
const mockArt = load("MockAgentID");
const mock = await new ethers.ContractFactory(mockArt.abi, mockArt.bytecode, deployer).deploy();
await mock.waitForDeployment();

const rcArt = load("AgentRollCall");
const rc = await new ethers.ContractFactory(rcArt.abi, rcArt.bytecode, deployer).deploy(await mock.getAddress());
const deployReceipt = await rc.deploymentTransaction().wait();
await rc.waitForDeployment();
console.log(`Deployed AgentRollCall at ${await rc.getAddress()}`);
console.log(`Deployment gas used: ${deployReceipt.gasUsed.toString()}\n`);

const rcAlice = rc.connect(alice);
const rcBob = rc.connect(bob);
const rcCarol = rc.connect(carol);

// --- Tests ----------------------------------------------------------------
console.log("Check-in gating:");
await expectRevert(rcCarol.checkIn(), "Agent ID required", "non-holder cannot check in");

await (await mock.mint(aliceAddr)).wait();
const rcpt1 = await (await rcAlice.checkIn()).wait();
const ev1 = rcpt1.logs
  .map((l) => { try { return rc.interface.parseLog(l); } catch { return null; } })
  .find((p) => p && p.name === "CheckedIn");
ok(!!ev1 && ev1.args.currentStreak === 1n, "holder check-in emits CheckedIn with streak 1");

let u = await rc.getUser(aliceAddr);
ok(u.currentStreak === 1n && u.bestStreak === 1n && u.totalCheckIns === 1n && u.checkedInToday === true,
  "getUser after first check-in: streak 1, total 1, checkedInToday true");
ok((await rc.totalAgents()) === 1n && (await rc.totalCheckInsAll()) === 1n, "global counters: 1 agent, 1 check-in");

await expectRevert(rcAlice.checkIn(), "Already checked in today", "second check-in same day reverts", () => rcAlice.checkIn.staticCall());

console.log("\nBadge threshold gating:");
await expectRevert(rcAlice.claimBadge(0), "Streak requirement not met", "badge claim at streak 1 reverts");

await advanceDays(1);
await (await rcAlice.checkIn()).wait();
u = await rc.getUser(aliceAddr);
ok(u.currentStreak === 2n, "next-day check-in increments streak to 2");
await expectRevert(rcAlice.claimBadge(0), "Streak requirement not met", "badge claim at streak 2 still reverts");

await advanceDays(1);
await (await rcAlice.checkIn()).wait();
u = await rc.getUser(aliceAddr);
ok(u.currentStreak === 3n && u.bestStreak === 3n && u.totalCheckIns === 3n, "third consecutive day: streak 3");

console.log("\nBadge claiming:");
await (await rc.setBaseURI("https://agentrollcall.example/badge/")).wait();
await (await rcAlice.claimBadge(0)).wait();
ok((await rc.balanceOf(aliceAddr)) === 1n, "badge minted at streak 3 (balanceOf = 1)");
ok(Number(await rc.tokenTier(1)) === 0, "token 1 is tier 0");
ok((await rc.tokenURI(1)) === "https://agentrollcall.example/badge/0", "tokenURI = baseURI + tier");
ok((await rc.badgeClaimed(aliceAddr, 0)) === true && (await rc.badgeClaimed(aliceAddr, 1)) === false,
  "badgeClaimed flags correct");
await expectRevert(rcAlice.claimBadge(0), "Badge already claimed", "second claim of same tier reverts", () => rcAlice.claimBadge.staticCall(0));
await expectRevert(rcAlice.claimBadge(4), "Invalid tier", "claiming invalid tier reverts");
await expectRevert(rcCarol.claimBadge(0), "Agent ID required", "non-holder cannot claim badge");

console.log("\nSoulbound:");
await expectRevert(rcAlice.transferFrom(aliceAddr, bobAddr, 1), "soulbound", "badge transferFrom reverts");
await expectRevert(rcAlice["safeTransferFrom(address,address,uint256)"](aliceAddr, bobAddr, 1), "soulbound", "badge safeTransferFrom reverts");

console.log("\nStreak reset after a gap:");
await (await mock.mint(bobAddr)).wait();
await (await rcBob.checkIn()).wait();
u = await rc.getUser(bobAddr);
ok(u.currentStreak === 1n, "bob first check-in: streak 1");

await advanceDays(2); // bob misses a full day
u = await rc.getUser(bobAddr);
ok(u.currentStreak === 0n && u.checkedInToday === false, "after a missed day, live streak reads 0");
await (await rcBob.checkIn()).wait();
u = await rc.getUser(bobAddr);
ok(u.currentStreak === 1n && u.bestStreak === 1n && u.totalCheckIns === 2n, "check-in after gap resets streak to 1");

u = await rc.getUser(aliceAddr);
ok(u.currentStreak === 0n && u.bestStreak === 3n && u.totalCheckIns === 3n, "alice: streak broken by gap, best streak 3 preserved");
await expectRevert(rcAlice.claimBadge(1), "Streak requirement not met", "broken streak cannot claim tier 1 badge");

console.log("\nGlobal counters:");
ok((await rc.totalAgents()) === 2n, "totalAgents = 2 (alice + bob)");
ok((await rc.totalCheckInsAll()) === 5n, "totalCheckInsAll = 5 (alice 3 + bob 2)");

console.log(`\n===== RESULT: ${passed} passed, ${failed} failed =====`);
if (failures.length) {
  console.log("Failed tests:");
  for (const f of failures) console.log(`  - ${f}`);
}
await server.close();
process.exit(failed ? 1 : 0);
