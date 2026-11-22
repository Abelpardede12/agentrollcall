// Compile all contracts with solc and write artifacts/<Name>.json
// Usage: node scripts/compile.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sources = {};
for (const name of ["AgentRollCall.sol", "MockAgentID.sol"]) {
  sources[name] = { content: readFileSync(join(root, "contracts", name), "utf8") };
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    // Pin "paris": solc 0.8.26 defaults to Cancun, whose MCOPY opcode breaks
    // string-returning functions on Shanghai/Paris EVMs (and older tooling).
    evmVersion: "paris",
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
  },
};

function findImport(path) {
  try {
    return { contents: readFileSync(join(root, "node_modules", path), "utf8") };
  } catch {
    return { error: `File not found: ${path}` };
  }
}

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImport }));
const errors = (output.errors || []).filter((e) => e.severity === "error");
if (errors.length) {
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}
for (const w of output.errors || []) console.warn(w.formattedMessage.trim());

mkdirSync(join(root, "artifacts"), { recursive: true });
const KEEP = new Set(["AgentRollCall", "MockAgentID"]); // skip OpenZeppelin deps/interfaces
for (const [file, contracts] of Object.entries(output.contracts)) {
  for (const [name, c] of Object.entries(contracts)) {
    if (!KEEP.has(name)) continue;
    const artifact = {
      contractName: name,
      source: file,
      abi: c.abi,
      bytecode: "0x" + c.evm.bytecode.object,
      deployedBytecode: "0x" + c.evm.deployedBytecode.object,
      bytecodeBytes: c.evm.bytecode.object.length / 2,
    };
    writeFileSync(join(root, "artifacts", `${name}.json`), JSON.stringify(artifact, null, 2));
    console.log(`${name}: compiled OK, bytecode ${artifact.bytecodeBytes} bytes`);
  }
}
