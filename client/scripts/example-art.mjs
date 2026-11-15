// Grava os desenhos do elenco de exemplo e do marketplace em public/example/ (npm run example-art).
// Os arquivos ficam no repositório: o banco guarda só o link example/<nome>.svg.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exampleFiles } from '../src/art.js';

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const files = exampleFiles();
await mkdir(join(pub, 'example'), { recursive: true });
for (const f of files) await writeFile(join(pub, f.key), f.svg);
console.log(`${files.length} arquivos em public/example/`);
