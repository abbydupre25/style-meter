import * as vscode from 'vscode';
import { RankChangeEvent, ScoreChangeEvent } from './score-keeper';
import { StyleMeterConfig } from './config';
import { ScoreKeeper } from './score-keeper';

const pixelWidth = require('string-pixel-width');


/**
 * How long the rank text should stay on screen.
 */
const RANK_TEXT_TIMEOUT_MS = 1000;

const METER_MIN_WIDTH_PX = 20;
const METER_MIN_HEIGHT_PX = 3;


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
                italic: true,
                size: config.rankLetterFontSizePx
            });
            this._rankLetterPixelWidths.push(letterWidth);

            const textWidth = pixelWidth(rank.smallText, {
                font: config.rankFont,
                italic: true,
                size: config.rankTextFontSizePx
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
                color: rank.color,
            },
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        });
    }

    private _createSmallRankDecoration(rankIndex: number, shift: number): vscode.TextEditorDecorationType {
        const rank = this.config.ranks[rankIndex];
        const width = this._rankFullWidth - this._rankLetterPixelWidths[rankIndex];
        const top = this._rankTextTopMargin + shift;
        return vscode.window.createTextEditorDecorationType({
            before: {
                textDecoration: `${this._rankTextCss} width: ${width}px; top: ${top}px`,
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
        
        const width = progress * this._meterWidthPx;
        const rightMargin = this._rankFullWidth - width;

        // transition from red to orange
        const red = 163 + progress * (178 - 163);
        const green = 53 + progress * (125 - 53);
        const blue = 57 + progress * (64 - 57);
        const color = this._getCssColor(red, green, blue);
        const borderColor = this._getCssColor(red * 1.2, green * 1.2, blue * 1.2);
    
        return vscode.window.createTextEditorDecorationType({
            // this is on 'after' because weird overlapping happens if they're both on 'before'
            after: {
                textDecoration: `${this._meterCss}
                    right: ${rightMargin}px;
                    border-right: 4px solid ${borderColor};
                    border-radius: 2px;`,
                contentText: '',
                backgroundColor: color,
                width: `${width}px`,
            },
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        });
    }

    private _getCssColor(red: number, green: number, blue: number): string {
        return `rgb(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)})`;
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