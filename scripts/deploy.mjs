// Deploy AgentRollCall to BNB Smart Chain mainnet and hand ownership to the
// project's Agentic Wallet.
//
// ⚠️  DO NOT RUN until the deployer address below has been funded with BNB
//     (deployment costs roughly 1.77M gas ≈ a few cents of BNB, plus a small
//     buffer for the ownership transfer).
//
// Usage:
//   node scripts/compile.mjs   # first, to (re)build artifacts/
//   node scripts/deploy.mjs
//
// Key handling:
// - The deployer private key lives ONLY in .keys/deployer.json (mode 600,
//   gitignored). If the file does not exist, this script generates a fresh
//   wallet, writes the file, prints ONLY the new address, and exits so the
//   address can be funded first.
// - The key is never printed, logged, or included in any output.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY_FILE = join(root, ".keys", "deployer.json");
const RPC_URL = "https://bsc-dataseed.binance.org";

// Agent ID registry on BNB Smart Chain (SPACE ID Agent ID, ERC-721).
const AGENT_ID_REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";
// Final contract owner: the project owner's Agentic Wallet.
const FINAL_OWNER = "0xd0F225Dd9bD7a9Ec675Ecf2D162a76446244FaB2";

function loadOrCreateWallet(provider) {
  if (!existsSync(KEY_FILE)) {
    const wallet = ethers.Wallet.createRandom();
    writeFileSync(KEY_FILE, JSON.stringify({ privateKey: wallet.privateKey }, null, 2), { mode: 0o600 });
    console.log("A new deployer wallet was generated and saved to .keys/deployer.json (mode 600).");
    console.log(`Deployer address: ${wallet.address}`);
    console.log("ACTION REQUIRED: fund this address with a small amount of BNB on BNB Smart Chain,");
    console.log("then re-run this script to deploy. (The private key was NOT printed anywhere.)");
    process.exit(0);
  }
  const { privateKey } = JSON.parse(readFileSync(KEY_FILE, "utf8"));
  return new ethers.Wallet(privateKey, provider);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const network = await provider.getNetwork();
if (Number(network.chainId) !== 56) {
  throw new Error(`Wrong network: expected chainId 56 (BNB Smart Chain), got ${network.chainId}`);
}

const wallet = loadOrCreateWallet(provider);
const deployer = wallet.address;
const balance = await provider.getBalance(deployer);
console.log(`Deployer: ${deployer}`);
console.log(`Balance:  ${ethers.formatEther(balance)} BNB`);
if (balance === 0n) {
  console.log("Balance is zero — fund the deployer address first, then re-run.");
  process.exit(0);
}

const artifact = JSON.parse(readFileSync(join(root, "artifacts", "AgentRollCall.json"), "utf8"));
const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

console.log(`Deploying AgentRollCall with Agent ID registry ${AGENT_ID_REGISTRY} …`);
const contract = await factory.deploy(AGENT_ID_REGISTRY);
const deployTx = contract.deploymentTransaction();
console.log(`Deploy tx: ${deployTx.hash}`);
await contract.waitForDeployment();
const contractAddress = await contract.getAddress();
const deployReceipt = await deployTx.wait();
console.log(`Deployed at: ${contractAddress} (block ${deployReceipt.blockNumber}, gas ${deployReceipt.gasUsed})`);

console.log(`Transferring ownership to ${FINAL_OWNER} …`);
const transferTx = await contract.transferOwnership(FINAL_OWNER);
console.log(`Ownership transfer tx: ${transferTx.hash}`);
await transferTx.wait();
console.log(`New owner: ${await contract.owner()}`);

console.log("\n================ DEPLOYMENT SUMMARY ================");
console.log(`Contract:        AgentRollCall`);
console.log(`Address:         ${contractAddress}`);
console.log(`Deploy block:    ${deployReceipt.blockNumber}`);
console.log(`Deploy tx:       ${deployTx.hash}`);
console.log(`Ownership tx:    ${transferTx.hash}`);
console.log(`Owner:           ${FINAL_OWNER}`);
console.log(`BscScan:         https://bscscan.com/address/${contractAddress}`);
console.log("====================================================");
console.log("Next steps:");
console.log("1. Verify the contract source on BscScan (match compiler settings in scripts/compile.mjs).");
console.log("2. Put the address + deploy block into site/app.js CONFIG.");
console.log("3. Publish the site, then submit the project before 2026-12-09 08:00 UTC.");
process.exit(0);
