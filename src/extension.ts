'use strict';

import * as vscode from 'vscode';
import { StyleMeterConfig } from './config';
import { Rank } from './rank';
import { ChildProcess } from 'child_process';

const vol = require('vol');
const player = require('play-sound')({});

// must be ordered from easiest to hardest
const ranks: Rank[] = [
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
];

const SCORE_TIMEOUT_MS = 500;
const SMALL_TEXT_TIMEOUT_MS = 500;
const MAX_SCORE = 80;
const METER_WIDTH_REM = 8;
const METER_MARGIN_RIGHT_REM = 9;
const SMALL_TEXT_MARGIN_TOP_REM = 4.2;
const DEFAULT_MAX_VOLUME = .15;
const MIN_VOLUME_UPDATE_PERIOD_MS = 100;

const defaultLetterCss = `
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
const defaultSmallLetterCss = `
    none;
    position: absolute;
    display: inline-block;
    right: ${METER_MARGIN_RIGHT_REM}rem;
    font-size: 3rem;
    font-style: italic;
    font-family: serif;
`;
const defaultMeterCss  = `
    none;
    position: absolute;
    display: inline-block;
    top: 6.5rem;
    height: .5rem;
`;

let styleMeter: StyleMeter;

export function activate(context: vscode.ExtensionContext) {
    const configDisposable = vscode.workspace.onDidChangeConfiguration(onDidChangeConfiguration);
    context.subscriptions.push(configDisposable);

    const changeDisposable = vscode.workspace.onDidChangeTextDocument(onDidChangeTextDocument);
    context.subscriptions.push(changeDisposable);

    const scrollDisposable = vscode.window.onDidChangeTextEditorVisibleRanges(onDidChangeTextEditorVisibleRanges);
    context.subscriptions.push(scrollDisposable);

    onDidChangeConfiguration();
}

export function deactivate() {
    if (styleMeter) {
        styleMeter.dispose();
    }
}

function onDidChangeConfiguration() {
    // dispose of previous configured instance
    if (styleMeter) {
        styleMeter.dispose();
    }

    const config = vscode.workspace.getConfiguration('styleMeter');
    const styleMeterConfig = {
        musicFilepath:     config.get<string>('musicFilepath'),
        maxVolume:         config.get<number>('maxVolume', DEFAULT_MAX_VOLUME),
        gainFactor:        config.get<number>('gainFactor', 1),
        degradationFactor: config.get<number>('degradationFactor', 1)
    };
    styleMeter = new StyleMeter(styleMeterConfig);
}

function onDidChangeTextDocument(event: vscode.TextDocumentChangeEvent) {
    if (styleMeter) {
        styleMeter.onDidChangeTextDocument(event);
    }
}

function onDidChangeTextEditorVisibleRanges(event: vscode.TextEditorVisibleRangesChangeEvent) {
    if (styleMeter) {
        styleMeter.onDidChangeTextEditorVisibleRanges(event);
    }
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


class StyleMeter {
    private _activeRankDecoration = new ReplaceableDecoration();
    private _activeSmallRankDecortion = new ReplaceableDecoration();
    private _activeMeterDecoration = new ReplaceableDecoration();

    // index into the ranks array. -1 means no ranking (worse than D)
    private _rankIndex = -1;

    // score to determine the current ranking
    private _score = 0;

    // timer used for style degradation
    private _timer: NodeJS.Timer;

    // timer for small text disappearing after a rank change
    private _smallTextTimer?: NodeJS.Timer;

    // the process playing audio
    private _audioProcess?: ChildProcess;

    // the volume value from before this extension messed with it
    private _prevVolume?: number;

    // the last epoch the ranking was updated
    private _lastUpdateTimeMs = 0;

    constructor(public config: StyleMeterConfig) {
        // play audio
        if (config.musicFilepath) {
            this._prevVolume = vol.get();
            vol.set(0);
            this._loopAudio(config.musicFilepath);
        }

        // style degradation
        // reduce the score at a constant rate
        this._timer = setInterval(() => {
            if (this._score > 0) {
                this._score -= config.degradationFactor;
                this._updateRanking();
            }
        }, SCORE_TIMEOUT_MS);
    }

    // increment score whenever they type
    public onDidChangeTextDocument(event: vscode.TextDocumentChangeEvent) {
        this._score += this.config.gainFactor;
        if (this._score > MAX_SCORE) {
            this._score = MAX_SCORE;
        }
        this._updateRanking();
    }

    // update the decorations so that they follow vertical scrolling
    // no way to track horizontal scrolling afaik
    // this wouldn't be necessary if vscode allowed 'position: fixed'
    public onDidChangeTextEditorVisibleRanges(event: vscode.TextEditorVisibleRangesChangeEvent) {
        if (event.textEditor !== vscode.window.activeTextEditor) {
            return;
        }
        this._updateRankDecoration();
        this._updateMeterDecoration();
    }

    public dispose() {
        // stop music
        if (this._audioProcess) {
            this._audioProcess.kill();
        }

        // set volume back to previously set value
        if (this._prevVolume) {
            vol.set(this._prevVolume);
        }

        // clear the decorations
        this._activeRankDecoration.dispose();
        this._activeSmallRankDecortion.dispose();
        this._activeMeterDecoration.dispose();

        // stop style degradation timer
        clearInterval(this._timer);
    }

    private _loopAudio(audioFilepath: string) {
        const audioProcess: ChildProcess = player.play(audioFilepath, (err: any) => {
            if (err && !err.killed) {
                throw err;
            }
        });

        // call this function again when the process ends
        audioProcess.on('exit', (code, signal) => {
            // only replay on a success
            if (code === 0) {
                this._loopAudio(audioFilepath); // TODO this recursion might be leaking memory
            }
        });

        this._audioProcess = audioProcess;
    }

    // update the rank index and decorations based on the score
    private _updateRanking() {
        const now = new Date().valueOf();

        const prevRankIndex = this._rankIndex;
        this._rankIndex = this._getRankIndex(this._score);

        if (this.config.musicFilepath && (now - this._lastUpdateTimeMs) >= MIN_VOLUME_UPDATE_PERIOD_MS) {
            const volume = (this._score / MAX_SCORE) * this.config.maxVolume;
            vol.set(volume);
        }

        if (this._rankIndex < 0) {
            this._activeRankDecoration.dispose();
            this._activeSmallRankDecortion.dispose();
            this._activeMeterDecoration.dispose();
        } else {
            if (prevRankIndex !== this._rankIndex) {
                // only update rank decoration on rank changes
                this._updateRankDecoration();
                this._updateSmallRankDecoration();
            }
            this._updateMeterDecoration();
        }

        this._lastUpdateTimeMs = now;
    }

    private _getRankIndex(score: number): number {
        for (let i = ranks.length - 1; i >= 0; i--) {
            if (score > ranks[i].score) {
                return i;
            }
        }
        return -1; // -1 represents no style ranking
    }

    private _createRankDecoration(rankIndex: number): vscode.TextEditorDecorationType {
        return vscode.window.createTextEditorDecorationType({
            before: {
                textDecoration: defaultLetterCss,
                contentText: ranks[rankIndex].text,
                color: ranks[rankIndex].color,
            },
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        });
    }

    private _createSmallRankDecoration(rankIndex: number, shift: number): vscode.TextEditorDecorationType {
        const width = METER_WIDTH_REM - ranks[rankIndex].smallTextOffsetRem;
        const top = SMALL_TEXT_MARGIN_TOP_REM + shift;
        return vscode.window.createTextEditorDecorationType({
            before: {
                textDecoration: `${defaultSmallLetterCss} width: ${width}rem; top: ${top}rem`,
                contentText: ranks[rankIndex].smallText,
                color: ranks[rankIndex].color,
            },
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        });
    }

    private _createMeterDecoration(rankIndex: number, score: number): vscode.TextEditorDecorationType {
        // calculate progress into next rank (0 to 1)
        const nextThreshold = rankIndex + 1 === ranks.length ? MAX_SCORE : ranks[rankIndex + 1].score;
        const currentThreshold = ranks[rankIndex].score;
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
                textDecoration: `${defaultMeterCss} right: ${rightMargin}rem;`,
                contentText: '',
                backgroundColor: color,
                width: `${width}rem`,
            },
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        });
    }

    private _updateRankDecoration() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        // TODO these can be cached
        // create decoration for the rank letter
        const rankDecoration = this._createRankDecoration(this._rankIndex);

        this._activeRankDecoration.replace(rankDecoration, editor, editor.visibleRanges);
    }

    private _updateSmallRankDecoration() {
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

        const smallRankDecoration = this._createSmallRankDecoration(this._rankIndex, topMarginShift);

        // remove the small rank decoration shortly after a rank change
        if (SMALL_TEXT_TIMEOUT_MS >= 0) {
            if (this._smallTextTimer) {
                clearInterval(this._smallTextTimer);
            }
            this._smallTextTimer = setTimeout(() => {
                this._activeSmallRankDecortion.dispose();
            }, SMALL_TEXT_TIMEOUT_MS);
        }

        this._activeSmallRankDecortion.replace(smallRankDecoration, editor, [range]);
    }

    private _updateMeterDecoration() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
    
        // TODO these might also be cached
        // create decoration for the meter
        const meterDecoration = this._createMeterDecoration(this._rankIndex, this._score);
    
        // use [start, start] range to pretend this is a 'before' decoration and not 'after'
        const start = editor.visibleRanges[0].start;
        const range = new vscode.Range(start, start);

        this._activeMeterDecoration.replace(meterDecoration, editor, [range]);
    }
}
