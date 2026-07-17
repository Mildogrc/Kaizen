// Minimal declarations for kuromoji (ships without types). Covers only the
// surface this app uses: builder → tokenizer → tokenize with IPADIC features.

declare module 'kuromoji' {
  export interface IpadicFeatures {
    word_id: number;
    word_type: string;
    word_position: number;
    surface_form: string;
    pos: string;
    pos_detail_1: string;
    pos_detail_2: string;
    pos_detail_3: string;
    conjugated_type: string;
    conjugated_form: string;
    basic_form: string;
    reading?: string;
    pronunciation?: string;
  }

  export interface Tokenizer<T> {
    tokenize(text: string): T[];
  }

  export interface TokenizerBuilder<T> {
    build(callback: (err: Error | null, tokenizer: Tokenizer<T>) => void): void;
  }

  export function builder(options: { dicPath: string }): TokenizerBuilder<IpadicFeatures>;

  const kuromoji: { builder: typeof builder };
  export default kuromoji;
}
