/*
* Licensed to the Apache Software Foundation (ASF) under one
* or more contributor license agreements.  See the NOTICE file
* distributed with this work for additional information
* regarding copyright ownership.  The ASF licenses this file
* to you under the Apache License, Version 2.0 (the
* "License"); you may not use this file except in compliance
* with the License.  You may obtain a copy of the License at
*
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing,
* software distributed under the License is distributed on an
* "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
* KIND, either express or implied.  See the License for the
* specific language governing permissions and limitations
* under the License.
*/

import * as zrUtil from 'zrender/src/core/util';
import Scale from './Scale';
import * as numberUtil from '../util/number';
import * as scaleHelper from './helper';
import { warn } from '../util/log';

// Use some method of IntervalScale
import IntervalScale from './Interval';
import SeriesData from '../data/SeriesData';
import { DimensionName, ScaleTick } from '../util/types';

const scaleProto = Scale.prototype;
// FIXME:TS refactor: not good to call it directly with `this`?
const intervalScaleProto = IntervalScale.prototype;

const roundingErrorFix = numberUtil.round;

const mathFloor = Math.floor;
const mathCeil = Math.ceil;
const mathPow = Math.pow;

const mathLog = Math.log;
const mathAbs = Math.abs;
const mathSign = Math.sign;

class SignLogScale extends Scale {
    static type = 'signlog';
    readonly type = 'signlog';

    base = 10;

    private _originalScale: IntervalScale = new IntervalScale();

    private _fixMin: boolean;
    private _fixMax: boolean;

    // FIXME:TS actually used by `IntervalScale`
    private _interval: number = 0;
    // FIXME:TS actually used by `IntervalScale`
    private _niceExtent: [number, number];


    /**
     * @param Whether expand the ticks to niced extent.
     */
    getTicks(expandToNicedExtent?: boolean): ScaleTick[] {
        const originalScale = this._originalScale;
        const extent = this._extent;
        const originalExtent = originalScale.getExtent();

        const ticks = intervalScaleProto.getTicks.call(this, expandToNicedExtent);

        return zrUtil.map(ticks, function (tick) {
            const val = tick.value;
            const num = this.signedLogInvTransform(val) as number;
            let powVal = numberUtil.round(num);

            // Fix #4158
            powVal = (val === extent[0] && this._fixMin)
                ? fixRoundingError(powVal, originalExtent[0])
                : powVal;
            powVal = (val === extent[1] && this._fixMax)
                ? fixRoundingError(powVal, originalExtent[1])
                : powVal;

            return {
                value: powVal
            };
        }, this);
    }

    setExtent(start: number, end: number): void {
        warn('setExtent>>>>>>>>>>>>>>>>>>>');
        start = this.signedLogTransform(start);
        end = this.signedLogTransform(end);
        intervalScaleProto.setExtent.call(this, start, end);
    }

    /**
     * @return {number} end
     */
    getExtent() {
        const extent = scaleProto.getExtent.call(this);

        extent[0] = this.signedLogInvTransform(extent[0]);
        extent[1] = this.signedLogInvTransform(extent[1]);

        // Fix #4158
        const originalScale = this._originalScale;
        const originalExtent = originalScale.getExtent();
        this._fixMin && (extent[0] = fixRoundingError(extent[0], originalExtent[0]));
        this._fixMax && (extent[1] = fixRoundingError(extent[1], originalExtent[1]));

        return extent;
    }

    unionExtent(extent: [number, number]): void {
        this._originalScale.unionExtent(extent);

        extent[0] = this.signedLogTransform(extent[0]);
        extent[1] = this.signedLogTransform(extent[1]);
        scaleProto.unionExtent.call(this, extent);
    }

    unionExtentFromData(data: SeriesData, dim: DimensionName): void {
        // TODO
        // filter value that <= 0
        this.unionExtent(data.getApproximateExtent(dim));
    }

    /**
     * Update interval and extent of intervals for nice ticks
     * @param approxTickNum default 10 Given approx tick number
     */
    calcNiceTicks(approxTickNum: number): void {
        warn('calcNiceTicks>>>>>>>>>>>>>>>>>>>');
        approxTickNum = approxTickNum || 10;
        const extent = this._extent;
        let span = extent[1] - extent[0];

        if (extent[1] < 10 && extent[1] > -10 && extent[0] < 10 && extent[0] > -10) {
            if (!isFinite(span)) {
                return;
            }
            // User may set axis min 0 and data are all negative
            // FIXME If it needs to reverse ?
            if (span < 0) {
                span = -span;
                extent.reverse();
            }

            const result = scaleHelper.intervalScaleNiceTicks(extent, approxTickNum, undefined, undefined);
            // this._intervalPrecision = result.intervalPrecision;
            this._interval = result.interval;
            this._niceExtent = result.niceTickExtent;
        }
        else {
            if (span === Infinity || span <= 0) {
                return;
            }

            let interval = numberUtil.quantity(span);
            const err = approxTickNum / span * interval;

            // Filter ticks to get closer to the desired count.
            if (err <= 0.5) {
                interval *= 10;
            }

            // Interval should be integer
            while (!isNaN(interval) && Math.abs(interval) < 1 && Math.abs(interval) > 0) {
                interval *= 10;
            }

            const niceExtent = [
                numberUtil.round(mathCeil(extent[0] / interval) * interval),
                numberUtil.round(mathFloor(extent[1] / interval) * interval)
            ] as [number, number];

            this._interval = interval;
            this._niceExtent = niceExtent;
        }
    }

    calcNiceExtent(opt: {
        splitNumber: number, // By default 5.
        fixMin?: boolean,
        fixMax?: boolean,
        minInterval?: number,
        maxInterval?: number
    }): void {
        intervalScaleProto.calcNiceExtent.call(this, opt);

        this._fixMin = opt.fixMin;
        this._fixMax = opt.fixMax;
    }

    parse(val: any): number {
        return val;
    }

    contain(val: number): boolean {
        val = this.signedLogTransform(val);
        return scaleHelper.contain(val, this._extent);
    }

    normalize(val: number): number {
        val = this.signedLogTransform(val);
        return scaleHelper.normalize(val, this._extent);
    }

    scale(val: number): number {
        val = scaleHelper.scale(val, this._extent);
        return this.signedLogInvTransform(val);
    }

    signedLogTransform(val: number): number {
        if (val > -10 && val < 10) {
            return val / 10;
        }
        else {
            return mathSign(val) * mathLog(Math.abs(val)) / mathLog(this.base);
        }
    }

    signedLogInvTransform(val: number): number {
        if (val > -1 && val < 1) {
            return val * 10;
        }
        else {
            return mathSign(val) * mathPow(this.base, mathAbs(val));
        }
    }

    getMinorTicks: IntervalScale['getMinorTicks'];
    getLabel: IntervalScale['getLabel'];
}

const proto = SignLogScale.prototype;
proto.getMinorTicks = intervalScaleProto.getMinorTicks;
proto.getLabel = intervalScaleProto.getLabel;

function fixRoundingError(val: number, originalVal: number): number {
    return roundingErrorFix(val, numberUtil.getPrecision(originalVal));
}


Scale.registerClass(SignLogScale);

export default SignLogScale;
