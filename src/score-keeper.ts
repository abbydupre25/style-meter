import * as vscode from 'vscode';
import { StyleMeterConfig } from './config';


/**
 * The period at which style degradation takes place.
 * This has no real effect on difficulty.
 * Higher values update the meter more often but worsen performance.
 */
const STYLE_DEGRADE_PERIOD_MS = 500;

/**
 * The rate of style degradation in points/s^2
 */
const STYLE_DEGRADE_ACC_PPS2 = 2;

/**
 * The max style point reward for content changes per event.
 */
const MAX_CHANGE_REWARD = 5;

/**
 * How many times more difficult it is to gain points at the highest rank than without any rank.
 */
const DIFFICULTY_FACTOR = 4;


export interface ScoreChangeEvent {
    rankIndex: number;
    score: number;
}


export interface RankChangeEvent {
    rankIndex: number;
}


export class ScoreKeeper {
    public _onScoreChange = new vscode.EventEmitter<ScoreChangeEvent>();
    public _onRankChange = new vscode.EventEmitter<RankChangeEvent>();

    // index into the ranks array. -1 means no ranking (worse than D)
    private _rankIndex = -1;

    // score to determine the current ranking
    private _score = 0;

    // timer used for style degradation
    private _timer: NodeJS.Timer;

    /**
     * The last time style points went up
     */
    private _lastUpdateTime = 0;

    private _disposables: vscode.Disposable[] = [
        this._onScoreChange,
        this._onRankChange
    ];

    constructor(public readonly config: StyleMeterConfig) {
        /**
         * Style degradation.
         * Reduce style points periodically at an amount proportional to inactivity.
         */
        this._timer = setInterval(() => {
            let inactiveTime = new Date().valueOf() - this._lastUpdateTime;
            if (inactiveTime > 100000) {
                inactiveTime = 100000;
            }
            const acc_ppms2 = STYLE_DEGRADE_ACC_PPS2 / 1e6;
            const penalty = inactiveTime * STYLE_DEGRADE_PERIOD_MS * acc_ppms2;
            this._changeScore(-penalty * config.degradationFactor);
        }, STYLE_DEGRADE_PERIOD_MS);

        vscode.workspace.onDidChangeTextDocument(this.onDidChangeTextDocument, this, this._disposables);
    }

    get onScoreChange() {
        return this._onScoreChange.event;
    }

    get onRankChange() {
        return this._onRankChange.event;
    }

    // increment score whenever they type
    public onDidChangeTextDocument(event: vscode.TextDocumentChangeEvent) {
        /*
        Reward changes proportional to the size of the change, up to a point.
        This prevents copy-paste from being overpowered.
        Also deleting will have no effect.
        */
        const changeSize = this._getChangeSize(event.contentChanges);
        let reward = changeSize;
        if (reward > MAX_CHANGE_REWARD) {
            reward = MAX_CHANGE_REWARD;
        }

        // make it harder to earn points on higher ranks
        const rankProgress = (this._rankIndex + 1) / this.config.ranks.length;
        reward /= (rankProgress * (DIFFICULTY_FACTOR - 1) + 1);

        this._changeScore(reward * this.config.gainFactor);

        this._lastUpdateTime = new Date().valueOf();
    }

    public score(): number {
        return this._score;
    }

    public rankIndex(): number {
        return this._rankIndex;
    }

    public dispose() {
        for (let d of this._disposables) {
            d.dispose();
        }
        clearInterval(this._timer);
    }

    private _changeScore(amount: number) {
        // update score value
        const prevScore = this._score;
        this._score += amount;
        if (this._score < 0) {
            this._score = 0;
        } else if (this._score > this.config.maxScore) {
            this._score = this.config.maxScore;
        }

        if (this._score === prevScore) {
            return;
        }

        // update rank index
        const prevRankIndex = this._rankIndex;
        this._rankIndex = this._getRankIndex(this._score);
        
        // call on score change listeners
        this._onScoreChange.fire({ rankIndex: this._rankIndex, score: this._score });

        // if the rank changed, call on rank change listeners
        if (this._rankIndex !== prevRankIndex) {
            this._onRankChange.fire({ rankIndex: this._rankIndex });
        }
    }

    private _getRankIndex(score: number): number {
        for (let i = this.config.ranks.length - 1; i >= 0; i--) {
            if (score > this.config.ranks[i].score) {
                return i;
            }
        }
        return -1; // -1 represents no style ranking
    }

    private _getChangeSize(contentChanges: vscode.TextDocumentContentChangeEvent[]) {
        let size = 0;
        for (let change of contentChanges) {
            size += change.text.length;
        }
        return size;
    }
}