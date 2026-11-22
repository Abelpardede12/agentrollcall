# Agent Roll Call

**The daily check-in for Agent ID holders.** Show up every day, build your streak on-chain, and collect soulbound badges that prove you were there.

Agent Roll Call is a dApp built for the **Binance Wallet × BNB Chain Agent ID Hackathon** (submission deadline: **2026-12-09 08:00 UTC**). It turns Agent ID from a static identity token into a living daily habit: a roll call that only Agent ID holders can answer.

---

## What it does

- **Daily check-in, gated by Agent ID.** One check-in per UTC day, available only to wallets that hold an Agent ID.
- **On-chain streaks.** Consecutive days build your current streak; your best streak and lifetime check-ins are stored on-chain too. Miss a full day and the streak restarts at 1.
- **Soulbound streak badges.** At streaks of 3, 7, 14, and 30 days you can claim a badge (an ERC-721 that can never be transferred or sold — it only proves your consistency).
- **Public activity.** Global counters (unique agents, total check-ins), a live feed of recent check-ins, and a leaderboard of the top current streaks — all read straight from contract state and events.
- **Zero custody, zero fees.** The contract never holds, receives, or moves user funds. Check-ins cost only the network gas fee.

## How Agent ID is used in the core flow

Agent ID is not decoration here — it is the access key to the product's only core action:

1. The contract is constructed with the official **Agent ID registry** on BNB Smart Chain: `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F` (ERC-721 "SPACE ID Agent ID", non-transferable).
2. Every `checkIn()` and every `claimBadge(tier)` call first executes `registry.balanceOf(msg.sender) > 0`. If the caller does not hold an Agent ID, the transaction reverts with `Agent ID required`.
3. Because Agent IDs are non-transferable and one-per-person, a streak on Agent Roll Call is a streak of a *verified agent identity*, not just of a throwaway wallet. That is what makes the leaderboard and badges meaningful: they measure the daily presence of the Agent ID community itself.

The registry address is stored as an `immutable`, so it can never be swapped after deployment.

## Features

| Feature | Detail |
|---|---|
| Check-in | `checkIn()` — once per UTC day (`block.timestamp / 86400`), Agent ID required |
| Streaks | current / best / total per user; streak continues only if yesterday was the last check-in day |
| Live streak reads | `getUser()` reports the *effective* streak (0 once a day has been missed) |
| Badges | ERC-721 "Agent Roll Call Badge" (ROLL), soulbound, tiers at 3 / 7 / 14 / 30-day streaks, one per tier per user |
| Badge metadata | `tokenURI = baseURI + tier number` |
| Stats | `totalAgents` (unique checkers-in) and `totalCheckInsAll` counters |
| Events | `CheckedIn(user, day, currentStreak, totalCheckIns)`, `BadgeClaimed(user, tier, tokenId)` |
| Website | Wallet connect (injected wallet only), BSC network switch prompt, personal stats, badge claiming, global stats, activity feed, streak leaderboard |

## Contract design & owner permissions disclosure

`contracts/AgentRollCall.sol` is a single contract that is both the check-in engine and the badge NFT (OpenZeppelin ERC-721 + Ownable, Solidity ^0.8.20).

**The owner can:**
- `setBaseURI(string)` — update the base URI used to build badge `tokenURI`s (metadata only).
- `transferOwnership(address)` — hand the above power to another address. After deployment, ownership is transferred to the project owner's Agentic Wallet (`0xd0F225Dd9bD7a9Ec675Ecf2D162a76446244FaB2`).

**The owner cannot:**
- Pause or block check-ins or badge claims.
- Mint badges for anyone (badges are minted only by `claimBadge`, only to the caller, only when the streak requirement is met).
- Change the Agent ID registry (immutable).
- Edit any user's streaks, counters, or badges.
- Move or withdraw funds — the contract has no payable user functions, no receive/fallback for value, and no withdraw/sweep function at all.

**Users always confirm their own transactions** in their own wallet. The website connects exclusively through the standard injected wallet (`window.ethereum`); there is no QR-code login, no pairing code, and no server-side session anywhere in this project.

## Safety notes

- Badges are **soulbound collectibles** that record a streak. They carry **no promised monetary value**, are not investments, and nothing in this project promises returns of any kind.
- Check-ins cost only BNB Smart Chain network gas, paid to the network.
- The site only ever *reads* whether an address holds an Agent ID (a public on-chain fact needed for access control). It does not track users off-chain and is not a tool for looking up other people's wallets — the leaderboard and feed show only Agent Roll Call's own public check-in activity, with truncated addresses.

## Repository layout

```
contracts/   AgentRollCall.sol, MockAgentID.sol (test-only registry stand-in)
site/        index.html, app.js, style.css, abi.js (generated)
scripts/     compile.mjs, gen-site-abi.mjs, deploy.mjs
test/        run-tests.mjs (Ganache-backed suite)
artifacts/   compiled ABI + bytecode (generated)
```

## Build & test locally

```bash
npm install
node scripts/compile.mjs     # compiles contracts into artifacts/
node test/run-tests.mjs      # 25 assertions: gating, streaks, resets, badges, soulbound
node scripts/gen-site-abi.mjs  # regenerates site/abi.js after recompiling
```

Toolchain is pinned for reproducibility: `solc 0.8.26`, `@openzeppelin/contracts 5.0.2`, EVM version **paris**, optimizer 200 runs. (Paris is deliberate: newer OpenZeppelin releases emit the Cancun-only `MCOPY` opcode in string handling; the pinned combination compiles cleanly and runs on any EVM.)

## Run the site

The site is fully static — serve the `site/` folder with any static host, e.g.:

```bash
npx serve site
```

Before deployment it runs in preview mode (a notice explains the contract is not live yet). After deployment, set the two marked constants at the top of `site/app.js`:

```js
CONTRACT_ADDRESS: "0x…",  // deployed AgentRollCall address
DEPLOY_BLOCK: 12345678,   // its deployment block
```

## Deployment (BNB Smart Chain mainnet)

**Live deployment (2026-11-22):**

- Contract: `0x65f916589D30ea97e1f38C39D5b99aa99f111eDA`
- BscScan: https://bscscan.com/address/0x65f916589D30ea97e1f38C39D5b99aa99f111eDA
- Deploy tx: `0xb0d48d5ef3ec4b2295772db7da1e8138666eb889f9a631254d16504c9310f874` (block 135044164)
- Owner: the project's Agentic Wallet `0xd0F225Dd9bD7a9Ec675Ecf2D162a76446244FaB2`
- Source verification: **exact match** on Sourcify (creation + runtime), forwarded to BscScan
- Live site: https://abelpardede12.github.io/agentrollcall/

Deployment is performed with `scripts/deploy.mjs` (ethers v6):

1. `node scripts/compile.mjs`
2. `node scripts/deploy.mjs` — on first run it generates a deployer wallet into `.keys/deployer.json` (mode 600, gitignored; the key is never printed) and exits after printing the address.
3. Fund that address with a small amount of BNB. Estimated deployment cost from local testing: **≈ 1.77M gas** (deployment measured at 1,768,919 gas on a local chain) plus a few ten-thousand gas for the ownership transfer — well under 0.002 BNB at typical BSC gas prices.
4. Re-run `node scripts/deploy.mjs` — it deploys `AgentRollCall` with the real Agent ID registry address, then transfers ownership to the project Agentic Wallet and prints the contract address, deploy block, and transaction hashes.

## Hackathon submission checklist

- [x] Fund deployer, deploy to BNB Smart Chain mainnet
- [x] Verify contract source (compiler: solc 0.8.26, optimizer 200 runs, EVM paris, MIT license) — Sourcify exact match, forwarded to BscScan
- [x] Fill `CONTRACT_ADDRESS` + `DEPLOY_BLOCK` in `site/app.js`; publish the site
- [ ] Set badge `baseURI` via the owner wallet if custom badge metadata is hosted
- [x] Make this repository public (open-source, MIT)
- [x] Test the live flow end-to-end with an Agent ID wallet (first check-in done 2026-11-22; badge path pending a 3-day streak)
- [ ] Submit project name, website, contract address, and Agent ID usage description via the hackathon submission channel **before 2026-12-09 08:00 UTC**
- [ ] Grow usage during the submission window: the Growth Award ranks projects by interacting Agent ID addresses and transaction count; the Innovation Award requires at least 30 Agent ID addresses to have interacted

## License

MIT
