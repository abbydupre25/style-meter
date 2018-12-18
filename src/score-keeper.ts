import * as vscode from 'vscode';
import { StyleMeterConfig } from './config';


/**
 * The period at which style degradation takes place
 */
const SCORE_TIMEOUT_MS = 500;


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

    private _disposables: vscode.Disposable[] = [
        this._onScoreChange,
        this._onRankChange
    ];

    constructor(public readonly config: StyleMeterConfig) {
        // style degradation
        // reduce the score at a constant rate
        this._timer = setInterval(() => {
            this._changeScore(-config.degradationFactor);
        }, SCORE_TIMEOUT_MS);

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
        this._changeScore(this.config.gainFactor);
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
}