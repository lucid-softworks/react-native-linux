// Programmatic entry point for the Linux TurboModule codegen.
//
// Usage:
//
//   import {generateFromFile} from '@lucid-softworks/react-native-linux-codegen';
//
//   for (const file of files) {
//     for (const {filename, contents} of generateFromFile(file)) {
//       fs.writeFileSync(path.join(outDir, filename), contents);
//     }
//   }
//
// The runner script under scripts/codegen/run.js drives this for the
// in-tree specs; `autolinkLinux` drives it once per linked dep that
// declares a codegenConfig in its package.json.

import * as path from 'node:path';
import * as fs from 'node:fs';

import {generateModule, type SpecModule} from './generator';

export {generateModule};
export type {SpecModule} from './generator';

export interface GeneratedFile {
  filename: string;
  contents: string;
  // The runtime module name (matches `TurboModuleRegistry.get('Foo')`).
  // Useful for downstream tooling that wants to record what modules
  // were generated for a given dep.
  moduleName: string;
}

// Parse a TS spec file and emit one C++ header per NativeModule
// declared inside it. Most spec files declare a single module, but
// the parser does support multi-module files.
export function generateFromFile(specPath: string): GeneratedFile[] {
  // Defer requiring @react-native/codegen until call time so this
  // package can be loaded by tooling that doesn't have RN installed
  // (e.g. autolinkLinux running in a fresh consumer's CI before
  // node_modules is fully populated). The parser itself is required
  // when generation actually runs.
  //
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {TypeScriptParser} = require('@react-native/codegen/lib/parsers/typescript/parser');
  const parser = new TypeScriptParser();
  const schema = parser.parseFile(specPath);

  const specBaseName = path.basename(specPath).replace(/\.(ts|tsx|js)$/, '');

  const out: GeneratedFile[] = [];
  for (const moduleKey of Object.keys(schema.modules ?? {})) {
    const mod = schema.modules[moduleKey];
    if (mod?.type !== 'NativeModule') continue;
    // Use the parser-provided module key when it matches our spec
    // filename convention (Native*), otherwise fall back to the
    // basename. The C++ class name and output header filename track
    // this — implementer-facing predictability matters more than
    // schema-internal naming.
    const specName = moduleKey === specBaseName ? moduleKey : specBaseName;
    const specModule: SpecModule = {
      specName,
      moduleName: mod.moduleName,
      schema: mod,
    };
    out.push({
      filename: `${specName}Spec.h`,
      contents: generateModule(specModule),
      moduleName: mod.moduleName,
    });
  }
  return out;
}

// Convenience: write the generator output for a list of spec files
// into `outDir`. Creates `outDir` if missing. Returns the list of
// written paths so the caller can stamp / log them.
export function writeFromFiles(specPaths: string[], outDir: string): string[] {
  fs.mkdirSync(outDir, {recursive: true});
  const written: string[] = [];
  for (const specPath of specPaths) {
    for (const gen of generateFromFile(specPath)) {
      const dest = path.join(outDir, gen.filename);
      fs.writeFileSync(dest, gen.contents);
      written.push(dest);
    }
  }
  return written;
}
