export interface RankColor {
    readonly h: number;
    readonly s: number;
    readonly l: number;
}

export interface Rank {
    text: string;      // letter to display for style ranking
    smallText: string; // the rest of the word started by 'text'
    score: number;     // minimum score to acquire this rank
    color: RankColor;  // css color
}
