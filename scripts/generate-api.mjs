import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { parse } from 'yaml';
const root = fileURLToPath(new URL('../', import.meta.url));
function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}
const goOutput = parse(readFileSync(root + 'api/oapi-codegen.yaml', 'utf8')).output;
mkdirSync(dirname(root + 'backend/' + goOutput), { recursive: true });
run(root + 'node_modules/.bin/tsp', ['compile', 'api']);
run('go', ['tool', 'oapi-codegen', '--config', '../api/oapi-codegen.yaml', '../api/generated/openapi.yaml'], root + 'backend');
run(root + 'node_modules/.bin/openapi-typescript', ['api/generated/openapi.yaml', '-o', 'src/api/generated/schema.d.ts']);
