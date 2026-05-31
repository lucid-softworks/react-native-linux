import fs from 'fs';
import os from 'os';
import path from 'path';
import type {Config} from '@react-native-community/cli-types';
import {initLinux} from '../commands/initLinux';
import {deriveAppName, deriveApplicationId} from '../platformConfig';

function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rn-linux-init-test-'));
}

describe('deriveAppName', () => {
  let root: string;
  beforeEach(() => {
    root = makeTempRoot();
  });
  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true});
  });

  test('PascalCases the package name', () => {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({name: 'hello-world'}));
    expect(deriveAppName(root)).toBe('HelloWorld');
  });

  test('strips an npm scope', () => {
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({name: '@acme/widget-factory'}),
    );
    expect(deriveAppName(root)).toBe('WidgetFactory');
  });

  test('falls back when name is empty or missing', () => {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({}));
    expect(deriveAppName(root)).toBe('RnLinuxApp');
  });

  test('handles names with no alpha characters', () => {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({name: '!!!'}));
    expect(deriveAppName(root)).toBe('RnLinuxApp');
  });
});

describe('deriveApplicationId', () => {
  let root: string;
  beforeEach(() => {
    root = makeTempRoot();
  });
  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true});
  });

  test('uses rnLinux.applicationId when valid', () => {
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({name: 'whatever', rnLinux: {applicationId: 'com.acme.Widget'}}),
    );
    expect(deriveApplicationId(root)).toBe('com.acme.Widget');
  });

  test('ignores rnLinux.applicationId when malformed', () => {
    // Missing a period — invalid per GApplication's contract.
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({name: 'widget', rnLinux: {applicationId: 'no-dot'}}),
    );
    expect(deriveApplicationId(root)).toBe('app.lucidsoft.Widget');
  });

  test('uses package.json `name` directly when it is reverse-DNS', () => {
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({name: 'works.lucidsoft.Demo'}),
    );
    expect(deriveApplicationId(root)).toBe('works.lucidsoft.Demo');
  });

  test('synthesizes app.lucidsoft.<Name> from a non-DNS name', () => {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({name: 'hello-world'}));
    expect(deriveApplicationId(root)).toBe('app.lucidsoft.HelloWorld');
  });

  test('rejects ids that start or end with a period', () => {
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({name: 'demo', rnLinux: {applicationId: '.foo.bar'}}),
    );
    expect(deriveApplicationId(root)).toBe('app.lucidsoft.Demo');
  });
});

describe('init-linux', () => {
  let root: string;
  beforeEach(() => {
    root = makeTempRoot();
  });
  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true});
  });

  async function runInitLinux(opts: {overwrite?: boolean} = {}): Promise<void> {
    const ctx = {root} as unknown as Config;
    // The CLI command's `func` signature is opaquely typed in
    // @react-native-community/cli-types; cast through unknown to
    // exercise the same call shape the CLI uses.
    const fn = initLinux.func as unknown as (
      argv: string[],
      ctx: Config,
      opts: unknown,
    ) => Promise<void>;
    await fn([], ctx, {overwrite: opts.overwrite ?? false});
  }

  test('substitutes placeholders from package.json', async () => {
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({name: '@acme/widget-factory'}),
    );

    await runInitLinux();

    const main = fs.readFileSync(path.join(root, 'linux', 'main.cpp'), 'utf8');
    expect(main).toContain('cfg.applicationId = "app.lucidsoft.WidgetFactory"');
    expect(main).toContain('cfg.windowTitle = "WidgetFactory"');
    expect(main).not.toContain('__RNL_');

    const desktop = fs.readFileSync(path.join(root, 'linux', 'app.desktop'), 'utf8');
    expect(desktop).toContain('Name=WidgetFactory');
    expect(desktop).toContain('StartupWMClass=app.lucidsoft.WidgetFactory');
    expect(desktop).not.toContain('__RNL_');
  });

  test('honors an explicit rnLinux.applicationId', async () => {
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({name: 'demo', rnLinux: {applicationId: 'com.acme.OtherDemo'}}),
    );

    await runInitLinux();

    const main = fs.readFileSync(path.join(root, 'linux', 'main.cpp'), 'utf8');
    expect(main).toContain('cfg.applicationId = "com.acme.OtherDemo"');
    expect(main).toContain('cfg.windowTitle = "Demo"');
  });

  test('refuses to overwrite an existing linux/ without --overwrite', async () => {
    fs.mkdirSync(path.join(root, 'linux'));
    fs.writeFileSync(path.join(root, 'linux', 'leave-me-alone'), 'hi');
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((_code?: number) => {
      throw new Error('process.exit called');
    }) as never);
    await expect(runInitLinux()).rejects.toThrow('process.exit called');
    expect(fs.readFileSync(path.join(root, 'linux', 'leave-me-alone'), 'utf8')).toBe('hi');
    exitSpy.mockRestore();
  });
});
