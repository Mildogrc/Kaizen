import { describe, expect, it } from 'vitest';
import {
  mandarinPronunciationCandidate,
  selectTonePairGrid,
  toneRotationPeriod,
  type MandarinPronunciationCandidate,
} from '../src/lib/mandarin-pronunciation';

function fields(word: string, firstReading: string, secondReading: string) {
  return {
    Word: { value: word },
    WordRuby: { value: `<ruby>${word[0]}<rt>${firstReading}</rt></ruby><ruby>${word[1]}<rt>${secondReading}</rt></ruby>` },
    Reading: { value: `${firstReading}${secondReading}` },
    Definition: { value: '<b>test definition</b>' },
    WordAudio: { value: '[sound:word.mp3]' },
    SentenceAudio: { value: '[sound:sentence.mp3]' },
  };
}

function candidate(id: string, word: string): MandarinPronunciationCandidate {
  return {
    ankiCardId: id,
    word,
    definition: word,
    syllables: [{ pinyin: 'mā', tone: 1 }, { pinyin: 'má', tone: 2 }],
    tonePair: '1-2',
    audioFilename: `${id}.mp3`,
  };
}

describe('Mandarin pronunciation tone pairs', () => {
  it('uses the word audio rather than sentence audio', () => {
    expect(mandarinPronunciationCandidate('1', fields('中国', 'zhōng', 'guó'))).toMatchObject({
      tonePair: '1-2',
      audioFilename: 'word.mp3',
      definition: 'test definition',
    });
  });

  it('places two third tones in the regular third-third bucket', () => {
    expect(mandarinPronunciationCandidate('1', fields('你好', 'nǐ', 'hǎo'))).toMatchObject({
      tonePair: '3-3',
      syllables: [{ pinyin: 'nǐ', tone: 3 }, { pinyin: 'hǎo', tone: 3 }],
    });
  });

  it('applies 不 sandhi before a fourth tone', () => {
    expect(mandarinPronunciationCandidate('1', fields('不是', 'bù', 'shì'))).toMatchObject({
      tonePair: '2-4',
      syllables: [{ pinyin: 'bú', tone: 2 }, { pinyin: 'shì', tone: 4 }],
    });
  });

  it('applies 一 sandhi based on the following tone', () => {
    expect(mandarinPronunciationCandidate('1', fields('一定', 'yī', 'dìng'))).toMatchObject({ tonePair: '2-4', syllables: [{ pinyin: 'yí', tone: 2 }, { pinyin: 'dìng', tone: 4 }] });
    expect(mandarinPronunciationCandidate('2', fields('一起', 'yī', 'qǐ'))).toMatchObject({ tonePair: '4-3', syllables: [{ pinyin: 'yì', tone: 4 }, { pinyin: 'qǐ', tone: 3 }] });
  });

  it('keeps a selection stable for three days and changes it next period', () => {
    const candidates = [candidate('1', '妈妈'), candidate('2', '今天')];
    const firstDay = new Date(2026, 0, 1, 12);
    const thirdDay = new Date(2026, 0, 3, 12);
    const nextPeriod = new Date(2026, 0, 4, 12);
    expect(toneRotationPeriod(firstDay)).toBe(toneRotationPeriod(thirdDay));
    expect(selectTonePairGrid(candidates, firstDay)['1-2']?.ankiCardId).toBe(selectTonePairGrid(candidates, thirdDay)['1-2']?.ankiCardId);
    expect(selectTonePairGrid(candidates, nextPeriod)['1-2']?.ankiCardId).not.toBe(selectTonePairGrid(candidates, thirdDay)['1-2']?.ankiCardId);
  });
});
