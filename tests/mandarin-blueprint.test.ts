import { describe, expect, it } from 'vitest';
import { parseChishoHtml, parseMandarinBlueprintCsv } from '../src/lib/mandarin-blueprint';

describe('Mandarin Blueprint import', () => {
  it('carries phases across CSV rows and splits characters', () => {
    const rows = parseMandarinBlueprintCsv('Phase,Level,# of new Characters,# of total Characters,# of new Words,# of Words,% of Words,# new for Phase,Weeks,Characters\n1,1,2,2,3,3,1%,2,1,一二\n,2,1,3,2,5,2%,,,三');
    expect(rows).toEqual([
      { phase: 1, level: 1, newCharacters: 2, totalCharacters: 2, newWords: 3, totalWords: 3, weeks: 1, characters: ['一', '二'] },
      { phase: 1, level: 2, newCharacters: 1, totalCharacters: 3, newWords: 2, totalWords: 5, weeks: null, characters: ['三'] },
    ]);
  });

  it('extracts pinyin, definitions, and audio from Chisho', () => {
    const html = '<li><span class="annotation text-sm">qī jiān / qí jiān</span><span class="character text-3xl">期間 〔-间〕</span><audio src="media/female/qi1jian1.mp3"></audio><div class="basis-3/4 pl-1"><div>1. period of time</div><div>2. time period</div></div></li>';
    const entry = parseChishoHtml('期间', html);
    expect(entry.pinyin).toEqual(['qī jiān', 'qí jiān']);
    expect(entry.definitions).toEqual(['period of time', 'time period']);
    expect(entry.audioUrls[0]).toBe('https://chisho.org/media/female/qi1jian1.mp3');
  });
});
