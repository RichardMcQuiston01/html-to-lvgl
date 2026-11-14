/**
 * Build the native LVGL render program from the sources shipped in this package.
 *
 * The render program (`spike/render/`) turns LVGL XML into a BMP. The editor
 * preview API and `--watch` use it. A prebuilt binary is platform specific, so
 * the package ships the small C sources and this module builds them on the
 * user's machine: it fetches LVGL v9.4.0, runs CMake, and installs the result
 * in a per-user cache that `findRenderBinary` looks in.
 *
 * Everything that touches the system (running a command, the file system) goes
 * through an injectable `deps` object so the logic is testable without a
 * toolchain or a network.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The LVGL release the XML runtime and the golden files target. */
export const LVGL_VERSION = '9.4.0';
export const LVGL_REPO = 'https://github.com/lvgl/lvgl.git';
export const CACHE_DIR_ENV = 'HTML2LVGL_CACHE_DIR';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Raised for every failure with a message that says what to install or fix. */
export class RenderBuildError extends Error {
  /**
   * @param {string} code  `toolchain_missing`, `sources_missing`, `lvgl_fetch_failed`, `configure_failed`, `build_failed` or `binary_missing`.
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'RenderBuildError';
    this.code = code;
  }
}

/** Directory of the render program's C sources inside this package (or a repository checkout). */
export function renderSourceDir(packageRoot = PACKAGE_ROOT) {
  return join(packageRoot, 'spike', 'render');
}

/** The render program's source files, in a fixed order (the hash covers exactly these). */
const SOURCE_FILES = ['CMakeLists.txt', 'lv_conf.h', 'main.c'];

/**
 * Short hash of the render program's sources. The installed binary is keyed by
 * it, so a new package version whose `main.c` changed (say, a new option the
 * preview API relies on) builds a fresh binary instead of silently reusing an
 * older one. `unknown` when the sources cannot be read.
 */
export function renderSourceHash(packageRoot = PACKAGE_ROOT) {
  try {
    const hash = createHash('sha256');
    for (const file of SOURCE_FILES) hash.update(`${file}\0`).update(readFileSync(join(renderSourceDir(packageRoot), file)));
    return hash.digest('hex').slice(0, 10);
  } catch {
    return 'unknown';
  }
}

/**
 * Per-user cache directory: `$HTML2LVGL_CACHE_DIR`, else `$XDG_CACHE_HOME/html2lvgl`,
 * else `~/.cache/html2lvgl` (`%LOCALAPPDATA%\html2lvgl` on Windows).
 *
 * @param {{ env?: Record<string, string | undefined>, home?: string, platform?: string }} [options]
 */
export function cacheDir({ env = process.env, home = homedir(), platform = process.platform } = {}) {
  if (env[CACHE_DIR_ENV]) return resolve(env[CACHE_DIR_ENV]);
  if (env.XDG_CACHE_HOME) return join(env.XDG_CACHE_HOME, 'html2lvgl');
  if (platform === 'win32' && env.LOCALAPPDATA) return join(env.LOCALAPPDATA, 'html2lvgl');
  return join(home, '.cache', 'html2lvgl');
}

/** Name of the compiled program on this platform. */
export const renderBinaryName = (platform = process.platform) => (platform === 'win32' ? 'render.exe' : 'render');

/** Where the shallow LVGL clone lives. Shared by every build of the render program. */
export function lvglCloneDir(options = {}) {
  return join(options.outDir ? resolve(options.outDir) : cacheDir(options), `lvgl-${LVGL_VERSION}`);
}

/**
 * Where the built render program is installed. The directory is named for the
 * LVGL version and a hash of the render sources, so neither an LVGL bump nor a
 * change to `main.c` reuses a stale binary.
 */
export function cachedRenderBinary(options = {}) {
  return join(cacheDir(options), `render-lvgl-${LVGL_VERSION}-${renderSourceHash(options.packageRoot)}`, 'build', renderBinaryName(options.platform));
}

/** Default command runner: inherits stdio so the user sees git and CMake output. */
function runCommand(command, args, { cwd } = {}) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  return { status: result.status, error: result.error };
}

/** Is `tool` runnable? (`git --version`, `cmake --version`.) */
function toolAvailable(tool, probe) {
  const result = probe(tool, ['--version']);
  return !result.error && result.status === 0;
}

const quietRunner = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  return { status: result.status, error: result.error };
};

/**
 * Build the render program.
 *
 * @param {object} [options]
 * @param {string} [options.lvglDir]    Use this LVGL v9.4.0 checkout instead of cloning one.
 * @param {string} [options.outDir]     Cache directory (default: {@link cacheDir}).
 * @param {boolean} [options.force]     Rebuild even when a binary is already installed.
 * @param {(msg: string) => void} [options.log]
 * @param {object} [options.deps]       Test seams: `run`, `probe`, `exists`, `packageRoot`, `platform`, `env`.
 * @returns {{ binary: string, built: boolean, lvglDir: string }}
 * @throws {RenderBuildError}
 */
export function buildRenderProgram(options = {}) {
  const log = options.log ?? (() => {});
  const deps = options.deps ?? {};
  const run = deps.run ?? runCommand;
  const probe = deps.probe ?? quietRunner;
  const exists = deps.exists ?? existsSync;
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const root = options.outDir ? resolve(options.outDir) : cacheDir({ env, platform });
  const installDir = join(root, `render-lvgl-${LVGL_VERSION}-${renderSourceHash(deps.packageRoot)}`);
  const buildDir = join(installDir, 'build');
  const binary = join(buildDir, renderBinaryName(platform));

  if (!options.force && exists(binary)) {
    log(`render program already built: ${binary}`);
    return { binary, built: false, lvglDir: join(root, `lvgl-${LVGL_VERSION}`) };
  }

  const sourceDir = renderSourceDir(deps.packageRoot);
  for (const file of SOURCE_FILES) {
    if (!exists(join(sourceDir, file))) {
      throw new RenderBuildError('sources_missing',
        `the render program source ${join(sourceDir, file)} is missing. Reinstall the package, or run this from a repository checkout.`);
    }
  }

  const needs = options.lvglDir ? ['cmake'] : ['git', 'cmake'];
  const missing = needs.filter((tool) => !toolAvailable(tool, probe));
  if (missing.length > 0) {
    throw new RenderBuildError('toolchain_missing',
      `${missing.join(' and ')} not found on PATH. Install ${missing.join(' and ')}${missing.includes('cmake') ? ' and a C compiler (gcc, clang or MSVC)' : ''}, then run --build-render again.`);
  }

  let lvglDir;
  if (options.lvglDir) {
    lvglDir = resolve(options.lvglDir);
    if (!exists(join(lvglDir, 'CMakeLists.txt'))) {
      throw new RenderBuildError('lvgl_fetch_failed', `--lvgl-dir ${lvglDir} has no CMakeLists.txt; point it at an LVGL v${LVGL_VERSION} checkout.`);
    }
  } else {
    lvglDir = join(root, `lvgl-${LVGL_VERSION}`);
    if (!exists(join(lvglDir, 'CMakeLists.txt'))) {
      mkdirSync(root, { recursive: true });
      // A failed earlier clone can leave a partial directory; start clean.
      if (exists(lvglDir)) rmSync(lvglDir, { recursive: true, force: true });
      log(`fetching LVGL v${LVGL_VERSION} (shallow clone of ${LVGL_REPO})`);
      const clone = run('git', ['clone', '--depth', '1', '--branch', `v${LVGL_VERSION}`, LVGL_REPO, lvglDir]);
      if (clone.error || clone.status !== 0) {
        throw new RenderBuildError('lvgl_fetch_failed',
          `could not clone LVGL v${LVGL_VERSION} from ${LVGL_REPO}${clone.error ? ` (${clone.error.message})` : ''}. Check your network, or clone it yourself and pass --lvgl-dir <path>.`);
      }
    }
  }

  mkdirSync(buildDir, { recursive: true });
  log('configuring (CMake)');
  const configure = run('cmake', ['-S', sourceDir, '-B', buildDir, `-DLVGL_DIR=${lvglDir}`, '-DCMAKE_BUILD_TYPE=Release']);
  if (configure.error || configure.status !== 0) {
    throw new RenderBuildError('configure_failed', `cmake could not configure the render program${configure.error ? ` (${configure.error.message})` : ''}. The output above says why; a C compiler is the usual missing piece.`);
  }
  log('compiling (this takes a minute or two)');
  const build = run('cmake', ['--build', buildDir, '--config', 'Release', '--parallel']);
  if (build.error || build.status !== 0) {
    throw new RenderBuildError('build_failed', `compiling the render program failed${build.error ? ` (${build.error.message})` : ''}. See the compiler output above.`);
  }

  // Multi-config generators (Visual Studio) put the program in build/Release.
  const found = [binary, join(buildDir, 'Release', renderBinaryName(platform))].find((p) => exists(p));
  if (!found) {
    throw new RenderBuildError('binary_missing', `the build finished but ${binary} does not exist.`);
  }
  log(`built ${found}`);
  return { binary: found, built: true, lvglDir };
}

/** One line for error messages and help text. */
export const BUILD_HINT = 'run `html2lvgl --build-render` once (needs git, cmake and a C compiler), or pass --render-bin / set HTML2LVGL_RENDER_BIN';

/** Read the package version (used by the tests to check the shipped file list). */
export function packageFiles(packageRoot = PACKAGE_ROOT) {
  return JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).files ?? [];
}
