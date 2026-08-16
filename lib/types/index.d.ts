/**
 * dsh-plugin-doctor — health checks for DeepSeek Harness plugins.
 *
 * Mirrors the `dsh plugin check` proposal from
 * https://github.com/deepseek-ai/deepseek-harness/discussions/1629:
 * manifest structure, patch validity, entry points, build, pack, and a real
 * dsh install/boot smoke test.
 * @module dsh-plugin-doctor
 */
export interface CheckResult {
    name: string;
    status: 'PASS' | 'WARN' | 'FAIL';
    detail: string;
}
export interface DoctorReport {
    ok: boolean;
    checks: CheckResult[];
}
export interface DoctorOptions {
    /** Run build (pnpm run build) when a build script exists. */
    build?: boolean;
    /** Full mode: pack, install into a temp dsh profile, and boot web. */
    full?: boolean;
    /** Command used to launch dsh (default: pnpm dlx @deepseek-ai/dsh). */
    dshCommand?: string[];
    /** Timeout for external commands in milliseconds. */
    timeoutMs?: number;
}
/**
 * Check a dsh profile for a real-directory copy of `@deepseek-ai/*` shadowing
 * the host instance. With `nodeLinker: hoisted`, a profile-installed plugin's
 * transitive `@deepseek-ai/dsh-tools` can be hoisted to the profile's top-level
 * node_modules; Node then resolves the shadowed copy for bare specifiers and
 * every tool call can crash with `Cannot read properties of undefined
 * (reading 'prepare')` (deepseek-harness discussion #1697).
 * @param profileDir - absolute path of the dsh profile to inspect.
 */
export declare function checkProfileShadowing(profileDir: string): CheckResult;
/**
 * Check a dsh profile's package.json for a UTF-8 BOM. dsh's
 * `readProfileManifest` (packages/boot/app-boot/src/profile.ts:267-272)
 * parses with `JSON.parse(readFileSync(path, 'utf8'))`, and a leading U+FEFF
 * crashes `dsh web` at boot with `Unexpected token` (discussion #1842).
 * @param profileDir - absolute path of the dsh profile to inspect.
 */
export declare function checkManifestBom(profileDir: string): CheckResult;
/**
 * Session-size tripwire for the #1859 class: a single giant event log can
 * blow past V8's ~512 MB string cap during search-index reconciliation.
 * Reports the largest files in a profile (skipping dependency trees) so
 * operators get warned before the cliff.
 */
export declare function checkLargeFiles(profileDir: string, thresholdBytes?: number): CheckResult;
/**
 * Installed-plugin entry-point check for the #1965 class: a marketplace
 * install that copies a source checkout without building leaves
 * `package.json` `main`/`exports` pointing at missing files, and `dsh web`
 * dies at boot with `Cannot find package ... index.js`.
 * @param profileDir - absolute path of the dsh profile to inspect.
 */
export declare function checkEntryPoints(profileDir: string): CheckResult;
/**
 * Pruned-runtime-tree tripwire for the #2081 class. `healProfilesModuleFallback`
 * re-links the shared runtime tree (typically `$DSH_HOME/profiles/node_modules`)
 * to the deployment anchor on every launch. A bare `npm install` in that
 * package.json-less tree makes npm prune every existing package, after which
 * `dsh web` fails with `ERR_MODULE_NOT_FOUND` and does not self-heal.
 * @param profileDir - absolute path of the dsh profile to inspect.
 */
export declare function checkProfileDeps(profileDir: string): CheckResult;
/**
 * Native-module presence tripwire for the npm 11 `allow-scripts=false` class
 * (#2081). koffi/node-pty rely on postinstall builds; when npm skips those
 * scripts the packages are installed but unusable. Reports a WARN (not FAIL)
 * because a minimal profile may legitimately not carry these modules.
 * @param profileDir - absolute path of the dsh profile to inspect.
 */
export declare function checkNativeModules(profileDir: string): CheckResult;
/**
 * Broken tool-call tripwire for the #2334 class: a tool call that is declared
 * but never receives a paired result leaves a broken message sequence that
 * makes every following turn fail (and new sessions inherit it). Decodes any
 * session logs under `dir` and reports call ids with no matching result.
 * @param dir - directory to scan for `session.jsonl(.zstd)` files.
 */
export declare function checkToolCallPairing(dir: string): CheckResult;
/**
 * Heuristic lint for the #1863 class: a `pre-execute` listener that performs
 * host-level side effects before returning `ask` defeats approval (approval
 * is consent UX, not a sandbox). Flags side-effect APIs in files that
 * reference pre-execute. This is a review aid, not a security sandbox.
 */
export declare function checkPreExecuteSideEffects(dir: string): CheckResult;
/**
 * Heuristic risk check for the #1923 class: a plugin that spawns child
 * processes AND invokes shell-launcher surfaces (explorer/start/open/
 * powershell/cmd) can delegate execution to a user-privileged context,
 * bypassing approval and workspace-write limits. This is a review aid —
 * not a sandbox and not a security audit.
 */
export declare function checkShellLauncher(dir: string): CheckResult;
/**
 * Supply-chain poison preflight for the #1629/#1719 class: delegate to the
 * `dsh-poison-guard` scanner (AST + deobfuscation) when it is installed, and
 * degrade to a WARN with install instructions when it is not. Keeping this a
 * soft dependency leaves the doctor lightweight while still giving every
 * plugin author an AST-grade poisoning check before publish.
 * @param dir - plugin bundle directory to scan.
 */
export declare function checkSupplyChainSecurity(dir: string): CheckResult;
export interface ManifestView {
    name?: string;
    version?: string;
    main?: string;
    files?: string[];
    prepare?: string;
    patch?: string;
    dshBundle?: boolean;
}
/** Read and summarize the plugin manifest, or return null when missing. */
export declare function readManifest(dir: string): ManifestView | null;
export interface PatchEntry {
    id: string;
    name: string;
}
/** Parse cordis.patch.yml and extract plugin ids, or throw a descriptive error. */
export declare function parsePatch(content: string): PatchEntry[];
/**
 * Run the full doctor check on a plugin directory.
 * @param dir - plugin bundle directory.
 * @param options - check options.
 */
export declare function doctor(dir: string, options?: DoctorOptions): Promise<DoctorReport>;
/** Render a human-readable report. */
export declare function formatReport(report: DoctorReport): string;
