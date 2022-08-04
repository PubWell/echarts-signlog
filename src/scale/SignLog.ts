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
const mathAbs = Math.abs;
const mathSign = Math.sign;
const mathMin = Math.min;
const mathMax = Math.max;

const mathLog = (base: number, value: number) => {
    if (value === 0) {
        return value;
    }
    return Math.log(mathAbs(value)) / Math.log(base);
};
const qwtLog = (base: number, value: number) => {
    if (value === 0) {
        return value;
    }
    else if (value < 0) {
        return -mathLog(base, -value);
    }
    return mathLog(base, value);
};

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

        // const ticks = intervalScaleProto.getTicks.call(this, expandToNicedExtent);
        const ticks = this.buildMajorTicks(this._interval);
        let powVal = 0;

        return zrUtil.map(ticks, function (tick: any) {
            const val = tick.value;
            const num: number = tick.sign * mathPow(this.base, val);
            powVal = numberUtil.round(num);

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
        start = this.signedLogTransform(start);
        end = this.signedLogTransform(end);
        const base = this.base;

        if (start < 1 && start > -1 && end < 1 && end > -1) {
            const lmin = mathLog(base, start);
            const lmax = mathLog(base, end);
            start = mathMin(lmin, lmax);

            if (start * end >= 0) {
                end = mathMax(lmin, lmax);
            }
            else {
                end = 0;
            }
        }

        intervalScaleProto.setExtent.call(this, start, end);
    }

    /**
     * @return {number} end
     */
    getExtent() {
        const extent = scaleProto.getExtent.call(this);
        const originalScale = this._originalScale;
        const originalExtent = originalScale.getExtent();

        extent[0] = originalExtent[0];
        extent[1] = originalExtent[1];

        // Fix #4158
        this._fixMin && (extent[0] = fixRoundingError(extent[0], originalExtent[0]));
        this._fixMax && (extent[1] = fixRoundingError(extent[1], originalExtent[1]));

        return extent;
    }

    unionExtent(extent: [number, number]): void {
        this._originalScale.unionExtent(extent);

        extent[0] = this.signedLogTransform(extent[0]);
        extent[1] = this.signedLogTransform(extent[1]);
        const base = this.base;

        if (extent[0] < 1 && extent[0] > -1 && extent[1] < 1 && extent[1] > -1) {
            const lmin = mathLog(base, extent[0]);
            const lmax = mathLog(base, extent[1]);
            extent[0] = mathMin(lmin, lmax);

            if (extent[0] * extent[1] >= 0) {
              extent[1] = mathMax(lmin, lmax);
            }
            else {
              extent[1] = 0;
            }
        }

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
        approxTickNum = approxTickNum || 10;
        const extent = this._extent;
        let span = extent[1] - extent[0];

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
        while (!isNaN(interval) && mathAbs(interval) < 1 && mathAbs(interval) > 0) {
            interval *= 10;
        }

        const niceExtent = [
            numberUtil.round(mathCeil(extent[0] / interval) * interval),
            numberUtil.round(mathFloor(extent[1] / interval) * interval)
        ] as [number, number];

        this._interval = interval;
        this._niceExtent = niceExtent;
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
        const originalScale = this._originalScale;
        const originalExtent = originalScale.getExtent();
        let extent: any = this._extent.concat();

        val = this.signedLogTransform(val);

        if (originalExtent[0] < 10 && originalExtent[0] > -10 && originalExtent[1] < 10 && originalExtent[1] > -10) {
            const base = this.base;
            val = mathLog(base, val);
            if (originalExtent[1] < 0) {
                extent = extent.reverse();
            }
        }

        return scaleHelper.contain(val, extent);
    }

    normalize(val: number): number {
        const originalScale = this._originalScale;
        const originalExtent = originalScale.getExtent();
        let extent: any = this._extent.concat();

        val = this.signedLogTransform(val);

        if (originalExtent[0] < 10 && originalExtent[0] > -10 && originalExtent[1] < 10 && originalExtent[1] > -10) {
            const base = this.base;
            val = mathLog(base, val);
            if (originalExtent[1] < 0) {
              extent = extent.reverse();
            }
        }
        return scaleHelper.normalize(val, extent);
    }

    scale(val: number): number {
        const originalScale = this._originalScale;
        const originalExtent = originalScale.getExtent();
        let extent: any = this._extent.concat();
        let res: number = 0;

        if (originalExtent[0] < 10 && originalExtent[0] > -10 && originalExtent[1] < 10 && originalExtent[1] > -10) {
            const base = this.base;
            if (originalExtent[1] < 0) {
                extent = extent.reverse();
            }
            val = scaleHelper.scale(val, extent);
            res = mathSign(originalExtent[0]) * mathPow(base, val);
        }
        else {
            val = scaleHelper.scale(val, extent);
            res = val;
        }

        return this.signedLogInvTransform(res);
    }

    signedLogTransform(val: number): number {
        if (val > -10 && val < 10) {
            return val / 10;
        }
        else {
            return mathSign(val) * mathLog(this.base, mathAbs(val));
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

    align(min: number, max: number, interval: number): [number, number] {
        const base = this.base;
        const minLog = qwtLog(base, min);
        const maxLog = qwtLog(base, max);

        let x1 = mathFloor(minLog);
        let x2 = mathCeil(maxLog);

        if (this.fuzzyCompare(min, x1, interval) === 0) {
            x1 = min;
        }
        if (this.fuzzyCompare(max, x2, interval) === 0) {
            x2 = max;
        }

        let vMin = 0;
        let vMax = 0;
        if (min === 0) {
            vMin = 0;
        }
        else if (min < 0) {
            vMin = -mathPow(base, -x1);
        }
        else {
            vMin = mathPow(base, x1);
        }

        if (max === 0) {
            vMax = 0;
        }
        else if (max < 0) {
            vMax = -mathPow(base, -x2);
        }
        else {
            vMax = mathPow(base, x2);
        }

        return [vMin, vMax];
    }

    buildMajorTicks(interval: number): any {
        const base = this.base;
        const originalScale = this._originalScale;
        const originalExtent = originalScale.getExtent();

        const val = this.align(originalExtent[0], originalExtent[1], interval);
        const min = val[0];
        const max = val[1];

        let pmin = qwtLog(base, originalExtent[0]);
        let nmax = qwtLog(base, originalExtent[1]);

        let x1 = mathFloor(pmin);
        let x2 = mathCeil(nmax);

        if (this.fuzzyCompare(pmin, x1, interval) === 0) {
            x1 = pmin;
        }
        pmin = mathPow(base, x1);

        if (this.fuzzyCompare(nmax, x2, interval) === 0) {
            x2 = nmax;
        }
        nmax = -mathPow(base, -x2);

        const wdt = this.getWdt(min, max, pmin, nmax);
        const pwdt = wdt[0];
        const nwdt = wdt[1];

        let num1 = numberUtil.round(pwdt / interval) + 1;
        let num2 = numberUtil.round(nwdt / interval) + 1;
        num1 = num1 > 10000 ? 10000 : num1;
        num2 = num2 > 10000 ? 10000 : num2;

        let ticks = [];
        let tickMin = { sign: mathSign(min), value: mathLog(base, min) };
        let tickMax = { sign: mathSign(max), value: mathLog(base, max) };
        ticks.push(tickMin);
        ticks.push(tickMax);

        if (min * max < 0) {
            ticks.push({ sign: 0, value: 0 });
        }

        if (num1 > 1) {
            let pmax = mathLog(base, max);
            if (min > 0) {
                pmin = min;
            }

            pmin = mathLog(base, pmin);
            let pstep = mathAbs(pmax - pmin) / (num1 - 1);

            for (let i = 1; i < num1 - 1; i++) {
                let stp = mathMin(pmin, pmax) + i * pstep;
                let tick = { sign: 1, value: mathFloor(stp) };
                ticks.push(tick);
            }
        }

        if (num2 > 1) {
            if (max < 0) {
                nmax = max;
            }
            nmax = mathLog(base, -nmax);

            let nmin = mathLog(base, -min);
            let nstep = mathAbs(nmin - nmax) / (num2 - 1);

            for (let i = 1; i < num2 - 1; i++) {
                let stp = mathMin(nmin, nmax) + i * nstep;
                let tick = { sign: -1, value: mathFloor(stp) };
                ticks.push(tick);
            }
        }

        ticks.sort((a, b) => {
          return Number(a.sign * mathPow(base, a.value)) - Number(b.sign * mathPow(base, b.value));
        });

        return ticks;
    }

    getWdt(min: number, max: number, pmin: number, nmax: number): [number, number] {
        const base = this.base;
        let pwdt = 0;
        let nwdt = 0;

        if (min * max <= 0) {
            if (min === 0) {
                if (pmin < max) {
                    pwdt = mathAbs(qwtLog(base, max) - qwtLog(base, pmin));
                }
                else {
                    pwdt = qwtLog(base, max);
                }
            }
            else if (max === 0) {
                if (nmax > min) {
                    nwdt = mathAbs(qwtLog(base, nmax) - qwtLog(base, min));
                }
                else {
                    nwdt = -qwtLog(base, min);
                }
            }
            else {
                if (pmin < max && nmax > min) {
                    pwdt = mathAbs(qwtLog(base, max) - qwtLog(base, pmin));
                    nwdt = mathAbs(qwtLog(base, nmax) - qwtLog(base, min));
                }
                else if (pmin >= max && nmax <= min) {
                    pwdt = mathAbs(qwtLog(base, max));
                    nwdt = mathAbs(-qwtLog(base, min));
                }
                else if (pmin >= max) {
                    pwdt = mathAbs(qwtLog(base, max));
                    nwdt = mathAbs(qwtLog(base, nmax) - qwtLog(base, min));
                }
                else {
                    pwdt = mathAbs(qwtLog(base, max) - qwtLog(base, pmin));
                    nwdt = mathAbs(-qwtLog(base, min));
                }
            }
        }
        else {
            const maxLog = qwtLog(base, max);
            const minLog = qwtLog(base, min);
            if (min > 0) {
                pwdt = maxLog - minLog;
            }
            else {
                nwdt = maxLog - minLog;
            }
        }

        return [pwdt, nwdt];
    }

    fuzzyCompare(value1: number, value2: number, interval: number): number {
        const eps = mathAbs(10 ** (-6) * interval);

        if (value2 - value1 > eps) {
            return -1;
        }
        if (value1 - value2 > eps) {
            return 1;
        }
        return 0;
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
