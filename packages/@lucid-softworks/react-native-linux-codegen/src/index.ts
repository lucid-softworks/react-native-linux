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
import {generateComponent, type SpecComponent} from './componentGenerator';

export {generateModule, generateComponent};
export type {SpecModule} from './generator';
export type {SpecComponent} from './componentGenerator';

export interface GeneratedFile {
  filename: string;
  contents: string;
  // The runtime module name (TurboModuleRegistry.get('Foo')) OR the
  // Fabric component name (codegenNativeComponent('FooView')), as
  // applicable. Downstream tooling records this in the codegen
  // manifest.
  moduleName: string;
  // Distinguishes TurboModule headers from Fabric component
  // headers so autolink can wire each into CMake appropriately
  // (eg. components need a registration call site).
  kind: 'turboModule' | 'fabricComponent';
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
    if (!mod) continue;

    if (mod.type === 'NativeModule') {
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
        kind: 'turboModule',
      });
      continue;
    }

    if (mod.type === 'Component') {
      // Component-typed entry: each named component under
      // `.components` becomes its own header. Most spec files have
      // exactly one — `codegenNativeComponent<Props>('Foo')` — but
      // the schema is multi-component capable so we honour it.
      const components = (mod as {components?: Record<string, unknown>}).components ?? {};
      for (const componentName of Object.keys(components)) {
        const def = components[componentName] as SpecComponent['def'];
        const spec: SpecComponent = {
          specName: specBaseName,
          componentName,
          def,
        };
        // Component headers are keyed by component name (rather than
        // spec basename) so a multi-component spec doesn't produce
        // colliding filenames and so consumer #includes match the
        // JS-side `codegenNativeComponent('FooView')` literal.
        out.push({
          filename: `${componentName}Spec.h`,
          contents: generateComponent(spec),
          moduleName: componentName,
          kind: 'fabricComponent',
        });
      }
    }
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
