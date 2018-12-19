import * as vscode from 'vscode';
import { RankChangeEvent, ScoreChangeEvent } from './score-keeper';
import { StyleMeterConfig } from './config';
import { ScoreKeeper } from './score-keeper';
import { RankColor } from './rank';

const pixelWidth = require('string-pixel-width');


/**
 * How long the rank text should stay on screen.
 */
const RANK_TEXT_TIMEOUT_MS = 1000;

const METER_MIN_WIDTH_PX = 20;
const METER_MIN_HEIGHT_PX = 3;

/**
 * The hsl color of the style meter at the start of a rank score threshold.
 */
const METER_COLOR_START: RankColor = {
    h: 15,
    s: 100,
    l: 51
};

/**
 * The hsl color of the style meter at the end of a rank score threshold.
 */
const METER_COLOR_END: RankColor = {
    h: 60,
    s: 84,
    l: 74
};


function _getCssColor(color: RankColor): string {
    return `hsl(${Math.round(color.h)}, ${Math.round(color.s)}\%, ${Math.round(color.l)}\%)`;
}


/**
 * Get a color that is `progress`% between `start` and `end`.
 * 
 * @param start an hsl color
 * @param end an hsl color
 * @param progress the percentage between start and end to get
 */
function _getGradient(start: RankColor, end: RankColor, progress: number): RankColor {
    return {
        h: (start.h + progress * (end.h - start.h)) % 360,
        s: start.s + progress * (end.s - start.s),
        l: start.l + progress * (end.l - start.l)
    };
}


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

    // cached pixel values and css
    private _rankLetterPixelWidths: number[] = [];
    private _rankFullWidth: number;
    private _rankTextTopMargin: number;
    private _meterWidthPx: number;
    private _rankLetterCss: string;
    private _rankTextCss: string;
    private _meterCss: string;

    constructor(public readonly config: StyleMeterConfig, private readonly _scoreKeeper: ScoreKeeper) {
        vscode.window.onDidChangeTextEditorVisibleRanges(this._onDidChangeTextEditorVisibleRanges, this,
            this._disposables);
        this._scoreKeeper.onRankChange(this._updateRankDecoration, this, this._disposables);
        this._scoreKeeper.onRankChange(this._updateSmallRankDecoration, this, this._disposables);
        this._scoreKeeper.onScoreChange(this._updateMeterDecoration, this, this._disposables);

        // calculate pixel widths of rank letter and text
        // this keeps the rank text from flying off the screen
        let maxRankFullWidth = 0;
        config.ranks.forEach(rank => {
            const letterWidth = pixelWidth(rank.text, {
                font: config.rankFont,
                size: config.rankLetterFontSizePx
            });
            this._rankLetterPixelWidths.push(letterWidth);

            const textWidth = pixelWidth(rank.smallText, {
                font: config.rankFont,
                size: config.rankTextFontSizePx,
                bold: true,
                italic: true
            });
            const fullWidth = textWidth + letterWidth;
            if (fullWidth > maxRankFullWidth) {
                maxRankFullWidth = fullWidth;
            }
        });
        this._rankFullWidth = maxRankFullWidth;

        // calculate the top margin as some proportion of the width
        const topMargin = maxRankFullWidth / 8;
        this._rankTextTopMargin = topMargin + (config.rankLetterFontSizePx - config.rankTextFontSizePx);

        // size the meter as some proportion of the text width
        let meterHeightPx = maxRankFullWidth / 30;
        if (meterHeightPx < METER_MIN_HEIGHT_PX) {
            meterHeightPx = METER_MIN_HEIGHT_PX;
        }
        this._meterWidthPx = maxRankFullWidth / 2;
        if (this._meterWidthPx < METER_MIN_WIDTH_PX) {
            this._meterWidthPx = METER_MIN_WIDTH_PX;
        }

        this._rankLetterCss = `
            none;
            position: absolute;
            display: inline-block;
            right: 0px;
            top: ${topMargin}px;
            width: ${maxRankFullWidth}px;
            height: ${config.rankLetterFontSizePx}px;
            font-size: ${config.rankLetterFontSizePx}px;
            font-style: italic;
            font-family: serif;
            font-weight: bold;
            text-shadow: 1px 1px 10px;
            vertical-align: middle;
            line-height: normal;
        `;
        this._rankTextCss = `
            none;
            position: absolute;
            display: inline-block;
            right: 0px;
            height: ${config.rankLetterFontSizePx}px;
            font-size: ${config.rankTextFontSizePx}px;
            font-style: italic;
            font-family: serif;
            font-weight: bold;
            text-shadow: 1px 1px 8px;
            vertical-align: middle;
            line-height: normal;
        `;
        this._meterCss = `
            none;
            position: absolute;
            display: inline-block;
            top: ${topMargin + config.rankLetterFontSizePx}px;
            height: ${meterHeightPx}px;
        `;
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
                textDecoration: this._rankLetterCss,
                contentText: rank.text,
                color: _getCssColor(rank.color),
            },
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        });
    }

    private _createSmallRankDecoration(rankIndex: number, shift: number): vscode.TextEditorDecorationType {
        const rank = this.config.ranks[rankIndex];
        const width = this._rankFullWidth - this._rankLetterPixelWidths[rankIndex];
        const top = this._rankTextTopMargin + shift;
        const color = _getGradient(rank.color, {h: rank.color.h, s: rank.color.s, l: 0}, .3);
        return vscode.window.createTextEditorDecorationType({
            before: {
                textDecoration: `${this._rankTextCss} width: ${width}px; top: ${top}px`,
                contentText: rank.smallText,
                color: _getCssColor(color),
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
        
        const width = progress * this._meterWidthPx;
        const rightMargin = this._rankFullWidth - width;

        // transition from red to orange
        const color = _getGradient(METER_COLOR_START, METER_COLOR_END, progress);
        const borderColor = _getGradient(color, {h: color.h, s: color.s, l: 100}, .5);
    
        return vscode.window.createTextEditorDecorationType({
            // this is on 'after' because weird overlapping happens if they're both on 'before'
            after: {
                textDecoration: `${this._meterCss}
                    right: ${rightMargin}px;
                    border-right: 4px solid ${_getCssColor(borderColor)};
                    border-radius: 2px;`,
                contentText: '',
                backgroundColor: _getCssColor(color),
                width: `${width}px`,
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
            topMarginShift = -this.config.lineHeightPx;
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