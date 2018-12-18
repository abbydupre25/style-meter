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

    /* Music config */

    musicFilepath?: string;
    maxVolume: number;
}

export const defaultStyleMeterConfig = {
    ranks: [
        {
            text: 'D',
            smallText: 'ope!',
            smallTextOffsetRem: 3,
            score: 0,
            color: '#89a7a7',
        },
        {
            text: 'C',
            smallText: 'razy!',
            smallTextOffsetRem: 2.8,
            score: 20,
            color: '#b3cdc0',
        },
        {
            text: 'B',
            smallText: 'last!',
            smallTextOffsetRem: 2.5,
            score: 30,
            color: '#aeb295',
        },
        {
            text: 'A',
            smallText: 'lright!',
            smallTextOffsetRem: 2.5,
            score: 40,
            color: '#caad9a',
        },
        {
            text: 'S',
            smallText: 'weet!',
            smallTextOffsetRem: 2,
            score: 50,
            color: '#b2889e',
        },
        {
            text: 'SS',
            smallText: 'howtime!!',
            smallTextOffsetRem: 4,
            score: 60,
            color: '#d4b7d6',
        },
        {
            text: 'SSS',
            smallText: 'tylish!!!',
            smallTextOffsetRem: 6,
            score: 70,
            color: '#ffb9c6',
        },
    ],

    maxScore: 80,
    gainFactor: 1,
    degradationFactor: 1,

    maxVolume: 0.15,
};
