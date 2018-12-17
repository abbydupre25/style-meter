'use strict';

import * as vscode from 'vscode';
import { isNullOrUndefined } from 'util';
import {spawn, ChildProcess} from 'child_process';

const vol = require('vol');

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
const MAX_VOLUME = .15;

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

let activeRankDecoration: vscode.TextEditorDecorationType;
let activeMeterDecoration: vscode.TextEditorDecorationType;

// index into the ranks array. -1 means no ranking (worse than D)
let rankIndex = -1;

// score to determine the current ranking
let score = 0;

// the previous line number of the start of the editor visible range
let prevStartLine = 0;

let audioProcess: ChildProcess;
let isAudioEnabled = false;

let config: vscode.WorkspaceConfiguration;

export function activate(context: vscode.ExtensionContext) {
    config = vscode.workspace.getConfiguration('styleMeter');

    let changeDisposable = vscode.workspace.onDidChangeTextDocument(onDidChangeTextDocument);
    let scrollDisposable = vscode.window.onDidChangeTextEditorVisibleRanges(onDidChangeTextEditorVisibleRanges);
    context.subscriptions.push(changeDisposable);
    context.subscriptions.push(scrollDisposable);

    // play audio
    const audioFilepath = config.get<string>('musicFilepath', '');
    if (audioFilepath !== '') {
        vol.set(0);
        audioProcess = spawn('ffplay', ['-nodisp', '-loop', '0', '-volume', '100', audioFilepath]);
        audioProcess.on('error', (err: any) => {
            isAudioEnabled = false;
            if (err.code === 'ENOENT') {
                vscode.window.showErrorMessage('Style meter requires \"ffplay\" to be installed on $PATH');
            } else {
                vscode.window.showErrorMessage('Style meter unknown audio error: ' + err.code);
            }
        });
        isAudioEnabled = true;
    }

    // style degradation
    // reduce the score at a constant rate
    setInterval(() => {
        if (score > 0) {
            score -= config.get<number>('degradationFactor', 1.0);
            updateRanking();
        }
    }, SCORE_TIMEOUT_MS);
}

export function deactivate() {
}

// update the rank index and decorations based on the score
function updateRanking() {
    const prevRankIndex = rankIndex;
    rankIndex = getRankIndex(score);

    if (isAudioEnabled) {
        vol.set((score / MAX_SCORE) * config.get<number>('maxVolume', MAX_VOLUME));
    }

    if (rankIndex < 0) {
        clearDecoration(activeRankDecoration);
        clearDecoration(activeMeterDecoration);
    } else {
        if (prevRankIndex !== rankIndex) {
            // only update rank decoration on rank changes
            updateRankDecoration();
        }
        updateMeterDecoration();
    }
}

function getRankIndex(score: number): number {
    for (let i = ranks.length - 1; i >= 0; i--) {
        if (score > ranks[i].score) {
            return i;
        }
    }
    return -1; // -1 represents no style ranking
}

// increment score whenever they type
function onDidChangeTextDocument(event: vscode.TextDocumentChangeEvent) {
    score += config.get<number>('gainFactor', 1.0);
    if (score > MAX_SCORE) {
        score = MAX_SCORE;
    }
    updateRanking();
}

// update the decorations so that they follow vertical scrolling
// no way to track horizontal scrolling afaik
// this wouldn't be necessary if vscode allowed 'position: fixed'
function onDidChangeTextEditorVisibleRanges(event: vscode.TextEditorVisibleRangesChangeEvent) {
    if (event.textEditor !== vscode.window.activeTextEditor) {
        return;
    }
    const start = event.visibleRanges[0].start.line;
    if (start !== prevStartLine) {
        updateRankDecoration();
        updateMeterDecoration();
        prevStartLine = start;
    }
}

function createRankDecoration(rankIndex: number): vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
        before: {
            textDecoration: defaultLetterCss,
            contentText: ranks[rankIndex].text,
            color: ranks[rankIndex].color,
        },
    });
}

function createMeterDecoration(rankIndex: number, score: number): vscode.TextEditorDecorationType {
    // calculate style meter width
    const nextThreshold = rankIndex + 1 === ranks.length ? MAX_SCORE : ranks[rankIndex + 1].score;
    const currentThreshold = ranks[rankIndex].score;
    const progress = (score - currentThreshold) / (nextThreshold - currentThreshold);
    const width = progress * METER_WIDTH_REM;

    // calculate style meter right margin
    const rightMargin = METER_MARGIN_RIGHT_REM + (METER_WIDTH_REM - width);

    return vscode.window.createTextEditorDecorationType({
        // put the meter on 'after' instead of 'before' because weird overlapping happens if they're on the same thing
        after: {
            textDecoration: `${defaultMeterCss} right: ${rightMargin}rem;`,
            contentText: '',
            backgroundColor: ranks[rankIndex].color,
            width: `${width}rem`,
        },
    });
}

function updateRankDecoration() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }

    // TODO these can be cached
    // create decoration for the rank letter
    const rankDecoration = createRankDecoration(rankIndex);

    clearDecoration(activeRankDecoration);
    activeRankDecoration = rankDecoration;
    editor.setDecorations(rankDecoration, editor.visibleRanges);
}

function updateMeterDecoration() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }

    // TODO these might also be cached
    // create decoration for the meter
    let meterDecoration = createMeterDecoration(rankIndex, score);

    // use [start, start] range to pretend this is a 'before' decoration and not 'after'
    const start = editor.visibleRanges[0].start;
    const range = new vscode.Range(start, start);

    clearDecoration(activeMeterDecoration);
    activeMeterDecoration = meterDecoration;
    editor.setDecorations(meterDecoration, [range]);
}

function clearDecoration(decoration: vscode.TextEditorDecorationType) {
    if (!isNullOrUndefined(decoration)) {
        decoration.dispose();
    }
}
