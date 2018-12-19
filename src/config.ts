import { Rank } from './rank';


export interface StyleMeterConfig {
    /**
     * An array of ranks sorted from lowest to highest score threshold.
     */
    ranks: Rank[];

    /* Scoring config */

    /**
     * The max score that can be achieved.
     */
    maxScore: number;

    /**
     * A multiplier on style points gained.
     */
    gainFactor: number;

    /**
     * A multiplier on style points lost to style degradation.
     */
    degradationFactor: number;

    /* Display config */

    rankLetterFontSizePx: number;
    rankTextFontSizePx: number;
    lineHeightPx: number;
    rankFont: string;

    /* Music config */

    musicFilepath?: string;
    maxVolume: number;
}

export const defaultStyleMeterConfig: StyleMeterConfig = {
    ranks: [
        {
            text: 'D',
            smallText: 'ope!',
            score: 10,
            color: {
                h: 180,
                s: 30,
                l: 65
            },
        },
        {
            text: 'C',
            smallText: 'razy!',
            score: 20,
            color: {
                h: 150,
                s: 30,
                l: 70
            },
        },
        {
            text: 'B',
            smallText: 'last!',
            score: 30,
            color: {
                h: 68,
                s: 30,
                l: 70
            },
        },
        {
            text: 'A',
            smallText: 'lright!',
            score: 40,
            color: {
                h: 23,
                s: 35,
                l: 70
            },
        },
        {
            text: 'S',
            smallText: 'weet!',
            score: 50,
            color: {
                h: 47,
                s: 35,
                l: 75
            },
        },
        {
            text: 'SS',
            smallText: 'howtime!!',
            score: 60,
            color: {
                h: 296,
                s: 35,
                l: 80
            }
        },
        {
            text: 'SSS',
            smallText: 'tylish!!!',
            score: 70,
            color: {
                h: 348,
                s: 100,
                l: 85
            }
        },
    ],

    maxScore: 80,
    gainFactor: 1,
    degradationFactor: 1,

    rankLetterFontSizePx: 60,
    rankTextFontSizePx: 40,
    lineHeightPx: 20,
    rankFont: 'georgia',

    maxVolume: 0.15,
};
