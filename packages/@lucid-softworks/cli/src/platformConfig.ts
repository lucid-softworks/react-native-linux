import path from 'path';
import fs from 'fs';

export interface LinuxProjectConfig {
  sourceDir: string;
  cmakeListsPath: string;
  executableName: string;
}

export interface LinuxDependencyConfig {
  sourceDir: string;
  cmakeTarget?: string;
}

export function projectConfig(
  root: string,
  userConfig: Partial<LinuxProjectConfig> = {},
): LinuxProjectConfig | null {
  const sourceDir = userConfig.sourceDir
    ? path.resolve(root, userConfig.sourceDir)
    : path.join(root, 'linux');

  if (!fs.existsSync(path.join(sourceDir, 'CMakeLists.txt'))) {
    return null;
  }

  return {
    sourceDir,
    cmakeListsPath: path.join(sourceDir, 'CMakeLists.txt'),
    executableName: userConfig.executableName ?? deriveExecutableName(root),
  };
}

export function dependencyConfig(
  root: string,
  userConfig: Partial<LinuxDependencyConfig> = {},
): LinuxDependencyConfig | null {
  const sourceDir = userConfig.sourceDir
    ? path.resolve(root, userConfig.sourceDir)
    : path.join(root, 'linux');

  if (!fs.existsSync(path.join(sourceDir, 'CMakeLists.txt'))) {
    return null;
  }

  return {
    sourceDir,
    cmakeTarget: userConfig.cmakeTarget,
  };
}

function deriveExecutableName(root: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return String(pkg.name ?? 'rn-linux-app').replace(/[^a-zA-Z0-9_-]/g, '-');
  } catch {
    return 'rn-linux-app';
  }
}

// Strip the npm scope, hyphenate non-identifier runs, then PascalCase
// — that's what the GtkApplication appId tail uses as its app-name
// component when no override is set, and what the .desktop file's
// Name= line falls back to.
//
// Examples:
//   "@acme/widget-factory"  → "WidgetFactory"
//   "hello world!"          → "HelloWorld"
//   ""                      → "RnLinuxApp"
export function deriveAppName(root: string): string {
  let raw = 'rn-linux-app';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (typeof pkg.name === 'string' && pkg.name.length > 0) {
      raw = pkg.name;
    }
  } catch {
    /* fall through to the default */
  }
  const stripped = raw.replace(/^@[^/]+\//, '');
  const parts = stripped.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (parts.length === 0) return 'RnLinuxApp';
  return parts.map(p => p[0].toUpperCase() + p.slice(1).toLowerCase()).join('');
}

// Reverse-DNS application identifier. GApplication requires:
//   * at least one period
//   * only [A-Za-z0-9_-]
//   * does not start/end with period, no consecutive periods
//
// Order of precedence:
//   1. package.json `rnLinux.applicationId` — explicit override.
//   2. package.json `name` if it already has the reverse-DNS shape.
//   3. Derived: `app.lucidsoft.<DerivedAppName>` (matches the playground's
//      style and is always GApplication-valid).
//
// `rn-linux-app` style names are already valid (single segment), so when
// a caller passes one we keep the value but inject a leading
// `app.lucidsoft.` so GApplication accepts it.
export function deriveApplicationId(root: string): string {
  const fallbackPrefix = 'app.lucidsoft.';
  let pkg: Record<string, unknown> = {};
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  } catch {
    /* fall through */
  }

  const rnLinux = pkg.rnLinux as Record<string, unknown> | undefined;
  if (rnLinux && typeof rnLinux.applicationId === 'string' && rnLinux.applicationId.length > 0) {
    const explicit = rnLinux.applicationId.trim();
    if (isValidApplicationId(explicit)) {
      return explicit;
    }
  }

  if (typeof pkg.name === 'string' && isValidApplicationId(pkg.name)) {
    return pkg.name;
  }

  return fallbackPrefix + deriveAppName(root);
}

function isValidApplicationId(s: string): boolean {
  // GLib's `g_application_id_is_valid`: at least one `.`, only the
  // listed chars, no leading / trailing / consecutive periods.
  if (!s.includes('.')) return false;
  if (s.startsWith('.') || s.endsWith('.')) return false;
  if (s.includes('..')) return false;
  return /^[A-Za-z0-9_.-]+$/.test(s);
}
