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
