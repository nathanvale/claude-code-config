#!/usr/bin/env bun
// THROWAWAY SPIKE — proves the "honest self-healing doctor" token-DX mechanic.
// Not production code. Secret-free: the token is already valid; this never
// reads token bytes, never contacts a portal, never attaches Chrome.
//
// Q1 doctor renders EVERY gate state without crashing (incl. the
//    `create-credential-clean-profile` continuation that crashes shipped CLI).
// Q2 profile-gate self-heal: a scratch credential-clean profile drives the
//    real supervisor status to 5/5 green; a dirty one blocks. Show the flip.
// Q3 reload mechanic sketch.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { realpathSync } from "node:fs";

const REPO = realpathSync(join(import.meta.dir, "..", "..", "..", "..", ".."));
const SUP = join(REPO, "runtime/browser-use-environment-auth/.build/release/browser-use-op-supervisor");
const OP = spawnSync("bash", ["-lc", "command -v op"]).stdout.toString().trim();
const CONFIG_ROOT = realpathSync(`${process.env.HOME}/.config/browser-use`);

const CLEAN_ENV = { ...process.env };
for (const k of ["OP_SERVICE_ACCOUNT_TOKEN","OP_CONNECT_TOKEN","OP_CONNECT_HOST","BROWSER_USE_TOKEN","BROWSER_USE_OP_TOKEN"]) delete (CLEAN_ENV as Record<string,string|undefined>)[k];

// ---- the crash-proof doctor renderer (the thing to graduate) ----------------
type Gate = { status: string; cause?: string; visible_count?: number };
type Env = { state?: string; ok?: boolean; checks?: Record<string, Gate>; next_action?: string; lane?: {selected?:string;status?:string} };

// One-command repair per red gate. NOTE: the repair text is what the SHIPPED CLI
// tries to emit through error.message and crashes on ("credential"). The doctor
// keeps it in a rendered line, never in a facade error.message, so it renders.
const REPAIR: Record<string, string> = {
  "missing-token": "browser-use auth reload            # re-pull the token from 1Password",
  "process-failed": "browser-use auth reload            # token stale/expired — re-install from op",
  "unsafe-ancestry": "move the custody root off a symlinked path (rare; dotfiles setups)",
  "invalid-vault-scope": "browser-use auth repair-vault-grant",
  "profile-policy-unproven": "browser-use auth doctor --fix profile   # create a credential-clean Agent Chrome profile",
  "profile-policy-unsafe": "browser-use auth doctor --fix profile   # existing profile has saved logins — recreate clean",
};
const GATE_ORDER = ["token_file", "op", "token", "vault_scope", "profile_policy"];

function renderDoctor(env: Env): string {
  const lines: string[] = [];
  const checks = env.checks ?? {};
  let red = 0;
  lines.push(`browser-use auth doctor  —  lane: ${env.lane?.selected ?? "?"}`);
  for (const g of GATE_ORDER) {
    const c = checks[g] as Gate | undefined;
    const st = c?.status ?? "unknown";
    const ok = st === "ready";
    if (!ok) red++;
    const mark = ok ? "OK " : st === "unproven" ? "-- " : "XX ";
    const extra = c?.visible_count !== undefined ? ` (${c.visible_count} vault)` : "";
    let line = `  [${mark}] ${g.padEnd(14)} ${st}${extra}`;
    if (!ok && c?.cause) {
      const fix = REPAIR[c.cause] ?? `(see: browser-use auth doctor --explain ${g})`;
      line += `\n         cause: ${c.cause}\n         fix:   ${fix}`;
    }
    lines.push(line);
  }
  lines.push(red === 0 ? "  => ALL GREEN — env lane ready." : `  => ${red} gate(s) need attention (repairs above).`);
  return lines.join("\n");
}

// ---- supervisor status probe (secret-free) ----------------------------------
function supervisorStatus(profilePath: string): Env {
  const r = spawnSync(SUP, ["status", "--config-root", CONFIG_ROOT, "--op-path", OP, "--profile-path", profilePath],
    { env: CLEAN_ENV, encoding: "utf8" });
  try { return JSON.parse(r.stdout); } catch { return { state: "parse-fail", checks: {} }; }
}

// ---- scratch credential-clean / dirty profile builders ----------------------
function makeProfile(clean: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "doctor-spike-profile-"));
  chmodSync(root, 0o700);
  const def = join(root, "Default");
  mkdirSync(def, { mode: 0o700 });
  const prefs = clean
    ? { credentials_enable_service: false, profile: { password_manager_enabled: false }, autofill: { profile_enabled: false, credit_card_enabled: false }, sync: { requested: false } }
    : { credentials_enable_service: true,  profile: { password_manager_enabled: true  }, autofill: { profile_enabled: true,  credit_card_enabled: true  }, sync: { requested: true  } };
  writeFileSync(join(def, "Preferences"), JSON.stringify(prefs));
  return root;
}

function run() {
  console.log("=== SPIKE: honest self-healing token doctor ===");
  console.log("supervisor:", SUP, "\nop:", OP, "\nconfig-root:", CONFIG_ROOT, "\n");

  // Q1a — SHIPPED CLI on the current (profile-red) state: expect CRASH (the bug).
  const shipped = spawnSync("bash", ["-lc",
    `cd ${REPO} && bun run browser-use auth status --json`], { env: CLEAN_ENV, encoding: "utf8" });
  const crashed = /CliRuntimeContractError/.test(shipped.stdout + shipped.stderr);
  console.log(`Q1a shipped 'auth status' on current state -> ${crashed ? "CRASH (CliRuntimeContractError) ❌  [bug reproduced]" : "rendered"}`);

  // Q1b — the doctor renders the SAME real state without crashing.
  const realProfile = realpathSync(`${process.env.HOME}/.config/browser-use/warm-profile`);
  const realEnv = supervisorStatus(realProfile);
  console.log("\nQ1b doctor render — REAL current state:");
  console.log(renderDoctor(realEnv));

  // Q1c — doctor renders synthetic ALL-GREEN and ALL-RED without crashing.
  console.log("\nQ1c doctor render — synthetic ALL-GREEN:");
  console.log(renderDoctor({ lane:{selected:"environment-injected-op"}, checks: Object.fromEntries(GATE_ORDER.map(g=>[g,{status:"ready"}])) }));
  console.log("\nQ1c doctor render — synthetic ALL-RED (every cause, incl. 'credential' continuation):");
  console.log(renderDoctor({ lane:{selected:"environment-injected-op"}, checks: {
    token_file:{status:"blocked",cause:"unsafe-ancestry"}, op:{status:"blocked",cause:"process-failed"},
    token:{status:"blocked",cause:"missing-token"}, vault_scope:{status:"blocked",cause:"invalid-vault-scope"},
    profile_policy:{status:"blocked",cause:"profile-policy-unproven"} } }));

  // Q2 — self-heal: dirty scratch profile blocks; clean scratch profile -> 5/5 green. Show the flip.
  const dirty = makeProfile(false), clean = makeProfile(true);
  try {
    const dirtyEnv = supervisorStatus(dirty);
    const cleanEnv = supervisorStatus(clean);
    const dirtyProfile = dirtyEnv.checks?.profile_policy?.status;
    const cleanAll = GATE_ORDER.every(g => cleanEnv.checks?.[g]?.status === "ready");
    console.log(`\nQ2 dirty scratch profile  -> profile_policy: ${dirtyProfile} (${dirtyEnv.checks?.profile_policy?.cause ?? "-"})  [expect blocked]`);
    console.log("Q2 CLEAN scratch profile -> doctor render:");
    console.log(renderDoctor(cleanEnv));
    console.log(`\nQ2 VERDICT: self-heal drives 5/5 green? ${cleanAll ? "PASS ✅" : "FAIL ❌"}  (flip proven: dirty=${dirtyProfile}, clean=all-green=${cleanAll})`);
  } finally {
    rmSync(dirty, { recursive: true, force: true });
    rmSync(clean, { recursive: true, force: true });
  }

  // Q3 — reload mechanic sketch (no secret executed here).
  console.log("\nQ3 reload sketch: `auth reload` = op read \"op://<vault>/<item>/credential\" | install-token --stdin --replace");
  console.log("   install-token --stdin --replace is already shipped (proven this morning when Nathan reloaded).");
  console.log("   Missing piece: persist the item reference at install time so reload needs no args.");
}

run();
