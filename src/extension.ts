'use strict';

import * as vscode from 'vscode';
import { isNullOrUndefined } from 'util';
import { StyleMeterConfig } from './config';
import { ChildProcess } from 'child_process';

const vol = require('vol');
const player = require('play-sound')({});

// must be ordered from easiest to hardest
const ranks = [
    {
        text: 'D', // text to display for style ranking
        score: 10, // minimum score to acquire this rank (0 for debugging)
        color: '#89a7a7',
    },
    {
        text: 'C',
        score: 20,
        color: '#b3cdc0',
    },
    {
        text: 'B',
        score: 30,
        color: '#aeb295',
    },
    {
        text: 'A',
        score: 40,
        color: '#caad9a',
    },
    {
        text: 'S',
        score: 50,
        color: '#b2889e',
    },
    {
        text: 'SS',
        score: 60,
        color: '#d4b7d6',
    },
    {
        text: 'SSS',
        score: 70,
        color: '#ffb9c6',
    },
];

const SCORE_TIMEOUT_MS = 500;
const MAX_SCORE = 80;
const METER_WIDTH_REM = 10;
const METER_MARGIN_RIGHT_REM = 1;
const DEFAULT_MAX_VOLUME = .15;

const defaultLetterCss = `
    none;
    position: absolute;
    display: inline-block;
    right: ${METER_MARGIN_RIGHT_REM}rem;
    top: 4rem;
    width: ${METER_WIDTH_REM}rem;
    font-size: 6rem;
    font-family: lobster;
`;
const defaultMeterCss  = `
    none;
    position: absolute;
    display: inline-block;
    top: 7rem;
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


class StyleMeter {
    private _activeRankDecoration?: vscode.TextEditorDecorationType;
    private _activeMeterDecoration?: vscode.TextEditorDecorationType;

    // index into the ranks array. -1 means no ranking (worse than D)
    private _rankIndex = -1;

    // score to determine the current ranking
    private _score = 0;

    // the previous line number of the start of the editor visible range
    private _prevStartLine = 0;

    // timer used for style degradation
    private _timer: NodeJS.Timer;

    // the process playing audio
    private _audioProcess?: ChildProcess;

    // the volume value from before this extension messed with it
    private _prevVolume?: number;

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
        const start = event.visibleRanges[0].start.line;
        if (start !== this._prevStartLine) {
            this._updateRankDecoration();
            this._updateMeterDecoration();
            this._prevStartLine = start;
        }
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
        this._clearDecoration(this._activeRankDecoration);
        this._clearDecoration(this._activeMeterDecoration);

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
        const prevRankIndex = this._rankIndex;
        this._rankIndex = this._getRankIndex(this._score);

        if (this.config.musicFilepath) {
            const volume = (this._score / MAX_SCORE) * this.config.maxVolume;
            vol.set(volume);
        }

        if (this._rankIndex < 0) {
            this._clearDecoration(this._activeRankDecoration);
            this._clearDecoration(this._activeMeterDecoration);
        } else {
            if (prevRankIndex !== this._rankIndex) {
                // only update rank decoration on rank changes
                this._updateRankDecoration();
            }
            this._updateMeterDecoration();
        }
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
        });
    }

    private _createMeterDecoration(rankIndex: number, score: number): vscode.TextEditorDecorationType {
        // calculate style meter width
        const nextThreshold = rankIndex + 1 === ranks.length ? MAX_SCORE : ranks[rankIndex + 1].score;
        const currentThreshold = ranks[rankIndex].score;
        const progress = (score - currentThreshold) / (nextThreshold - currentThreshold);
        const width = progress * METER_WIDTH_REM;
    
        // calculate style meter right margin
        const rightMargin = METER_MARGIN_RIGHT_REM + (METER_WIDTH_REM - width);
    
        return vscode.window.createTextEditorDecorationType({
            // put the meter on 'after' instead of 'before' because weird overlapping happens if they're on the same
            after: {
                textDecoration: `${defaultMeterCss} right: ${rightMargin}rem;`,
                contentText: '',
                backgroundColor: ranks[rankIndex].color,
                width: `${width}rem`,
            },
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
    
        this._clearDecoration(this._activeRankDecoration);
        this._activeRankDecoration = rankDecoration;
        editor.setDecorations(rankDecoration, editor.visibleRanges);
    }

    private _updateMeterDecoration() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
    
        // TODO these might also be cached
        // create decoration for the meter
        let meterDecoration = this._createMeterDecoration(this._rankIndex, this._score);
    
        // use [start, start] range to pretend this is a 'before' decoration and not 'after'
        const start = editor.visibleRanges[0].start;
        const range = new vscode.Range(start, start);
    
        this._clearDecoration(this._activeMeterDecoration);
        this._activeMeterDecoration = meterDecoration;
        editor.setDecorations(meterDecoration, [range]);
    }

    private _clearDecoration(decoration: vscode.TextEditorDecorationType | undefined) {
        if (!isNullOrUndefined(decoration)) {
            decoration.dispose();
        }
    }
}
