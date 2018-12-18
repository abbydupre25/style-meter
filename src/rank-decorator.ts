import * as vscode from 'vscode';
import { RankChangeEvent, ScoreChangeEvent } from './score-keeper';
import { StyleMeterConfig } from './config';
import { ScoreKeeper } from './score-keeper';


const METER_WIDTH_REM = 8;
const METER_MARGIN_RIGHT_REM = 9;
const RANK_TEXT_MARGIN_TOP_REM = 4.2;
const RANK_TEXT_TIMEOUT_MS = 1000;
const RANK_LETTER_CSS = `
    none;
    position: absolute;
    display: inline-block;
    right: ${METER_MARGIN_RIGHT_REM}rem;
    top: 4rem;
    width: ${METER_WIDTH_REM}rem;
    font-size: 4rem;
    font-style: italic;
    font-family: serif;
`;
const RANK_TEXT_CSS = `
    none;
    position: absolute;
    display: inline-block;
    right: ${METER_MARGIN_RIGHT_REM}rem;
    font-size: 3rem;
    font-style: italic;
    font-family: serif;
`;
const METER_CSS = `
    none;
    position: absolute;
    display: inline-block;
    top: 6.5rem;
    height: .5rem;
`;


class ReplaceableDecoration {
    private _decoration?: vscode.TextEditorDecorationType;

    public replace(d: vscode.TextEditorDecorationType, editor: vscode.TextEditor, ranges: vscode.Range[]) {
        this.dispose();
        this._decoration = d;
        editor.setDecorations(this._decoration, ranges);
    }

    public dispose() {
        if (this._decoration) {
            this._decoration.dispose();
        }
    }
}


export class RankDecorator {
    private _activeRankDecoration = new ReplaceableDecoration();
    private _activeSmallRankDecortion = new ReplaceableDecoration();
    private _activeMeterDecoration = new ReplaceableDecoration();

    // timer for small text disappearing after a rank change
    private _smallTextTimer?: NodeJS.Timer;

    private _disposables: vscode.Disposable[] = [
        this._activeRankDecoration,
        this._activeSmallRankDecortion,
        this._activeMeterDecoration
    ];

    constructor(public readonly config: StyleMeterConfig, private readonly _scoreKeeper: ScoreKeeper) {
        vscode.window.onDidChangeTextEditorVisibleRanges(this._onDidChangeTextEditorVisibleRanges, this,
            this._disposables);
        this._scoreKeeper.onRankChange(this._updateRankDecoration, this, this._disposables);
        this._scoreKeeper.onRankChange(this._updateSmallRankDecoration, this, this._disposables);
        this._scoreKeeper.onScoreChange(this._updateMeterDecoration, this, this._disposables);
    }

    public dispose(): void {
        for (let d of this._disposables) {
            d.dispose();
        }
        if (this._smallTextTimer) {
            clearInterval(this._smallTextTimer);
        }
    }

    // update the decorations so that they follow vertical scrolling
    // no way to track horizontal scrolling afaik
    // this wouldn't be necessary if vscode allowed 'position: fixed'
    private _onDidChangeTextEditorVisibleRanges(event: vscode.TextEditorVisibleRangesChangeEvent) {
        if (event.textEditor !== vscode.window.activeTextEditor) {
            return;
        }
        const score = this._scoreKeeper.score();
        const rankIndex = this._scoreKeeper.rankIndex();
        this._updateRankDecoration({ rankIndex });
        this._updateMeterDecoration({ rankIndex, score });
    }

    private _createRankDecoration(rankIndex: number): vscode.TextEditorDecorationType {
        const rank = this.config.ranks[rankIndex];
        return vscode.window.createTextEditorDecorationType({
            before: {
                textDecoration: RANK_LETTER_CSS,
                contentText: rank.text,
                color: rank.color,
            },
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        });
    }

    private _createSmallRankDecoration(rankIndex: number, shift: number): vscode.TextEditorDecorationType {
        const rank = this.config.ranks[rankIndex];
        const width = METER_WIDTH_REM - rank.smallTextOffsetRem;
        const top = RANK_TEXT_MARGIN_TOP_REM + shift;
        return vscode.window.createTextEditorDecorationType({
            before: {
                textDecoration: `${RANK_TEXT_CSS} width: ${width}rem; top: ${top}rem`,
                contentText: rank.smallText,
                color: rank.color,
            },
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        });
    }

    private _createMeterDecoration(rankIndex: number, score: number): vscode.TextEditorDecorationType {
        const ranks = this.config.ranks;
        const rank = ranks[rankIndex];

        // calculate progress into next rank (0 to 1)
        let nextThreshold;
        if (rankIndex + 1 === ranks.length) {
            nextThreshold = this.config.maxScore;
        } else {
            nextThreshold = ranks[rankIndex + 1].score;
        }
        const currentThreshold = rank.score;
        const progress = (score - currentThreshold) / (nextThreshold - currentThreshold);
        
        const width = progress * METER_WIDTH_REM;
        const rightMargin = METER_MARGIN_RIGHT_REM + (METER_WIDTH_REM - width);

        // transition from red to orange
        const red = 163 + progress * (178 - 163);
        const green = 53 + progress * (125 - 53);
        const blue = 57 + progress * (64 - 57);
        const color = `rgb(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)})`;
    
        return vscode.window.createTextEditorDecorationType({
            // this is on 'after' because weird overlapping happens if they're both on 'before'
            after: {
                textDecoration: `${METER_CSS} right: ${rightMargin}rem;`,
                contentText: '',
                backgroundColor: color,
                width: `${width}rem`,
            },
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        });
    }

    private _updateRankDecoration(event: RankChangeEvent) {
        if (event.rankIndex < 0) {
            this._activeRankDecoration.dispose();
            return;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        // TODO these can be cached
        // create decoration for the rank letter
        const rankDecoration = this._createRankDecoration(event.rankIndex);

        this._activeRankDecoration.replace(rankDecoration, editor, editor.visibleRanges);
    }

    private _updateSmallRankDecoration(event: RankChangeEvent) {
        if (event.rankIndex < 0) {
            this._activeSmallRankDecortion.dispose();
            return;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        // use a slightly different range for the small rank text to avoid weird overlapping problems
        const visibleRange = editor.visibleRanges[0];
        const pos = visibleRange.start.translate(1);
        const range = new vscode.Range(pos, pos);
        let topMarginShift;
        if (visibleRange.start.line !== visibleRange.end.line) {
            topMarginShift = -1;
        } else {
            topMarginShift = 0;
        }

        const smallRankDecoration = this._createSmallRankDecoration(event.rankIndex, topMarginShift);

        // remove the small rank decoration shortly after a rank change
        if (RANK_TEXT_TIMEOUT_MS >= 0) {
            if (this._smallTextTimer) {
                clearInterval(this._smallTextTimer);
            }
            this._smallTextTimer = setTimeout(() => {
                this._activeSmallRankDecortion.dispose();
            }, RANK_TEXT_TIMEOUT_MS);
        }

        this._activeSmallRankDecortion.replace(smallRankDecoration, editor, [range]);
    }

    private _updateMeterDecoration(event: ScoreChangeEvent) {
        if (event.rankIndex < 0) {
            this._activeMeterDecoration.dispose();
            return;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
    
        // TODO these might also be cached
        // create decoration for the meter
        const meterDecoration = this._createMeterDecoration(event.rankIndex, event.score);
    
        // use [start, start] range to pretend this is a 'before' decoration and not 'after'
        const start = editor.visibleRanges[0].start;
        const range = new vscode.Range(start, start);

        this._activeMeterDecoration.replace(meterDecoration, editor, [range]);
    }
}