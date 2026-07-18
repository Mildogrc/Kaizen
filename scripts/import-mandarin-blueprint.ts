import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { syncMandarinBlueprintLevels } from '../src/lib/mandarin-blueprint';

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) throw new Error('Usage: npm run db:import-mandarin -- /absolute/path/to/MandarinBluePrint.csv');
  const result = await syncMandarinBlueprintLevels(await readFile(csvPath, 'utf8'));
  console.log(`Imported ${result.levels} Mandarin Blueprint levels: ${result.totalCharacters} characters and ${result.totalWords} words.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
