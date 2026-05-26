import fs from 'fs';
import os from 'os';
import path from 'path';
import {projectConfig, dependencyConfig} from '../platformConfig';

function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rn-linux-cli-test-'));
}

describe('projectConfig', () => {
  let root: string;
  beforeEach(() => {
    root = makeTempRoot();
  });
  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true});
  });

  test('returns null when linux/CMakeLists.txt is absent', () => {
    expect(projectConfig(root, {})).toBeNull();
  });

  test('returns a config when linux/CMakeLists.txt exists', () => {
    fs.mkdirSync(path.join(root, 'linux'));
    fs.writeFileSync(path.join(root, 'linux', 'CMakeLists.txt'), '');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({name: 'hello world!'}));

    const cfg = projectConfig(root, {});

    expect(cfg).not.toBeNull();
    expect(cfg!.sourceDir).toBe(path.join(root, 'linux'));
    expect(cfg!.cmakeListsPath).toBe(path.join(root, 'linux', 'CMakeLists.txt'));
    // Derived from package.json's name, sanitized.
    expect(cfg!.executableName).toBe('hello-world-');
  });

  test('userConfig.executableName wins over derivation', () => {
    fs.mkdirSync(path.join(root, 'linux'));
    fs.writeFileSync(path.join(root, 'linux', 'CMakeLists.txt'), '');
    const cfg = projectConfig(root, {executableName: 'custom-app'});
    expect(cfg!.executableName).toBe('custom-app');
  });

  test('falls back to rn-linux-app when no package.json present', () => {
    fs.mkdirSync(path.join(root, 'linux'));
    fs.writeFileSync(path.join(root, 'linux', 'CMakeLists.txt'), '');
    const cfg = projectConfig(root, {});
    expect(cfg!.executableName).toBe('rn-linux-app');
  });
});

describe('dependencyConfig', () => {
  let root: string;
  beforeEach(() => {
    root = makeTempRoot();
  });
  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true});
  });

  test('returns null when linux/CMakeLists.txt is absent', () => {
    expect(dependencyConfig(root, {})).toBeNull();
  });

  test('returns a config when present', () => {
    fs.mkdirSync(path.join(root, 'linux'));
    fs.writeFileSync(path.join(root, 'linux', 'CMakeLists.txt'), '');
    const cfg = dependencyConfig(root, {cmakeTarget: 'my_module'});
    expect(cfg).not.toBeNull();
    expect(cfg!.sourceDir).toBe(path.join(root, 'linux'));
    expect(cfg!.cmakeTarget).toBe('my_module');
  });

  test('honors a custom sourceDir', () => {
    fs.mkdirSync(path.join(root, 'native', 'linux'), {recursive: true});
    fs.writeFileSync(path.join(root, 'native', 'linux', 'CMakeLists.txt'), '');
    const cfg = dependencyConfig(root, {sourceDir: 'native/linux'});
    expect(cfg).not.toBeNull();
    expect(cfg!.sourceDir).toBe(path.join(root, 'native', 'linux'));
  });
});
