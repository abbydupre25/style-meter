import { ScoreChangeEvent, ScoreKeeper } from './score-keeper';
import { StyleMeterConfig } from './config';
import { ChildProcess } from 'child_process';
import { Disposable } from 'vscode';

const vol = require('vol');
const player = require('play-sound')({});

const MIN_VOLUME_UPDATE_PERIOD_MS = 200;

export class MusicPlayer {
    // the process playing audio
    private _audioProcess?: ChildProcess;

    // the volume value from before this extension messed with it
    private _prevVolume: number;

    // the last epoch the volume was set
    private _lastVolumeUpdateTimeMs = 0;

    private _disposables: Disposable[] = [];

    constructor(public readonly config: StyleMeterConfig, private readonly _scoreKeeper: ScoreKeeper) {
        if (!this.config.musicFilepath) {
            throw new Error('do not create a music player without music filepath');
        }

        this._scoreKeeper.onScoreChange(this.updateVolume, this, this._disposables);

        this._prevVolume = vol.get();
        vol.set(0);
        this._loopAudio(this.config.musicFilepath);
    }

    public dispose(): void {
        for (let d of this._disposables) {
            d.dispose();
        }

        // stop music
        if (this._audioProcess) {
            this._audioProcess.kill();
        }

        // set volume back to previously set value
        vol.set(this._prevVolume);
    }

    public updateVolume(event: ScoreChangeEvent): void {
        const now = new Date().valueOf();
        if (this.config.musicFilepath &&
                (now - this._lastVolumeUpdateTimeMs) >= MIN_VOLUME_UPDATE_PERIOD_MS) {
            const volume = (event.score / this.config.maxScore) * this.config.maxVolume;
            vol.set(volume);
            this._lastVolumeUpdateTimeMs = now;
        }
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
}