'use strict';

import * as vscode from 'vscode';
import { StyleMeterConfig, defaultStyleMeterConfig } from './config';
import { ScoreKeeper } from './score-keeper';
import { MusicPlayer } from './music-player';
import { RankDecorator } from './rank-decorator';


let styleMeter: StyleMeter;


export function activate(context: vscode.ExtensionContext) {
    const configDisposable = vscode.workspace.onDidChangeConfiguration(onDidChangeConfiguration);
    context.subscriptions.push(configDisposable);

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

    // merge the workspace config with the default config
    const input = vscode.workspace.getConfiguration('styleMeter');
    const c = JSON.parse(JSON.stringify(defaultStyleMeterConfig));
    c.musicFilepath = input.get<string>('musicFilepath', c.musicFilepath);
    c.maxVolume = input.get<number>('maxVolume', c.maxVolume);
    c.gainFactor = input.get<number>('gainFactor', c.gainFactor);
    c.degradationFactor = input.get<number>('degradationFactor', c.degradationFactor);
    c.rankLetterFontSizePx = input.get<number>('rankLetterFontSizePx', c.rankLetterFontSizePx);
    c.rankTextFontSizePx = input.get<number>('rankTextFontSizePx', c.rankTextFontSizePx);
    c.lineHeightPx = input.get<number>('lineHeightPx', c.lineHeightPx);

    styleMeter = new StyleMeter(c);
}


class StyleMeter {
    private _scoreKeeper: ScoreKeeper;
    private _disposables: vscode.Disposable[] = [];

    constructor(public readonly config: StyleMeterConfig) {
        this._scoreKeeper = new ScoreKeeper(this.config);
        this._disposables.push(this._scoreKeeper);

        const rankDecorator = new RankDecorator(config, this._scoreKeeper);
        this._disposables.push(rankDecorator);

        if (config.musicFilepath) {
            const musicPlayer = new MusicPlayer(config, this._scoreKeeper);
            this._disposables.push(musicPlayer);
        }
    }

    public dispose() {
        this._disposables.slice(0).forEach(d => d.dispose());
    }
}
