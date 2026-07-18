export type JlptLevel = 'N5' | 'N4' | 'N3' | 'N2' | 'N1';

export interface JlptGrammarRow {
  pattern: string;
  relatedKanji: string | null;
  meaning: string;
  exampleJapanese: string;
  exampleEnglish: string;
  jlptLevel: JlptLevel;
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  const pushCell = () => {
    row.push(cell.trim());
    cell = '';
  };
  const pushRow = () => {
    pushCell();
    if (row.some((value) => value !== '')) rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      pushCell();
    } else if (character === '\n') {
      pushRow();
    } else if (character !== '\r') {
      cell += character;
    }
  }
  if (cell !== '' || row.length > 0) pushRow();
  return rows;
}

const CORRECTIONS: Partial<Record<JlptLevel, Record<string, Partial<JlptGrammarRow>>>> = {
  N4: {
    '～のようてほしい': { pattern: '～のようにしてほしい' },
    '～させられる': { exampleJapanese: '先生に読ませられた。' },
    '～られる': { exampleJapanese: '漢字が読めます。' },
  },
  N3: {
    '～になれる': { pattern: '～に慣れる' },
  },
  N2: {
    'いったんーば': { pattern: 'いったん～ば' },
  },
};

function repairShiftedN1Rows(rows: JlptGrammarRow[]): JlptGrammarRow[] {
  const shiftStart = rows.findIndex(
    (row, index) => index > 0 && row.pattern === '～が早いか' && row.meaning === 'If only',
  );
  if (shiftStart === -1) return rows;
  const repaired = rows.map((row) => ({ ...row }));
  for (let index = shiftStart; index < repaired.length - 1; index++) {
    repaired[index].pattern = repaired[index + 1].pattern;
  }
  return repaired.slice(0, -1);
}

export function parseJlptGrammarCsv(text: string, jlptLevel: JlptLevel): JlptGrammarRow[] {
  const rows = parseCsvRows(text);
  const headers = rows[0] ?? [];
  const column = (name: string) => headers.indexOf(name);
  const grammarColumn = column('Grammar');
  const kanjiColumn = column('Kanji');
  const explanationColumn = column('Explanation');
  const exampleJapaneseColumn = column('Example (JP)');
  const exampleEnglishColumn = column('Translation (EN)');
  if ([grammarColumn, explanationColumn, exampleJapaneseColumn, exampleEnglishColumn].some((index) => index < 0)) {
    throw new Error(`Missing required columns in ${jlptLevel} grammar CSV.`);
  }

  let parsed = rows.slice(1).flatMap((row) => {
    const pattern = row[grammarColumn]?.trim() ?? '';
    const meaning = row[explanationColumn]?.trim() ?? '';
    if (!pattern || (/^\d+$/.test(pattern) && !meaning)) return [];
    return [{
      pattern,
      relatedKanji: row[kanjiColumn]?.trim() || null,
      meaning,
      exampleJapanese: row[exampleJapaneseColumn]?.trim() ?? '',
      exampleEnglish: row[exampleEnglishColumn]?.trim() ?? '',
      jlptLevel,
    }];
  });

  if (jlptLevel === 'N1') parsed = repairShiftedN1Rows(parsed);
  const corrections = CORRECTIONS[jlptLevel] ?? {};
  parsed = parsed.map((row) => ({ ...row, ...(corrections[row.pattern] ?? {}) }));

  const seen = new Set<string>();
  return parsed.filter((row) => {
    if (!row.meaning || seen.has(row.pattern)) return false;
    seen.add(row.pattern);
    return true;
  });
}

export function grammarSourceKey(row: JlptGrammarRow): string {
  return `jlpt:${row.jlptLevel}:${row.pattern.normalize('NFKC').replace(/\s+/g, ' ').trim()}`;
}
