export interface Rank {
    text: string;      // letter to display for style ranking
    smallText: string; // the rest of the word started by 'text'
    smallTextOffsetRem: number;
    score: number;     // minimum score to acquire this rank
    color: string;     // css color
}