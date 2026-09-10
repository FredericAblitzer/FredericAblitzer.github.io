'use strict';

    const params = {
      fs: 48000,                                      
      T: 1.0                                                                  
    };

    function createAudioContextInstance(targetSampleRate) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        return null;
      }
      if (isFinite(targetSampleRate) && targetSampleRate > 0) {
        try {
          return new AudioContextClass({ sampleRate: targetSampleRate });
        } catch (err) {
          console.warn('Impossible de créer AudioContext avec sampleRate spécifique', targetSampleRate, err);
        }
      }
      return new AudioContextClass();
    }

    function synchronizeAudioContextSampleRate(targetSampleRate) {
      if (!audioCtx) return;
      if (!isFinite(targetSampleRate) || targetSampleRate <= 0) return;
      if (Math.abs(audioCtx.sampleRate - targetSampleRate) < 1) return;
      const newCtx = createAudioContextInstance(targetSampleRate);
      if (!newCtx) {
        console.warn('AudioContext n\'a pas pu être réaligné sur', targetSampleRate);
        return;
      }
      const oldCtx = audioCtx;
      audioCtx = newCtx;
      if (oldCtx && typeof oldCtx.close === 'function') {
        oldCtx.close().catch(() => {});
      }
    }

    function setGlobalSampleRate(newFs) {
      if (!isFinite(newFs) || newFs <= 0) {
        console.warn('Fréquence d\'échantillonnage invalide, on conserve', params.fs);
        return params.fs;
      }
      params.fs = newFs;
      synchronizeAudioContextSampleRate(newFs);
      return params.fs;
    }

    let omega_n = [];         
    let xi_n    = [];                              
    let A_n     = [];
    let B_n     = [];

    let timeAxis = [];
    let timeData = [];
    let freqAxis = [];
    let spectrumMag = [];

    let audioCtx = null;
    let wavTimeAxis = null;
    let wavData = null;
    let wavFreqAxis = null;
    let wavSpectrumMag = null;
    let wavSampleRate = null;
    const DEFAULT_RECORD_DURATION_MS = 5000;
    const RECORD_MIN_DURATION_MS = 500;
    const RECORD_MAX_DURATION_MS = 60000;
    const DEFAULT_RECORD_SAMPLE_RATE = 48000;
    const ALLOWED_RECORD_SAMPLE_RATES = [8000, 16000, 22050, 32000, 44100, 48000, 96000];
    let recordDurationMs = DEFAULT_RECORD_DURATION_MS;
    let recordSampleRate = DEFAULT_RECORD_SAMPLE_RATE;
    let recordChannelPreference = 'left';
    const RECORD_BUTTON_IDLE_LABEL = '🎤 RECORD';
    const RECORD_BUTTON_ACTIVE_LABEL = '🎤 RECORDING...';
    const PLAYBACK_LEAD_SILENCE_SEC = 0.1;
    let mediaRecorderInstance = null;
    let recordStream = null;
    let recordTimeoutId = null;
    let recordChunks = [];
    let recordingProgressIntervalId = null;
    let recordingProgressStartTime = null;

    let clickCursorFreq = null;           
    let playSelectedModeActive = false;
    let spectrumClickBound = false;                           
    let timeClickBound = false;
    let clickCursorTime = null;
    let currentRefineHighlightOmega = null;
    const REFINE_WORKING_EMOJI = '⏳';
    let currentRefineWorkingIndex = null;

    let currentXrange = null;
    let currentYrange = null;
    let currentTimeXrange = null;
    let currentTimeYrange = null;
    let timePlotForceRange = null;
    let spectrumAutoScaleNext = false;
    const CURSOR_ADD_HIDE_DISTANCE_PX = 200;
    const CURSOR_ADD_VERTICAL_OFFSET_PX = 50;
    let cursorAddButtonVisible = false;
    let cursorAddOrigin = { x: 0, y: 0 };
    let cursorSetStartButtonVisible = false;
    let cursorSetStartOrigin = { x: 0, y: 0 };
    let pendingTimeStartValue = null;

    function formatIndex(n) {
      return n.toString().padStart(2, '0');
    }

    function radPerSecToHz(omega) {
      return omega / (2 * Math.PI);
    }

    function hzToRadPerSec(f) {
      return 2 * Math.PI * f;
    }

    function getT0InputValue() {
      let t0 = parseFloat(document.getElementById('t0').value);
      if (!isFinite(t0) || t0 < 0) t0 = 0;
      return t0;
    }

    function snapTimeToSampleGrid(value, sampleRate) {
      if (!isFinite(value) || value < 0) return 0;
      if (!isFinite(sampleRate) || sampleRate <= 0) return value;
      return Math.round(value * sampleRate) / sampleRate;
    }

    function getSnappedT0(sampleRate) {
      return snapTimeToSampleGrid(getT0InputValue(), sampleRate);
    }

    function resampleFloat32Array(samples, sourceRate, targetRate) {
      if (!samples || samples.length === 0) {
        return new Float32Array(0);
      }
      if (!isFinite(sourceRate) || sourceRate <= 0 || !isFinite(targetRate) || targetRate <= 0) {
        return samples.slice();
      }
      if (Math.abs(sourceRate - targetRate) < 1e-6) {
        return samples.slice();
      }
      const targetLength = Math.max(1, Math.round(samples.length * targetRate / sourceRate));
      const result = new Float32Array(targetLength);
      const ratio = sourceRate / targetRate;
      for (let i = 0; i < targetLength; i++) {
        const sourceIndex = i * ratio;
        const index0 = Math.floor(sourceIndex);
        const index1 = Math.min(samples.length - 1, index0 + 1);
        const frac = sourceIndex - index0;
        const sample0 = samples[index0];
        const sample1 = samples[index1];
        result[i] = sample0 + (sample1 - sample0) * frac;
      }
      return result;
    }

    function sortModesByFrequency() {
      const Nmodes = omega_n.length;
      if (Nmodes === 0) return [];
      if (Nmodes === 1) return [0];

      const indices = Array.from({ length: Nmodes }, (_, i) => i);
      indices.sort((i, j) => omega_n[i] - omega_n[j]);

      omega_n = indices.map(i => omega_n[i]);
      xi_n    = indices.map(i => xi_n[i]);
      A_n     = indices.map(i => A_n[i]);
      B_n     = indices.map(i => B_n[i]);
      return indices;
    }

    function buildPeakListBaseLabel(index) {
      if (
        typeof index !== 'number' ||
        index < 0 ||
        index >= omega_n.length ||
        index >= xi_n.length
      ) {
        return '';
      }
      const fn = radPerSecToHz(omega_n[index]);
      const zPercent = xi_n[index] * 100;
      return `${formatIndex(index + 1)} - ${fn.toFixed(1)} Hz - ${zPercent.toFixed(3)} %`;
    }

    function applyRefineWorkingStateToPeakList(listEl) {
      const peakListEl = listEl || document.getElementById('peakList');
      if (!peakListEl) return;
      if (
        currentRefineWorkingIndex !== null &&
        (currentRefineWorkingIndex < 0 || currentRefineWorkingIndex >= omega_n.length)
      ) {
        currentRefineWorkingIndex = null;
      }
      const suffix = ` ${REFINE_WORKING_EMOJI}`;
      for (let i = 0; i < peakListEl.options.length && i < omega_n.length; i++) {
        const option = peakListEl.options[i];
        const baseLabel = buildPeakListBaseLabel(i);
        option.text = (currentRefineWorkingIndex === i) ? `${baseLabel}${suffix}` : baseLabel;
      }
    }

    function setRefineWorkingIndex(modeIndex) {
      let nextIndex = null;
      if (
        typeof modeIndex === 'number' &&
        modeIndex >= 0 &&
        modeIndex < omega_n.length
      ) {
        nextIndex = modeIndex;
      }
      if (currentRefineWorkingIndex === nextIndex) {
        return;
      }
      currentRefineWorkingIndex = nextIndex;
      applyRefineWorkingStateToPeakList();
    }

    function syncPeakListFromArrays() {
      const peakListEl = document.getElementById('peakList');
      if (!peakListEl) return;
      peakListEl.innerHTML = '';

      for (let i = 0; i < omega_n.length; i++) {
        const option = document.createElement('option');
        option.text = buildPeakListBaseLabel(i);
        peakListEl.add(option);
      }
      applyRefineWorkingStateToPeakList(peakListEl);
      plotComponentsGraph();
    }

    function plotComponentsGraph() {
      const plotEl = document.getElementById('componentsPlot');
      if (!plotEl) return;

      const freqs = [];
      const damping = [];
      for (let i = 0; i < omega_n.length; i++) {
        const f = radPerSecToHz(omega_n[i]);
        const z = xi_n[i] * 100;
        if (!isFinite(f) || !isFinite(z)) continue;
        freqs.push(f);
        damping.push(z);
      }

      const layout = {
        margin: { t: 20, r: 10, l: 60, b: 40 },
        xaxis: {
          title: 'Frequency (Hz)',
          rangemode: 'tozero',
          showline: true,
          mirror: true,
          linecolor: '#444',
          linewidth: 1
        },
        yaxis: {
          title: 'Damping (%)',
          rangemode: 'tozero',
          showline: true,
          mirror: true,
          linecolor: '#444',
          linewidth: 1,
          zeroline: false
        },
        showlegend: false
      };
      const plotWidth = plotEl.clientWidth;
      const plotHeight = plotEl.clientHeight;
      if (plotWidth > 0) {
        layout.width = plotWidth;
      }
      if (plotHeight > 0) {
        layout.height = plotHeight;
      }

      if (!freqs.length) {
        Plotly.react('componentsPlot', [], layout, { responsive: true, displayModeBar: false });
        return;
      }

      const traces = [
        {
          x: freqs,
          y: damping,
          mode: 'markers',
          marker: { size: 8, color: '#1f77b4' },
          hovertemplate: 'f: %{x:.2f} Hz<br>xi: %{y:.4f} %<extra></extra>'
        }
      ];

      Plotly.react('componentsPlot', traces, layout, { responsive: true, displayModeBar: false });
    }

    function setComponentsViewMode(showGraph) {
      const peakListEl = document.getElementById('peakList');
      const plotEl = document.getElementById('componentsPlot');
      if (!peakListEl || !plotEl) return;
      peakListEl.classList.toggle('hidden', showGraph);
      plotEl.classList.toggle('hidden', !showGraph);
      if (showGraph) {
        plotComponentsGraph();
        if (window.Plotly && Plotly.Plots && typeof Plotly.Plots.resize === 'function') {
          Plotly.Plots.resize(plotEl);
        }
      }
    }

    function findAmplitudes(omegaArr, xiArr, tArray, yArray, T_id, fs) {
      const Nmodes = omegaArr.length;
      if (Nmodes === 0) {
        return { res: 0, A_n: [], B_n: [] };
      }
      if (!tArray || !yArray || tArray.length === 0 || yArray.length === 0) {
        console.warn('findAmplitudes : tArray ou yArray vide');
        return { res: NaN, A_n: new Array(Nmodes).fill(0), B_n: new Array(Nmodes).fill(0) };
      }

      const Nsig = Math.min(tArray.length, yArray.length);

      let Nwin = Nsig;
      if (typeof T_id === 'number' && T_id > 0 && typeof fs === 'number' && fs > 0) {
        Nwin = Math.min(Nsig, Math.floor(T_id * fs));
      }

      const t0 = tArray[0];
      const t = new Array(Nwin);
      const y = new Array(Nwin);
      for (let n = 0; n < Nwin; n++) {
        t[n] = tArray[n] - t0;
        y[n] = yArray[n];
      }

      const omegaD = new Array(Nmodes);
      for (let i = 0; i < Nmodes; i++) {
        const xi = xiArr[i];
        const wn = omegaArr[i];
        omegaD[i] = wn * Math.sqrt(Math.max(0, 1 - xi * xi));
      }

      const nCols = 2 * Nmodes;
      const A = new Array(Nwin);
      for (let n = 0; n < Nwin; n++) {
        const tn = t[n];
        const row = new Array(nCols);
        for (let i = 0; i < Nmodes; i++) {
          const wn = omegaArr[i];
          const xi = xiArr[i];
          const wd = omegaD[i];
          const envelope = Math.exp(-xi * wn * tn);
          const cosTerm = envelope * Math.cos(wd * tn);
          const sinTerm = envelope * Math.sin(wd * tn);
          row[i] = cosTerm;                        
          row[Nmodes + i] = sinTerm;               
        }
        A[n] = row;
      }

      const ATA = new Array(nCols);
      const ATb = new Array(nCols).fill(0);
      for (let i = 0; i < nCols; i++) {
        ATA[i] = new Array(nCols).fill(0);
      }

      for (let n = 0; n < Nwin; n++) {
        const row = A[n];
        const yn = y[n];
        for (let i = 0; i < nCols; i++) {
          const ai = row[i];
          ATb[i] += ai * yn;
          for (let j = i; j < nCols; j++) {
            ATA[i][j] += ai * row[j];
          }
        }
      }

      for (let i = 0; i < nCols; i++) {
        for (let j = 0; j < i; j++) {
          ATA[i][j] = ATA[j][i];
        }
      }

      const x = solveLinearSystem(ATA, ATb);
      if (!x) {
        console.warn('findAmplitudes : système singulier');
        return { res: NaN, A_n: new Array(Nmodes).fill(0), B_n: new Array(Nmodes).fill(0) };
      }

      let res = 0;
      for (let n = 0; n < Nwin; n++) {
        const row = A[n];
        let yhat = 0;
        for (let i = 0; i < nCols; i++) {
          yhat += row[i] * x[i];
        }
        const e = yhat - y[n];
        res += e * e;
      }

      const A_n = x.slice(0, Nmodes);
      const B_n = x.slice(Nmodes);
      return { res, A_n, B_n };
    }

    function solveLinearSystem(M, b) {
      const n = b.length;
      const A = new Array(n);

      for (let i = 0; i < n; i++) {
        A[i] = M[i].slice();
        A[i].push(b[i]);
      }

      for (let k = 0; k < n; k++) {

        let maxRow = k;
        let maxVal = Math.abs(A[k][k]);
        for (let i = k + 1; i < n; i++) {
          const val = Math.abs(A[i][k]);
          if (val > maxVal) {
            maxVal = val;
            maxRow = i;
          }
        }
        if (maxVal === 0 || !isFinite(maxVal)) {
          return null;                      
        }
        if (maxRow !== k) {
          const tmp = A[k];
          A[k] = A[maxRow];
          A[maxRow] = tmp;
        }

        const pivot = A[k][k];
        for (let j = k; j <= n; j++) {
          A[k][j] /= pivot;
        }

        for (let i = 0; i < n; i++) {
          if (i === k) continue;
          const factor = A[i][k];
          for (let j = k; j <= n; j++) {
            A[i][j] -= factor * A[k][j];
          }
        }
      }

      const x = new Array(n);
      for (let i = 0; i < n; i++) {
        x[i] = A[i][n];
      }
      return x;
    }

    function computeMagnitudeSpectrum(samples, sampleRate, startIndex = 0) {
      if (!samples || !sampleRate) {
        return { freqs: [], mags: [] };
      }
      const Nseg = samples.length - startIndex;
      if (Nseg <= 0) {
        return { freqs: [], mags: [] };
      }

      let M = 1;
      while (M < Nseg) M <<= 1;

      const re = new Array(M).fill(0);
      const im = new Array(M).fill(0);
      for (let n = 0; n < Nseg; n++) {
        re[n] = samples[startIndex + n];
      }

      transform(re, im);

      const half = M >> 1;
      const freqs = new Array(half);
      const mags = new Array(half);
      for (let k = 0; k < half; k++) {
        freqs[k] = k * sampleRate / M;
        mags[k] = Math.hypot(re[k], im[k]);
      }
      return { freqs, mags };
    }

    function generateSignal() {
      const { fs, T } = params;

      if (omega_n.length === 0) {
        timeAxis = [];
        timeData = [];
        return;
      }

      let Tlocal = T;
      if (wavTimeAxis && wavTimeAxis.length > 0) {
        const wavDuration = wavTimeAxis[wavTimeAxis.length - 1];               
        const t0_val = getSnappedT0(wavSampleRate || params.fs);

        Tlocal = wavDuration - t0_val;
        if (Tlocal <= 0) {

          timeAxis = [];
          timeData = [];
          return;
        }
      }

      const N = Math.floor(fs * Tlocal);
      timeAxis = new Array(N);
      timeData = new Array(N);

      for (let n = 0; n < N; n++) {
        const t = n / fs;                                                 
        let s = 0;
        for (let k = 0; k < omega_n.length; k++) {
          const wn = omega_n[k];
          const xi = xi_n[k];
          const wd = wn * Math.sqrt(Math.max(0, 1 - xi * xi));
          const envelope = Math.exp(-xi * wn * t);
          s += envelope * (A_n[k] * Math.cos(wd * t) + B_n[k] * Math.sin(wd * t));
        }
        timeAxis[n] = t;
        timeData[n] = s;
      }
    }

    function computeSpectrum() {
      const { fs } = params;
      if (!timeData || !timeData.length) {
        freqAxis = [];
        spectrumMag = [];
        return;
      }

      const { freqs, mags } = computeMagnitudeSpectrum(timeData, fs);
      freqAxis = freqs;
      spectrumMag = mags;
    }

    function computeWavSpectrum() {
      if (!wavData || !wavSampleRate || wavData.length === 0) {
        wavFreqAxis = [];
        wavSpectrumMag = [];
        return;
      }

      const fsW = wavSampleRate;
      const N = wavData.length;
      const durationSec = N / fsW;

      let t0 = getSnappedT0(fsW);

      if (t0 >= durationSec) t0 = 0;

      const startIndex = Math.max(0, Math.round(t0 * fsW));
      if (startIndex >= N - 1) {
        wavFreqAxis = [];
        wavSpectrumMag = [];
        return;
      }

      const { freqs, mags } = computeMagnitudeSpectrum(wavData, fsW, startIndex);
      wavFreqAxis = freqs;
      wavSpectrumMag = mags;
    }

    function plotTimeSignalPlotly(t, y) {
      const traces = [];
      const timeDiv = document.getElementById('timePlot');
      if (timePlotForceRange) {
        currentTimeYrange = timePlotForceRange.slice();
        timePlotForceRange = null;
      } else if (timeDiv && timeDiv.layout) {
        if (timeDiv.layout.xaxis) {
          if (Array.isArray(timeDiv.layout.xaxis.range)) {
            currentTimeXrange = timeDiv.layout.xaxis.range.slice();
          } else if (timeDiv.layout.xaxis.autorange) {
            currentTimeXrange = null;
          }
        }
        if (timeDiv.layout.yaxis) {
          if (Array.isArray(timeDiv.layout.yaxis.range)) {
            currentTimeYrange = timeDiv.layout.yaxis.range.slice();
          } else if (timeDiv.layout.yaxis.autorange) {
            currentTimeYrange = null;
          }
        }
      }

      const t0_val = getSnappedT0(wavSampleRate || params.fs);
      let T_win = parseFloat(document.getElementById('T').value);
      if (!isFinite(T_win) || T_win < 0) T_win = 0;
      const zStart = t0_val;
      const zEnd = t0_val + T_win;

      if (wavTimeAxis && wavData && wavTimeAxis.length === wavData.length && wavTimeAxis.length > 0) {
        traces.push({
          x: wavTimeAxis,
          y: wavData,
          mode: 'lines',
          line: { color: 'black' }
        });
      }

      if (t && t.length > 0 && y && y.length === t.length) {
        const tShift = t.map(v => v + t0_val);
        traces.push({
          x: tShift,
          y: y,
          mode: 'lines',
          line: { color: 'magenta' }
        });
      }

      if (traces.length === 0) {
        const emptyLayout = {
          margin: { t: 30, r: 10, l: 60, b: 40 },
          xaxis: {
            title: 'Temps (s)',
            showline: true,
            mirror: true,
            linecolor: '#444',
            linewidth: 1
          },
          yaxis: {
            title: 'Amplitude',
            showline: true,
            mirror: true,
            linecolor: '#444',
            linewidth: 1
          },
          showlegend: false
        };
        if (currentTimeXrange) {
          emptyLayout.xaxis.range = currentTimeXrange.slice();
        }
        if (currentTimeYrange) {
          emptyLayout.yaxis.range = currentTimeYrange.slice();
        }
        Plotly.react('timePlot', [], emptyLayout, { responsive: true, displayModeBar: false });
        return;
      }

      const yAxisConfig = { title: 'Amplitude' };
      if (currentTimeYrange) {
        yAxisConfig.range = currentTimeYrange.slice();
      }

      const layout = {
        margin: { t: 30, r: 10, l: 60, b: 40 },
        xaxis: { title: 'Temps (s)', showline: true, mirror: true, linecolor: '#444', linewidth: 1 },
        yaxis: Object.assign({ showline: true, mirror: true, linecolor: '#444', linewidth: 1 }, yAxisConfig),
        shapes: [
          {
            type: 'rect',
            xref: 'x', yref: 'paper',
            x0: zStart,
            x1: zEnd,
            y0: 0,
            y1: 1,
            fillcolor: 'rgba(0,255,0,0.15)',
            line: { width: 0 }
          }
        ],
        showlegend: false
      };
      if (clickCursorTime !== null) {
        layout.shapes.push({
          type: 'line',
          xref: 'x', yref: 'paper',
          x0: clickCursorTime,
          x1: clickCursorTime,
          y0: 0,
          y1: 1,
          line: { color: 'green', width: 2 }
        });
      }
      if (currentTimeXrange) {
        layout.xaxis.range = currentTimeXrange.slice();
      }

      Plotly.react('timePlot', traces, layout, { responsive: true, displayModeBar: false });
    }

    function plotSpectrumPlotly(f, mag) {

      let forceAutoscale = false;
      const gd = document.getElementById('spectrumPlot');
      if (spectrumAutoScaleNext) {
        spectrumAutoScaleNext = false;
        forceAutoscale = true;
        currentXrange = null;
        currentYrange = null;
      } else if (gd && gd.layout) {
        if (gd.layout.xaxis && gd.layout.xaxis.range) {
          currentXrange = gd.layout.xaxis.range.slice();
        }
        if (gd.layout.yaxis && gd.layout.yaxis.range) {
          currentYrange = gd.layout.yaxis.range.slice();
        }
      }

      const hasSynth = f && mag && f.length > 0 && mag.length === f.length;
      const hasWav = wavFreqAxis && wavSpectrumMag &&
                     wavFreqAxis.length > 0 &&
                     wavFreqAxis.length === wavSpectrumMag.length;

      if (!hasSynth && !hasWav) {
        const baseLayout = {
          margin: { t: 30, r: 10, l: 60, b: 40 },
          xaxis: {
            title: 'Frequency (Hz)',
            rangemode: 'nonnegative',
            showline: true,
            mirror: true,
            linecolor: '#444',
            linewidth: 1
          },
          yaxis: {
            title: 'Amplitude (dB)',
            showline: true,
            mirror: true,
            linecolor: '#444',
            linewidth: 1,
            zeroline: false
          },
          showlegend: false
        };
        if (currentXrange) baseLayout.xaxis.range = currentXrange;
        if (currentYrange) baseLayout.yaxis.range = currentYrange;
        Plotly.react('spectrumPlot', [], baseLayout, { responsive: true, displayModeBar: false });
        return;
      }

      let baseFreqs = null;
      let baseMag = null;
      let baseName = 'FFT synth';

      if (hasSynth) {
        baseFreqs = f;
        baseMag = mag;
        baseName = 'FFT synth';
      } else {

        baseFreqs = wavFreqAxis;
        baseMag = wavSpectrumMag;
        baseName = 'FFT wav';
      }

      const fMaxPlot = 20000;
      const freqs = [];
      const mags = [];
      for (let i = 0; i < baseFreqs.length; i++) {
        if (baseFreqs[i] <= fMaxPlot) {
          freqs.push(baseFreqs[i]);
          mags.push(baseMag[i]);
        } else {
          break;
        }
      }
      if (freqs.length === 0) {
        const baseLayout = {
          margin: { t: 30, r: 10, l: 60, b: 40 },
          xaxis: {
            title: 'Frequency (Hz)',
            rangemode: 'nonnegative',
            showline: true,
            mirror: true,
            linecolor: '#444',
            linewidth: 1
          },
          yaxis: {
            title: 'Amplitude (dB)',
            showline: true,
            mirror: true,
            linecolor: '#444',
            linewidth: 1,
            zeroline: false
          },
          showlegend: false
        };
        if (currentXrange) baseLayout.xaxis.range = currentXrange;
        if (currentYrange) baseLayout.yaxis.range = currentYrange;
        Plotly.react('spectrumPlot', [], baseLayout, { responsive: true, displayModeBar: false });
        return;
      }

      const MIN_AMP = 1e-12;
      const MIN_DB = -240;
      const dbValuesSynth = new Array(mags.length);
      let ymin = Infinity;
      let ymax = -Infinity;
      for (let i = 0; i < mags.length; i++) {
        const amp = Math.max(mags[i], MIN_AMP);
        let db = 20 * Math.log10(amp);
        if (!isFinite(db)) db = MIN_DB;
        if (db < MIN_DB) db = MIN_DB;
        dbValuesSynth[i] = db;
        if (db < ymin) ymin = db;
        if (db > ymax) ymax = db;
      }
      if (!isFinite(ymin)) ymin = MIN_DB;
      if (!isFinite(ymax)) ymax = 0;

      const traces = [];

      if (hasSynth && hasWav) {

        const freqsW = [];
        const magsW = [];
        for (let i = 0; i < wavFreqAxis.length; i++) {
          if (wavFreqAxis[i] <= fMaxPlot) {
            freqsW.push(wavFreqAxis[i]);
            magsW.push(wavSpectrumMag[i]);
          } else {
            break;
          }
        }
        if (freqsW.length > 0) {
          const dbValuesW = new Array(magsW.length);
          for (let i = 0; i < magsW.length; i++) {
            const amp = Math.max(magsW[i], MIN_AMP);
            let db = 20 * Math.log10(amp);
            if (!isFinite(db)) db = MIN_DB;
            if (db < MIN_DB) db = MIN_DB;
            dbValuesW[i] = db;
            if (db < ymin) ymin = db;                                
            if (db > ymax) ymax = db;
          }
          traces.push({
            x: freqsW,
            y: dbValuesW,
            mode: 'lines',
            line: { color: 'black' }
          });
        }

        traces.push({
          x: freqs,
          y: dbValuesSynth,
          mode: 'lines',
          line: { color: 'magenta' }
        });
      } else {

        traces.push({
          x: freqs,
          y: dbValuesSynth,
          mode: 'lines',
          line: { color: baseName === 'FFT wav' ? 'black' : 'magenta' }
        });
      }

      const shapes = [];
      if (currentRefineHighlightOmega !== null) {
        const highlightFreq = radPerSecToHz(currentRefineHighlightOmega);
        if (isFinite(highlightFreq) && highlightFreq >= 0 && highlightFreq <= fMaxPlot) {
          shapes.push({
            type: 'line',
            xref: 'x',
            yref: 'paper',
            x0: highlightFreq,
            x1: highlightFreq,
            y0: 0,
            y1: 1,
            line: { color: 'rgba(0,255,0,0.15)', width: 8 },
            layer: 'below'
          });
        }
      }
      if (omega_n && omega_n.length > 0) {
        for (let i = 0; i < omega_n.length; i++) {
          const freqHz = radPerSecToHz(omega_n[i]);
          if (!isFinite(freqHz) || freqHz < 0 || freqHz > fMaxPlot) continue;
          shapes.push({
            type: 'line',
            xref: 'x',
            yref: 'paper',
            x0: freqHz,
            x1: freqHz,
            y0: 0,
            y1: 1,
            line: { color: 'rgba(255,0,0,0.4)', width: 1 }
          });
        }
      }

      if (clickCursorFreq !== null) {
        shapes.push({
          type: 'line',
          xref: 'x', yref: 'paper',
          x0: clickCursorFreq,
          x1: clickCursorFreq,
          y0: 0,
          y1: 1,
          line: { color: 'red', width: 2 }
        });
      }

      appendSpectrumMarkerShapes(shapes, fMaxPlot);

      const yAxisConfig = { title: 'Amplitude (dB)', zeroline: false };
      if (currentYrange && !forceAutoscale) {
        yAxisConfig.range = currentYrange;
      } else {
        yAxisConfig.autorange = true;
      }
      yAxisConfig.showline = true;
      yAxisConfig.mirror = true;
      yAxisConfig.linecolor = '#444';
      yAxisConfig.linewidth = 1;

      const layout = {
        margin: { t: 30, r: 10, l: 60, b: 40 },
        xaxis: {
          title: 'Frequency (Hz)',
          rangemode: 'nonnegative',
          showline: true,
          mirror: true,
          linecolor: '#444',
          linewidth: 1
        },
        yaxis: yAxisConfig,
        shapes,
        showlegend: false
      };

      if (currentXrange) layout.xaxis.range = currentXrange;

        Plotly.react('spectrumPlot', traces, layout, { responsive: true, displayModeBar: false });
    }

    function synthesizeModeSamples(modeIndex) {
      if (modeIndex < 0 || modeIndex >= omega_n.length) {
        return null;
      }

      const { fs, T } = params;
      let Tlocal = T;
      if (wavTimeAxis && wavTimeAxis.length > 0) {
        const wavDuration = wavTimeAxis[wavTimeAxis.length - 1];
        let t0_val = parseFloat(document.getElementById('t0').value);
        if (!isFinite(t0_val) || t0_val < 0) t0_val = 0;
        Tlocal = wavDuration - t0_val;
        if (Tlocal <= 0) {
          return null;
        }
      }

      if (!isFinite(Tlocal) || Tlocal <= 0) {
        return null;
      }

      const N = Math.floor(fs * Tlocal);
      if (!Number.isFinite(N) || N <= 0) {
        return null;
      }

      const wn = omega_n[modeIndex];
      const xi = xi_n[modeIndex];
      const A = A_n[modeIndex];
      const B = B_n[modeIndex];
      if (!isFinite(wn) || !isFinite(xi) || !isFinite(A) || !isFinite(B)) {
        return null;
      }

      const samples = new Float32Array(N);
      const wd = wn * Math.sqrt(Math.max(0, 1 - xi * xi));
      for (let n = 0; n < N; n++) {
        const t = n / fs;
        const envelope = Math.exp(-xi * wn * t);
        samples[n] = envelope * (A * Math.cos(wd * t) + B * Math.sin(wd * t));
      }
      return { samples, sampleRate: fs };
    }

    function ensureAudioContext(targetSampleRate = params.fs) {
      if (audioCtx) {
        synchronizeAudioContextSampleRate(targetSampleRate);
        return true;
      }
      audioCtx = createAudioContextInstance(targetSampleRate);
      if (!audioCtx) {
        alert('AudioContext not supported by this browser.');
        return false;
      }
      return true;
    }

    function playBufferSamples(samples, sampleRate, options = {}) {
      if (!ensureAudioContext(sampleRate)) return;
      const leadSilenceSec = typeof options.leadSilenceSec === 'number'
        ? Math.max(0, options.leadSilenceSec)
        : PLAYBACK_LEAD_SILENCE_SEC;
      const leadSamples = Math.max(0, Math.floor(leadSilenceSec * sampleRate));
      const totalSamples = leadSamples + samples.length;
      const buffer = audioCtx.createBuffer(1, totalSamples, sampleRate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) {
        channel[leadSamples + i] = samples[i];
      }
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);
      source.start();
      console.log(sampleRate)
      console.log(audioCtx.sampleRate)
    }

    function playSynth() {
      if (!timeData || timeData.length === 0) {
        alert('Synthetic signal is empty; nothing to play.');
        return;
      }
      playBufferSamples(timeData, params.fs);
    }

    function playOriginal() {
      if (!wavData || !wavSampleRate || wavData.length === 0) {
        alert('No WAV file loaded.');
        return;
      }

      const t0 = getSnappedT0(wavSampleRate);

      const totalSamples = wavData.length;
      const startIndex = Math.max(0, Math.round(t0 * wavSampleRate));
      if (startIndex >= totalSamples - 1) {
        alert("t0 is outside the WAV signal.");
        return;
      }

      const N = totalSamples - startIndex;
      if (N <= 0) {
        alert('WAV signal is empty after t0.');
        return;
      }
      const samples = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        samples[i] = wavData[startIndex + i];
      }
      playBufferSamples(samples, wavSampleRate);
    }

    function playSelectedMode(options = {}) {
      const { silent = false } = options;
      if (!peakList) {
        if (!silent) alert('Mode list unavailable.');
        return false;
      }
      const index = peakList.selectedIndex;
      if (index === -1) {
        if (!silent) alert('Select a component to listen to first.');
        return false;
      }
      const modeSignal = synthesizeModeSamples(index);
      if (!modeSignal || !modeSignal.samples || modeSignal.samples.length === 0) {
        if (!silent) alert('Unable to synthesize the selected component.');
        return false;
      }
      playBufferSamples(modeSignal.samples, modeSignal.sampleRate);
      return true;
    }

    function loadAudioBuffer(audioBuffer, options = {}) {
      if (!audioBuffer) {
        alert('Invalid AudioBuffer.');
        return;
      }

      let channelIndex = 0;
      if (options && typeof options.channelIndex === 'number' && isFinite(options.channelIndex)) {
        channelIndex = Math.max(0, Math.floor(options.channelIndex));
      }
      const channelCount = typeof audioBuffer.numberOfChannels === 'number'
        ? audioBuffer.numberOfChannels
        : 1;
      if (channelCount <= 0) {
        alert('AudioBuffer has no channels.');
        return;
      }
      if (channelIndex >= channelCount) {
        channelIndex = channelCount - 1;
      }

      let channelData = null;
      try {
        channelData = audioBuffer.getChannelData(channelIndex);
      } catch (err) {
        console.warn('Canal audio indisponible, fallback canal 0', err);
        channelData = audioBuffer.getChannelData(0);
      }
      if (!channelData) {
        alert('Unable to read audio channel data.');
        return;
      }

      let sr = audioBuffer.sampleRate;
      if (!isFinite(sr) || sr <= 0) {
        sr = params.fs;
      }
      setGlobalSampleRate(sr);
      const N = channelData.length;
      wavSampleRate = sr;
      wavTimeAxis = new Array(N);
      wavData = new Array(N);
      for (let i = 0; i < N; i++) {
        wavTimeAxis[i] = i / sr;
        wavData[i] = channelData[i];
      }

      omega_n = [];
      xi_n = [];
      A_n = [];
      B_n = [];
      syncPeakListFromArrays();
      if (btnAdd) {
        btnAdd.disabled = false;
      }
      if (btnCut) {
        btnCut.disabled = false;
      }
      if (btnNormalize) {
        btnNormalize.disabled = false;
      }
      currentXrange = null;
      currentYrange = null;
      currentTimeXrange = null;
      currentTimeYrange = null;
      timePlotForceRange = [-1, 1];
      spectrumAutoScaleNext = true;

      redrawAll();
      highlightSelectedMode();
    }

    function handleWavFile(event) {
      const file = event.target.files[0];
      if (!file) return;

      if (!ensureAudioContext(params.fs)) {
        return;
      }

      const reader = new FileReader();
      reader.onload = function (e) {
        const arrayBuffer = e.target.result;
        audioCtx.decodeAudioData(
          arrayBuffer,
          function (audioBuffer) {
            loadAudioBuffer(audioBuffer);
          },
          function (err) {
            console.error('Erreur decodeAudioData', err);
            alert('Unable to decode this WAV file.');
          }
        );
      };
      reader.readAsArrayBuffer(file);
    }

    function clampRecordDurationMs(valueMs) {
      if (!isFinite(valueMs) || valueMs <= 0) {
        return DEFAULT_RECORD_DURATION_MS;
      }
      return Math.max(RECORD_MIN_DURATION_MS, Math.min(valueMs, RECORD_MAX_DURATION_MS));
    }

    function sanitizeRecordSampleRate(value) {
      const numericValue = Math.round(Number(value));
      if (ALLOWED_RECORD_SAMPLE_RATES.includes(numericValue)) {
        return numericValue;
      }
      return DEFAULT_RECORD_SAMPLE_RATE;
    }

    function getRecordChannelConstraints() {
      if (recordChannelPreference === 'right') {
        return { ideal: 2 };
      }
      return { ideal: 2 };
    }

    function getRecordStreamChannelCount(stream) {
      if (!stream || typeof stream.getAudioTracks !== 'function') return 0;
      const audioTracks = stream.getAudioTracks();
      if (!audioTracks || !audioTracks.length) return 0;
      const track = audioTracks[0];
      if (!track) return 0;

      const settings = typeof track.getSettings === 'function' ? track.getSettings() : null;
      if (settings && Number.isFinite(settings.channelCount) && settings.channelCount > 0) {
        return settings.channelCount;
      }

      const capabilities = typeof track.getCapabilities === 'function' ? track.getCapabilities() : null;
      if (capabilities && Number.isFinite(capabilities.channelCount) && capabilities.channelCount > 0) {
        return capabilities.channelCount;
      }
      if (capabilities && Array.isArray(capabilities.channelCount) && capabilities.channelCount.length) {
        const finiteCounts = capabilities.channelCount.filter(value => Number.isFinite(value) && value > 0);
        if (finiteCounts.length) {
          return Math.max(...finiteCounts);
        }
      }

      return 0;
    }

    function resolveRecordChannelIndex(audioBuffer) {
      if (!audioBuffer) return 0;
      const totalChannels = typeof audioBuffer.numberOfChannels === 'number'
        ? audioBuffer.numberOfChannels
        : 1;
      if (totalChannels <= 0) return 0;
      if (recordChannelPreference === 'right') {
        return totalChannels >= 2 ? 1 : totalChannels - 1;
      }
      return 0;
    }
    function setRecordButtonState(isRecording) {
      if (!btnRecord) return;
      btnRecord.disabled = isRecording;
      btnRecord.textContent = isRecording ? RECORD_BUTTON_ACTIVE_LABEL : RECORD_BUTTON_IDLE_LABEL;
    }

    function cleanupRecordingResources() {
      stopRecordingProgressDisplay();
      if (recordTimeoutId !== null) {
        clearTimeout(recordTimeoutId);
        recordTimeoutId = null;
      }
      if (recordStream) {
        try {
          const tracks = recordStream.getTracks ? recordStream.getTracks() : [];
          if (tracks && tracks.length) {
            tracks.forEach(track => track.stop());
          }
        } catch (err) {
          console.warn('Erreur lors de l\'arrêt du stream micro', err);
        }
        recordStream = null;
      }
      mediaRecorderInstance = null;
      recordChunks = [];
      setRecordButtonState(false);
    }

    async function startMicrophoneRecording() {
      if (mediaRecorderInstance && mediaRecorderInstance.state === 'recording') {
        return;
      }
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        alert('Audio recording not supported by this browser.');
        return;
      }
      if (typeof MediaRecorder === 'undefined') {
        alert('Audio recording not supported (MediaRecorder missing).');
        return;
      }

      const targetSampleRate = sanitizeRecordSampleRate(recordSampleRate);
      if (!ensureAudioContext(targetSampleRate)) {
        return;
      }

      try {
        setRecordButtonState(true);
        recordStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: targetSampleRate,
            channelCount: getRecordChannelConstraints(),
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        });
      } catch (err) {
        console.error('getUserMedia a échoué', err);
        setRecordButtonState(false);
        alert("Unable to access the microphone.");
        return;
      }

      recordChunks = [];
      try {
        mediaRecorderInstance = new MediaRecorder(recordStream);
      } catch (err) {
        console.error('MediaRecorder init échoué', err);
        cleanupRecordingResources();
        alert("Unable to start audio recording.");
        return;
      }

      mediaRecorderInstance.ondataavailable = (event) => {
        if (event && event.data && event.data.size > 0) {
          recordChunks.push(event.data);
        }
      };

      mediaRecorderInstance.onerror = (event) => {
        console.error('Erreur MediaRecorder', event.error || event);
        cleanupRecordingResources();
        alert("Error while recording audio.");
      };

      mediaRecorderInstance.onstop = () => {
        const chunksCopy = recordChunks.slice();
        const mimeType = (mediaRecorderInstance && mediaRecorderInstance.mimeType) || 'audio/webm';
        const requestedChannelPreference = recordChannelPreference;
        const streamChannelCount = getRecordStreamChannelCount(recordStream);
        cleanupRecordingResources();
        if (!chunksCopy.length) {
          alert("Recording is empty.");
          return;
        }
        const blob = new Blob(chunksCopy, { type: mimeType });
        blob.arrayBuffer().then(arrayBuffer => {
          audioCtx.decodeAudioData(
            arrayBuffer,
            (audioBuffer) => {
              const decodedChannelCount = typeof audioBuffer.numberOfChannels === 'number'
                ? audioBuffer.numberOfChannels
                : 1;
              if (requestedChannelPreference === 'right' &&
                  streamChannelCount > 0 &&
                  streamChannelCount < 2) {
                alert('The recorded input is mono. Right channel selection cannot be applied to this recording.');
              } else if (requestedChannelPreference === 'right' && decodedChannelCount < 2) {
                alert('The recorded file contains a single channel after browser encoding. Right channel selection cannot be applied to this recording.');
              }
              const channelIndex = resolveRecordChannelIndex(audioBuffer);
              const sourceSamples = audioBuffer.getChannelData(channelIndex);
              const sourceRate = audioBuffer.sampleRate;
              const processedSamples = resampleFloat32Array(
                sourceSamples,
                sourceRate,
                targetSampleRate
              );
              if (!processedSamples || processedSamples.length === 0) {
                alert('Recorded audio empty after processing.');
                return;
              }
              const normalizedBuffer = audioCtx.createBuffer(
                1,
                processedSamples.length,
                targetSampleRate
              );
              const targetChannel = normalizedBuffer.getChannelData(0);
              targetChannel.set(processedSamples);
              loadAudioBuffer(normalizedBuffer, { channelIndex: 0 });
            },
            (err) => {
              console.error('Décodage audio (record) échoué', err);
              alert("Unable to decode the recorded audio.");
            }
          );
        }).catch(err => {
          console.error('Conversion Blob -> ArrayBuffer échouée', err);
          alert("Unable to process the recorded audio.");
        });
      };

      try {
        mediaRecorderInstance.start();
      } catch (err) {
        console.error('MediaRecorder start échoué', err);
        cleanupRecordingResources();
        alert("Unable to start audio recording.");
        return;
      }

      startRecordingProgressDisplay();
      recordTimeoutId = setTimeout(() => {
        if (mediaRecorderInstance && mediaRecorderInstance.state === 'recording') {
          try {
            mediaRecorderInstance.stop();
          } catch (err) {
            console.error('Erreur lors de l\'arrêt du MediaRecorder', err);
            cleanupRecordingResources();
          }
        }
      }, recordDurationMs);
    }

    function cutWavSignalToCurrentView() {
      if (!wavTimeAxis || !wavData || wavTimeAxis.length === 0 || wavData.length === 0) {
        alert('No WAV signal to cut.');
        return;
      }
      if (!wavSampleRate) {
        alert('Unknown sampling rate for the WAV.');
        return;
      }

      const timeDiv = document.getElementById('timePlot');
      let range = null;
      if (timeDiv && timeDiv.layout && timeDiv.layout.xaxis && Array.isArray(timeDiv.layout.xaxis.range)) {
        range = timeDiv.layout.xaxis.range.slice();
      } else if (currentTimeXrange && currentTimeXrange.length === 2) {
        range = currentTimeXrange.slice();
      }

      if (!range) {
        range = [wavTimeAxis[0], wavTimeAxis[wavTimeAxis.length - 1]];
      }

      let [x0, x1] = range;
      if (!isFinite(x0) || !isFinite(x1)) {
        alert('Invalid time range for cutting.');
        return;
      }
      if (x0 === x1) {
        alert('Cut window must have a non-zero duration.');
        return;
      }

      const minTime = wavTimeAxis[0];
      const maxTime = wavTimeAxis[wavTimeAxis.length - 1];
      const startTime = Math.max(Math.min(x0, x1), minTime);
      const endTime = Math.min(Math.max(x0, x1), maxTime);
      if (endTime <= startTime) {
        alert('Selected range does not overlap the WAV signal.');
        return;
      }

      let startIdx = 0;
      while (startIdx < wavTimeAxis.length && wavTimeAxis[startIdx] < startTime) {
        startIdx++;
      }
      let endIdx = startIdx;
      while (endIdx < wavTimeAxis.length && wavTimeAxis[endIdx] <= endTime) {
        endIdx++;
      }

      if (endIdx - startIdx < 2) {
        alert('Cut range is too short.');
        return;
      }

      const sliceLength = endIdx - startIdx;
      const baseTime = wavTimeAxis[startIdx];
      const newTimes = new Array(sliceLength);
      const newData = new Array(sliceLength);
      for (let i = 0; i < sliceLength; i++) {
        newTimes[i] = wavTimeAxis[startIdx + i] - baseTime;
        newData[i] = wavData[startIdx + i];
      }

      wavTimeAxis = newTimes;
      wavData = newData;
      const t0Input = document.getElementById('t0');
      if (t0Input) {
        t0Input.value = '0';
      }

      currentTimeXrange = null;
      currentTimeYrange = null;
      currentXrange = null;
      currentYrange = null;
      timePlotForceRange = [-1, 1];
      spectrumAutoScaleNext = true;

      redrawAll();
    }

    function normalizeWavSignal() {
      if (!wavTimeAxis || !wavData || wavTimeAxis.length === 0 || wavData.length === 0) {
        alert('No WAV signal to normalize.');
        return;
      }

      let maxAbs = 0;
      for (let i = 0; i < wavData.length; i++) {
        const value = Math.abs(wavData[i]);
        if (value > maxAbs) {
          maxAbs = value;
        }
      }
      if (!isFinite(maxAbs) || maxAbs <= 0) {
        alert('WAV signal is silent; nothing to normalize.');
        return;
      }

      const scale = 1 / maxAbs;
      const scaledData = new Array(wavData.length);
      for (let i = 0; i < wavData.length; i++) {
        scaledData[i] = wavData[i] * scale;
      }
      wavData = scaledData;

      currentTimeYrange = null;
      timePlotForceRange = [-1, 1];
      spectrumAutoScaleNext = true;

      let didRefit = false;
      if (omega_n && omega_n.length > 0) {
        const windowData = extractWavWindowData();
        if (windowData) {
          fitAmplitudesOnWav(windowData);
          didRefit = true;
        }
      }
      if (!didRefit) {
        redrawAll();
      }
    }

    function extractWavWindowData() {
      if (!wavTimeAxis || !wavData || wavTimeAxis.length === 0 || wavData.length === 0) {
        alert('No WAV file loaded.');
        return null;
      }

      let t0 = getSnappedT0(wavSampleRate || params.fs);
      let Twin = parseFloat(document.getElementById('T').value);
      if (!isFinite(Twin) || Twin <= 0) {
        alert('Window duration T must be > 0.');
        return null;
      }

      const tEnd = t0 + Twin;
      const N = Math.min(wavTimeAxis.length, wavData.length);

      let iStart = 0;
      while (iStart < N && wavTimeAxis[iStart] < t0) {
        iStart++;
      }
      let iEnd = iStart;
      while (iEnd < N && wavTimeAxis[iEnd] <= tEnd) {
        iEnd++;
      }

      const Nwin = iEnd - iStart;
      if (Nwin <= 10) {                       
        alert("Identification window too short or outside the WAV file.");
        return null;
      }

      const tFit = new Array(Nwin);
      const yFit = new Array(Nwin);
      for (let n = 0; n < Nwin; n++) {
        tFit[n] = wavTimeAxis[iStart + n];
        yFit[n] = wavData[iStart + n];
      }

      return { tFit, yFit };
    }

    function promptExportBaseName() {
      const now = new Date();
      const twoDigits = (n) => n.toString().padStart(2, '0');
      const timestamp =
        now.getFullYear().toString() +
        twoDigits(now.getMonth() + 1) +
        twoDigits(now.getDate()) + '_' +
        twoDigits(now.getHours()) +
        twoDigits(now.getMinutes()) +
        twoDigits(now.getSeconds());
      const defaultName = `measurement_${timestamp}`;
      const userInput = window.prompt('Filename (without extension)?', defaultName);
      if (userInput === null) {
        return null;
      }
      const trimmed = userInput.trim();
      if (!trimmed) {
        alert('Invalid filename.');
        return null;
      }
      return trimmed;
    }

    function triggerDownloadBlob(blob, filename) {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    function toFloat32Array(source) {
      if (!source || !source.length) return new Float32Array(0);
      if (source instanceof Float32Array) {
        return source;
      }
      const result = new Float32Array(source.length);
      for (let i = 0; i < source.length; i++) {
        const value = Number(source[i]);
        result[i] = Number.isFinite(value) ? value : 0;
      }
      return result;
    }

    function createWavBlobFromSamples(samples, sampleRate) {
      if (!samples || samples.length === 0) {
        alert('WAV signal is empty; nothing to save.');
        return null;
      }
      if (!isFinite(sampleRate) || sampleRate <= 0) {
        alert('Invalid sampling rate for WAV export.');
        return null;
      }

      const floatSamples = toFloat32Array(samples);
      const sampleRateInt = Math.max(1, Math.round(sampleRate));
      const channelCount = 1;
      const bytesPerSample = 2;
      const blockAlign = channelCount * bytesPerSample;
      const byteRate = sampleRateInt * blockAlign;
      const dataSize = floatSamples.length * bytesPerSample;
      const buffer = new ArrayBuffer(44 + dataSize);
      const view = new DataView(buffer);

      function writeString(offset, string) {
        for (let i = 0; i < string.length; i++) {
          view.setUint8(offset + i, string.charCodeAt(i));
        }
      }

      function floatTo16BitPCM(offset, input) {
        for (let i = 0; i < input.length; i++, offset += 2) {
          let s = Math.max(-1, Math.min(1, input[i]));
          s = s < 0 ? s * 0x8000 : s * 0x7FFF;
          view.setInt16(offset, s, true);
        }
      }

      let offset = 0;
      writeString(offset, 'RIFF'); offset += 4;
      view.setUint32(offset, 36 + dataSize, true); offset += 4;
      writeString(offset, 'WAVE'); offset += 4;
      writeString(offset, 'fmt '); offset += 4;
      view.setUint32(offset, 16, true); offset += 4;
      view.setUint16(offset, 1, true); offset += 2;       
      view.setUint16(offset, channelCount, true); offset += 2;
      view.setUint32(offset, sampleRateInt, true); offset += 4;
      view.setUint32(offset, byteRate, true); offset += 4;
      view.setUint16(offset, blockAlign, true); offset += 2;
      view.setUint16(offset, bytesPerSample * 8, true); offset += 2;
      writeString(offset, 'data'); offset += 4;
      view.setUint32(offset, dataSize, true); offset += 4;
      floatTo16BitPCM(offset, floatSamples);

      return new Blob([buffer], { type: 'audio/wav' });
    }

    function buildModesDatContent() {
      const lines = ['%f_n xi_n A_n B_n'];
      if (omega_n && omega_n.length) {
        for (let i = 0; i < omega_n.length; i++) {
          const freqHz = radPerSecToHz(Number(omega_n[i]));
          const parts = [
            Number(freqHz).toPrecision(12),
            Number(xi_n[i]).toPrecision(12),
            Number(A_n[i]).toPrecision(12),
            Number(B_n[i]).toPrecision(12)
          ];
          lines.push(parts.join('\t'));
        }
      }
      return lines.join('\n') + '\n';
    }

    function buildMetadataText(baseName) {
      const now = new Date();
      const t0Val = parseFloat(document.getElementById('t0').value);
      const twinVal = parseFloat(document.getElementById('T').value);
      const t0Safe = Number.isFinite(t0Val) ? t0Val : 0;
      const twinSafe = Number.isFinite(twinVal) ? twinVal : 0;
      const sr = Math.max(0, Math.round(wavSampleRate || params.fs || 0));
      const sampleCount = wavData && wavData.length ? wavData.length : 0;
      const durationSec = sr > 0 ? (sampleCount / sr) : (wavTimeAxis && wavTimeAxis.length ? wavTimeAxis[wavTimeAxis.length - 1] : 0);
      const lines = [
        `Export date (UTC) : ${now.toISOString()}`,
        `Base filename : ${baseName}`,
        `Sampling rate : ${sr} Hz`,
        `Sample count : ${sampleCount}`,
        `Signal duration : ${durationSec.toFixed(6)} s`,
        `Identification window : start t0 = ${t0Safe} s, duration T = ${twinSafe} s`,
        `Stored modes : ${omega_n ? omega_n.length : 0}`,
        `Note : saved WAV signal = current original signal (after any CUT).`
      ];
      return lines.join('\n') + '\n';
    }

    function saveSessionFiles() {
      if (!wavData || !wavData.length || !wavSampleRate) {
        alert('Load or record a WAV signal before saving.');
        return;
      }
      const baseName = promptExportBaseName();
      if (!baseName) {
        return;
      }

      const wavBlob = createWavBlobFromSamples(wavData, wavSampleRate);
      if (!wavBlob) {
        return;
      }
      triggerDownloadBlob(wavBlob, `${baseName}.WAV`);

      const datContent = buildModesDatContent();
      const datBlob = new Blob([datContent], { type: 'text/plain' });
      triggerDownloadBlob(datBlob, `${baseName}.DAT`);

      const txtContent = buildMetadataText(baseName);
      const txtBlob = new Blob([txtContent], { type: 'text/plain' });
      triggerDownloadBlob(txtBlob, `${baseName}.TXT`);
    }

    function fitAmplitudesOnWav(windowData) {
      if (!omega_n || omega_n.length === 0) {
        alert('No mode defined (omega_n empty).');
        return;
      }

      const data = windowData || extractWavWindowData();
      if (!data) return;
      const { tFit, yFit } = data;

      const result = findAmplitudes(omega_n, xi_n, tFit, yFit);
      if (!result || !Array.isArray(result.A_n) || !Array.isArray(result.B_n)) {
        alert("Failed to fit amplitudes (linear solve).");
        return;
      }

      A_n = result.A_n.slice();
      B_n = result.B_n.slice();

      console.log('Fit amplitudes : résidu =', result.res);

      redrawAll();
      return result.res;
    }

    function optimizeModeAtIndex(modeIndex, windowData) {
      if (modeIndex < 0 || modeIndex >= omega_n.length) return false;
      const { tFit, yFit } = windowData;

      const initialOmega = omega_n[modeIndex];
      const initialXi = xi_n[modeIndex];
      if (!isFinite(initialOmega) || !isFinite(initialXi)) {
        console.warn(`Mode ${modeIndex + 1} : paramètres initiaux invalides`);
        return false;
      }

      const freqStep = Math.max(1, Math.abs(initialOmega) * 0.05);
      const xiStep = Math.max(1e-4, Math.abs(initialXi) * 0.2 || 1e-3);

      const objective = (vec) => {
        if (!Array.isArray(vec) || vec.length !== 2) return 1e12;
        const [omegaCandidate, xiCandidate] = vec;
        if (!isFinite(omegaCandidate) || omegaCandidate <= 0) return 1e12;
        if (!isFinite(xiCandidate) || xiCandidate < 0 || xiCandidate >= 1) return 1e12;

        const testOmega = omega_n.slice();
        const testXi = xi_n.slice();
        testOmega[modeIndex] = omegaCandidate;
        testXi[modeIndex] = xiCandidate;

        try {
          const fitRes = findAmplitudes(testOmega, testXi, tFit, yFit);
          if (!fitRes || !isFinite(fitRes.res)) return 1e12;
          return fitRes.res;
        } catch (err) {
          console.error('Erreur Nelder-Mead (REFINE)', err);
          return 1e12;
        }
      };

      let bestResult = null;
      try {
        bestResult = nelderMead(objective, [initialOmega, initialXi], {
          step: [freqStep, xiStep],
          maxIter: 200,
          tol: 1e-8
        });
      } catch (err) {
        console.error(`Nelder-Mead a échoué pour le mode ${modeIndex + 1}`, err);
        return false;
      }

      if (!bestResult || !Array.isArray(bestResult.point) || bestResult.point.length !== 2) {
        console.warn(`Mode ${modeIndex + 1} : résultat Nelder-Mead invalide.`);
        return false;
      }

      let [bestOmega, bestXi] = bestResult.point;
      if (!isFinite(bestOmega) || !isFinite(bestXi)) {
        console.warn(`Mode ${modeIndex + 1} : résultat Nelder-Mead non fini.`);
        return false;
      }

      if (bestXi < 0) bestXi = 0;
      if (bestXi >= 1) bestXi = 0.999;

      omega_n[modeIndex] = bestOmega;
      xi_n[modeIndex] = bestXi;

      console.log(`Mode ${modeIndex + 1} raffiné : résidu min =`, bestResult.value, 'en', bestResult.iterations, 'itérations');
      return true;
    }

    function redrawAll() {
      generateSignal();
      computeSpectrum();
      computeWavSpectrum();
      plotTimeSignalPlotly(timeAxis, timeData);
      plotSpectrumPlotly(freqAxis, spectrumMag);
      syncPeakListFromArrays();
    }

    function init() {

      omega_n = [];
      xi_n = [];
      A_n = [];
      B_n = [];
      syncPeakListFromArrays();
      const defaultDurationSec = recordDurationMs / 1000;
      currentTimeXrange = [0, defaultDurationSec];
      timePlotForceRange = [-1, 1];
      redrawAll();

      const spectrumDiv = document.getElementById('spectrumPlot');
      if (spectrumDiv && !spectrumClickBound && spectrumDiv.on) {
        spectrumDiv.on('plotly_click', function (data) {
          if (!data || !data.points || !data.points.length) return;
          const f = data.points[0].x;
          if (typeof f !== 'number' || !isFinite(f)) return;
          clickCursorFreq = f;
          if (data.event) {
            const coords = pointerEventToPageCoords(data.event);
            hideCursorSetStartButton();
            showCursorAddButtonAt(coords.x, coords.y);
          }
          plotSpectrumPlotly(freqAxis, spectrumMag);
        });
        spectrumClickBound = true;
      }

      const timeDiv = document.getElementById('timePlot');
      if (timeDiv && !timeClickBound && timeDiv.on) {
        timeDiv.on('plotly_click', function (data) {
          if (!data || !data.points || !data.points.length) return;
          const tClicked = data.points[0].x;
          if (typeof tClicked !== 'number' || !isFinite(tClicked)) return;
          pendingTimeStartValue = tClicked;
          clickCursorTime = tClicked;
          if (data.event) {
            const coords = pointerEventToPageCoords(data.event);
            hideCursorAddButton();
            showCursorSetStartButtonAt(coords.x, coords.y);
          }
          plotTimeSignalPlotly(timeAxis, timeData);
        });
        timeClickBound = true;
      }
    }

    window.addEventListener('load', init);
    window.addEventListener('resize', redrawAll);
    document.addEventListener('pointermove', handleGlobalPointerMove);

    const t0Input = document.getElementById('t0');
    const twinInput = document.getElementById('T');

    function handleIdentificationWindowChange() {
      redrawAll();
      if (!wavData || !wavData.length || !wavTimeAxis || !wavTimeAxis.length) return;
      if (!omega_n || omega_n.length === 0) return;
      const windowData = extractWavWindowData();
      if (!windowData) return;
      fitAmplitudesOnWav(windowData);
    }

    if (t0Input) {
      t0Input.addEventListener('input', handleIdentificationWindowChange);
    }
    if (twinInput) {
      twinInput.addEventListener('input', handleIdentificationWindowChange);
    }

    const peakList = document.getElementById('peakList');
    const componentsViewToggle = document.getElementById('componentsViewToggle');
    const btnAdd = document.getElementById('btnAdd');
    const btnRemove = document.getElementById('btnRemove');
    const btnRefine = document.getElementById('btnRefine');
    const btnSave = document.getElementById('btnSave');
    const btnPlaySynth = document.getElementById('btnPlaySynth');
    const btnPlayOriginal = document.getElementById('btnPlayOriginal');
    const playSelectedToggle = document.getElementById('playSelectedToggle');
    const btnLoad = document.getElementById('btnLoad');
    const btnRecord = document.getElementById('btnRecord');
    const btnCut = document.getElementById('btnCut');
    const btnNormalize = document.getElementById('btnNormalize');
    const btnParameters = document.getElementById('btnParameters');
    const parametersModal = document.getElementById('parametersModal');
    const btnParametersSave = document.getElementById('btnParametersSave');
    const btnParametersCancel = document.getElementById('btnParametersCancel');
    const btnParametersClose = document.getElementById('btnParametersClose');
    const btnAboutOpen = document.getElementById('btnAboutOpen');
    const btnAboutClose = document.getElementById('btnAboutClose');
    const btnAboutAgree = document.getElementById('btnAboutAgree');
    const aboutModal = document.getElementById('aboutModal');
    const tabIdentification = document.getElementById('tabIdentification');
    const tabAnalyse = document.getElementById('tabAnalyse');
    const panelIdentification = document.getElementById('panelIdentification');
    const panelAnalyse = document.getElementById('panelAnalyse');
    const analysisMarkersSelect = document.getElementById('analysisMarkers');
    const analysisMarkerIndexControl = document.getElementById('analysisMarkerIndexControl');
    const analysisMarkerIndexInput = document.getElementById('analysisMarkerIndex');
    const lxLyControl = document.getElementById('lxLyControl');
    const lxLySlider = document.getElementById('lxLySlider');
    const lxLyValueInput = document.getElementById('lxLyValue');
    const poissonControl = document.getElementById('poissonControl');
    const poissonSlider = document.getElementById('poissonSlider');
    const poissonValueInput = document.getElementById('poissonValue');
    const btnYoungModulus = document.getElementById('btnYoungModulus');
    const recordDurationInput = document.getElementById('recordDurationInput');
    const recordSampleRateSelect = document.getElementById('recordSampleRateSelect');
    const recordChannelInputs = document.querySelectorAll('input[name=\"recordChannel\"]');
    const fileWavInput = document.getElementById('fileWav');
    const refineProgressContainer = document.getElementById('refineProgressContainer');
    const refineProgressText = document.getElementById('refineProgressText');
    const refineProgressBar = document.getElementById('refineProgressBar');
    const cursorAddButton = document.getElementById('cursorAddButton');
    const cursorSetStartButton = document.getElementById('cursorSetStartButton');
    const youngModulusModal = document.getElementById('youngModulusModal');
    const youngModulusModalTitle = document.getElementById('youngModulusModalTitle');
    const btnYoungModulusClose = document.getElementById('btnYoungModulusClose');
    const youngModulusLxLabel = document.getElementById('youngModulusLxLabel');
    const youngModulusLyLabel = document.getElementById('youngModulusLyLabel');
    const youngModulusLxInput = document.getElementById('youngModulusLx');
    const youngModulusLyInput = document.getElementById('youngModulusLy');
    const youngModulusThicknessInput = document.getElementById('youngModulusThickness');
    const youngModulusMassInput = document.getElementById('youngModulusMass');
    const youngModulusDensityInput = document.getElementById('youngModulusDensity');
    const youngModulusResultInput = document.getElementById('youngModulusResult');
    const REFINE_PROGRESS_DURATION_MS = 450;
    let isotropicPlateFreeRows = null;
    let isotropicPlateFreeLoadPromise = null;
    let refineProgressCurrentRatio = 0;
    let refineProgressAnimFrame = null;
    const POISSON_VALUES = Array.from({ length: 21 }, (_, index) => 0.2 + index * 0.01);
    if (btnAdd) {
      btnAdd.disabled = true;
    }
    if (btnCut) {
      btnCut.disabled = true;
    }
    if (btnNormalize) {
      btnNormalize.disabled = true;
    }

    function highlightSelectedMode() {
      if (!peakList) return;
      const idx = peakList.selectedIndex;
      if (idx >= 0 && idx < omega_n.length) {
        setRefineHighlight(idx);
      } else {
        clearRefineHighlight();
      }
      const componentsToggle = document.getElementById('componentsViewToggle');
      if (componentsToggle && componentsToggle.checked) {
        plotComponentsGraph();
      }
    }

    function updatePlaySelectedToggleState() {
      if (!playSelectedToggle) return;
      playSelectedToggle.checked = !!playSelectedModeActive;
    }

    function maybeAutoPlaySelectedMode() {
      if (!playSelectedModeActive) return;
      playSelectedMode({ silent: true });
    }

    if (peakList) {
      peakList.addEventListener('change', highlightSelectedMode);
      peakList.addEventListener('input', highlightSelectedMode);
      peakList.addEventListener('change', maybeAutoPlaySelectedMode);
      peakList.addEventListener('input', maybeAutoPlaySelectedMode);
    }

    if (componentsViewToggle) {
      componentsViewToggle.addEventListener('change', function () {
        setComponentsViewMode(componentsViewToggle.checked);
      });
      setComponentsViewMode(componentsViewToggle.checked);
    }

    function setLeftToolPanel(panelName) {
      const isIdentification = panelName !== 'analyse';
      if (tabIdentification) {
        tabIdentification.classList.toggle('active', isIdentification);
        tabIdentification.setAttribute('aria-selected', isIdentification ? 'true' : 'false');
      }
      if (tabAnalyse) {
        tabAnalyse.classList.toggle('active', !isIdentification);
        tabAnalyse.setAttribute('aria-selected', !isIdentification ? 'true' : 'false');
      }
      if (panelIdentification) {
        panelIdentification.classList.toggle('active', isIdentification);
        panelIdentification.classList.toggle('hidden', !isIdentification);
      }
      if (panelAnalyse) {
        panelAnalyse.classList.toggle('active', !isIdentification);
        panelAnalyse.classList.toggle('hidden', isIdentification);
      }
      plotSpectrumPlotly(freqAxis, spectrumMag);
    }

    function clampLxLyValue(value) {
      if (!isFinite(value)) return 1;
      return Math.min(Math.max(value, 1), 10);
    }

    function sliderPositionToLxLy(position) {
      const clampedPosition = Math.min(Math.max(position, 0), 1000);
      return Math.pow(10, clampedPosition / 1000);
    }

    function lxLyToSliderPosition(value) {
      const clampedValue = clampLxLyValue(value);
      return Math.round((Math.log10(clampedValue) / Math.log10(10)) * 1000);
    }

    function getSelectedAnalysisMarkerMode() {
      if (!analysisMarkersSelect) return 'none';
      return analysisMarkersSelect.value || 'none';
    }

    function getAnalysisMarkerReferenceIndex() {
      if (!analysisMarkerIndexInput) return 1;
      const rawValue = parseFloat(analysisMarkerIndexInput.value);
      const safeValue = Math.max(1, Math.round(isFinite(rawValue) ? rawValue : 1));
      analysisMarkerIndexInput.value = safeValue.toString();
      return safeValue;
    }

    function getCurrentLxLyValue() {
      if (!lxLyValueInput) return 1;
      return clampLxLyValue(parseFloat(lxLyValueInput.value));
    }

    function isYoungModulusAvailableForCurrentMode() {
      const markerMode = getSelectedAnalysisMarkerMode();
      return markerMode === 'isotropic-plate-free' || markerMode === 'beam-free-free';
    }

    function syncAnalysisControlVisibility() {
      const markerMode = getSelectedAnalysisMarkerMode();
      const showPlateControls = markerMode === 'isotropic-plate-free';
      const showIndexControl = markerMode !== 'none';
      if (analysisMarkerIndexControl) {
        analysisMarkerIndexControl.classList.toggle('hidden', !showIndexControl);
      }
      if (lxLyControl) {
        lxLyControl.classList.toggle('hidden', !showPlateControls);
      }
      if (poissonControl) {
        poissonControl.classList.toggle('hidden', !showPlateControls);
      }
      if (btnYoungModulus) {
        btnYoungModulus.classList.toggle('hidden', !isYoungModulusAvailableForCurrentMode());
      }
    }

    function getCurrentPoissonValue() {
      if (!poissonSlider) return POISSON_VALUES[2];
      const rawIndex = parseInt(poissonSlider.value, 10);
      const safeIndex = Number.isInteger(rawIndex)
        ? Math.min(Math.max(rawIndex, 0), POISSON_VALUES.length - 1)
        : 2;
      return POISSON_VALUES[safeIndex];
    }

    function getNearestPoissonIndex(rawValue) {
      let bestIndex = 0;
      let bestDistance = Infinity;
      for (let i = 0; i < POISSON_VALUES.length; i++) {
        const distance = Math.abs(POISSON_VALUES[i] - rawValue);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = i;
        }
      }
      return bestIndex;
    }

    function syncPoissonControls() {
      if (!poissonSlider || !poissonValueInput) return;
      const value = getCurrentPoissonValue();
      poissonValueInput.value = value.toFixed(2).replace(/0$/, '');
    }

    function syncPoissonControlsFromInput() {
      if (!poissonSlider || !poissonValueInput) return;
      const rawValue = parseFloat(poissonValueInput.value);
      const safeValue = isFinite(rawValue) ? rawValue : POISSON_VALUES[2];
      const nearestIndex = getNearestPoissonIndex(safeValue);
      poissonSlider.value = nearestIndex.toString();
      syncPoissonControls();
    }

    function isAnalysePanelActive() {
      return !!(panelAnalyse && !panelAnalyse.classList.contains('hidden'));
    }

    async function ensureIsotropicPlateFreeDataLoaded() {
      if (Array.isArray(isotropicPlateFreeRows) && isotropicPlateFreeRows.length > 0) {
        return isotropicPlateFreeRows;
      }
      if (!isotropicPlateFreeLoadPromise) {
        isotropicPlateFreeLoadPromise = Promise.resolve()
          .then(() => {
            if (typeof window === 'undefined' ||
                typeof window.ISOTROPIC_PLATE_FREE_DATA_CSV !== 'string') {
              throw new Error('Embedded isotropic plate data is unavailable.');
            }
            return window.ISOTROPIC_PLATE_FREE_DATA_CSV;
          })
          .then(text => {
            const rows = text
              .split(/\r?\n/)
              .map(line => line.trim())
              .filter(line => line.length > 0)
              .map(line => line.split(',').map(value => parseFloat(value.trim())))
              .filter(values => values.length >= 3 && values.every(Number.isFinite))
              .map(values => ({
                aspectRatio: values[0],
                poissonRatio: values[1],
                frequencies: values.slice(2)
              }));
            isotropicPlateFreeRows = rows;
            return rows;
          })
          .catch(error => {
            isotropicPlateFreeLoadPromise = null;
            console.error('Unable to load isotropic plate data:', error);
            return [];
          });
      }
      return isotropicPlateFreeLoadPromise;
    }

    function getNearestIsotropicPlateFreeRow(lxLyValue, poissonValue) {
      if (!Array.isArray(isotropicPlateFreeRows) || isotropicPlateFreeRows.length === 0) return null;
      let bestRow = isotropicPlateFreeRows[0];
      let bestDistance = Math.abs(bestRow.aspectRatio - lxLyValue) + Math.abs(bestRow.poissonRatio - poissonValue);
      for (let i = 1; i < isotropicPlateFreeRows.length; i++) {
        const row = isotropicPlateFreeRows[i];
        const distance = Math.abs(row.aspectRatio - lxLyValue) + Math.abs(row.poissonRatio - poissonValue);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestRow = row;
        }
      }
      return bestRow;
    }

    function getCurrentIsotropicPlateFreeRow() {
      return getNearestIsotropicPlateFreeRow(getCurrentLxLyValue(), getCurrentPoissonValue());
    }

    function getBeamFreeFreeModeRatios() {
      return [
        1.000000,
        2.756538,
        5.403917,
        8.932674,
        13.344093,
        18.638163,
        24.814885,
        31.874258,
        39.816283,
        48.640959,
        58.348287,
        68.938266,
        80.410897,
        92.766179,
        106.004113,
        120.124698,
        135.127934,
        151.013822,
        167.782361,
        185.433552
      ];
    }

    function syncYoungModulusModalLayout() {
      const markerMode = getSelectedAnalysisMarkerMode();
      const isPlateMode = markerMode === 'isotropic-plate-free';
      const isBeamMode = markerMode === 'beam-free-free';

      if (youngModulusModalTitle) {
        youngModulusModalTitle.textContent = isBeamMode
          ? 'CALCULATE YOUNG\'S MODULUS - BEAM (FREE-FREE)'
          : 'CALCULATE YOUNG\'S MODULUS';
      }
      if (youngModulusLxLabel) {
        youngModulusLxLabel.textContent = isBeamMode ? 'Length (mm)' : 'Lx (mm)';
      }
      if (youngModulusLyLabel) {
        youngModulusLyLabel.textContent = isBeamMode ? 'Width (mm)' : 'Ly (mm)';
      }
      if (youngModulusLyInput) {
        youngModulusLyInput.readOnly = isPlateMode;
        youngModulusLyInput.disabled = isPlateMode;
      }
    }

    function updateYoungModulusLyField() {
      if (!youngModulusLyInput) return;
      if (getSelectedAnalysisMarkerMode() !== 'isotropic-plate-free') {
        return;
      }
      const lxValue = youngModulusLxInput ? parseFloat(youngModulusLxInput.value) : NaN;
      const aspectRatio = getCurrentLxLyValue();
      if (!isFinite(lxValue) || lxValue <= 0 || !isFinite(aspectRatio) || aspectRatio <= 0) {
        youngModulusLyInput.value = '';
        return;
      }
      const lyValue = lxValue / aspectRatio;
      youngModulusLyInput.value = lyValue.toFixed(3);
    }

    function updateYoungModulusResultField() {
      if (!youngModulusResultInput) return;
      const markerMode = getSelectedAnalysisMarkerMode();
      const Lx_mes = youngModulusLxInput ? parseFloat(youngModulusLxInput.value) : NaN;
      const Ly_mes = youngModulusLyInput ? parseFloat(youngModulusLyInput.value) : NaN;
      const h_mes = youngModulusThicknessInput ? parseFloat(youngModulusThicknessInput.value) : NaN;
      const m_mes = youngModulusMassInput ? parseFloat(youngModulusMassInput.value) : NaN;
      const referenceIndex = getAnalysisMarkerReferenceIndex();
      const selectedModeIndex = peakList ? peakList.selectedIndex : -1;
      const fn_mes = (selectedModeIndex >= 0 && selectedModeIndex < omega_n.length)
        ? radPerSecToHz(omega_n[selectedModeIndex])
        : NaN;

      const hasValidGeometry =
        isFinite(Lx_mes) && Lx_mes > 0 &&
        isFinite(Ly_mes) && Ly_mes > 0 &&
        isFinite(h_mes) && h_mes > 0 &&
        isFinite(m_mes) && m_mes > 0;

      if (!hasValidGeometry) {
        if (youngModulusDensityInput) {
          youngModulusDensityInput.value = '';
        }
        youngModulusResultInput.value = '';
        return;
      }

      const aspectRatio = getCurrentLxLyValue();
      const h_ref = 1;      
      const Lx_ref = Math.sqrt(aspectRatio)*250;      
      const E_ref = 10;       
      const rho_ref = 1000;          

      const rho_mes = m_mes/(Lx_mes*Ly_mes*h_mes)*1E6;
      if (youngModulusDensityInput) {
        youngModulusDensityInput.value = rho_mes.toFixed(3);
      }

      if (!isFinite(fn_mes) || fn_mes <= 0) {
        youngModulusResultInput.value = '';
        return;
      }

      if (markerMode === 'beam-free-free') {
        const freeFreeRatios = getBeamFreeFreeModeRatios();
        const ratioIndex = referenceIndex - 1;
        const referenceRatio =
          ratioIndex >= 0 && ratioIndex < freeFreeRatios.length
            ? freeFreeRatios[ratioIndex]
            : NaN;
        if (!isFinite(referenceRatio) || referenceRatio <= 0) {
          youngModulusResultInput.value = '';
          return;
        }

        const firstModeFreqHz = fn_mes / referenceRatio;
        if (!isFinite(firstModeFreqHz) || firstModeFreqHz <= 0) {
          youngModulusResultInput.value = '';
          return;
        }

        const betaL = 4.73;
        const lengthMeters = Lx_mes * 1e-3;
        const thicknessMeters = h_mes * 1e-3;
        const density = rho_mes;
        const youngModulusPa =
          12 * density * Math.pow((2 * Math.PI * firstModeFreqHz * Math.pow(lengthMeters, 2)) / (betaL * betaL * thicknessMeters), 2);
        const youngModulusGPa = youngModulusPa / 1e9;
        youngModulusResultInput.value = isFinite(youngModulusGPa) ? youngModulusGPa.toFixed(3) : '';
        return;
      }

      if (markerMode === 'isotropic-plate-free') {
        const isotropicPlateRow = getCurrentIsotropicPlateFreeRow();
        const fn = (isotropicPlateRow &&
                    Array.isArray(isotropicPlateRow.frequencies) &&
                    referenceIndex >= 1 &&
                    referenceIndex <= isotropicPlateRow.frequencies.length)
          ? isotropicPlateRow.frequencies[referenceIndex - 1]
          : NaN;

        if (!isFinite(fn) || fn <= 0) {
          youngModulusResultInput.value = '';
          return;
        }

        const aspectRatio = getCurrentLxLyValue();
        const h_ref = 1;      
        const Lx_ref = Math.sqrt(aspectRatio) * 250;      
        const E_ref = 10;       
        const rho_ref = 1000;          
        const fn_th = (h_mes / h_ref) * Math.sqrt(rho_ref / rho_mes) * Math.pow(Lx_ref / Lx_mes, 2) * fn;
        const youngModulusGPa = Math.pow(fn_mes / fn_th, 2) * E_ref;
        youngModulusResultInput.value = isFinite(youngModulusGPa) ? youngModulusGPa.toFixed(3) : '';
        return;
      }

      youngModulusResultInput.value = '';
    }

    function syncYoungModulusModalComputedFields() {
      syncYoungModulusModalLayout();
      updateYoungModulusLyField();
      updateYoungModulusResultField();
    }

    function appendSpectrumMarkerShapes(shapes, fMaxPlot) {
      if (!shapes) return;
      if (!isAnalysePanelActive()) return;
      if (!peakList) return;

      const selectedIndex = peakList.selectedIndex;
      if (selectedIndex < 0 || selectedIndex >= omega_n.length) return;

      const baseFreqHz = radPerSecToHz(omega_n[selectedIndex]);
      if (!isFinite(baseFreqHz) || baseFreqHz <= 0) return;

      const markerMode = getSelectedAnalysisMarkerMode();
      const referenceIndex = getAnalysisMarkerReferenceIndex();
      if (markerMode === 'harmonics') {
        const fundamentalFreqHz = baseFreqHz / referenceIndex;
        if (!isFinite(fundamentalFreqHz) || fundamentalFreqHz <= 0) return;

        for (let multiple = 1; multiple <= 20; multiple++) {
          const harmonicFreqHz = fundamentalFreqHz * multiple;
          if (harmonicFreqHz > fMaxPlot) break;
          shapes.push({
            type: 'line',
            xref: 'x',
            yref: 'paper',
            x0: harmonicFreqHz,
            x1: harmonicFreqHz,
            y0: 0,
            y1: 1,
            line: {
              color: 'rgba(0,102,204,0.8)',
              width: 2,
              dash: multiple === 1 ? 'solid' : 'dot'
            }
          });
        }
        return;
      }

      if (markerMode === 'beam-free-free') {
        const freeFreeRatios = getBeamFreeFreeModeRatios();
        const ratioIndex = referenceIndex - 1;
        if (ratioIndex < 0 || ratioIndex >= freeFreeRatios.length) return;

        const referenceRatio = freeFreeRatios[ratioIndex];
        if (!isFinite(referenceRatio) || referenceRatio <= 0) return;

        const firstModeFreqHz = baseFreqHz / referenceRatio;
        if (!isFinite(firstModeFreqHz) || firstModeFreqHz <= 0) return;

        for (let modeIndex = 0; modeIndex < freeFreeRatios.length && modeIndex < 20; modeIndex++) {
          const markerFreqHz = firstModeFreqHz * freeFreeRatios[modeIndex];
          if (markerFreqHz > fMaxPlot) break;
          shapes.push({
            type: 'line',
            xref: 'x',
            yref: 'paper',
            x0: markerFreqHz,
            x1: markerFreqHz,
            y0: 0,
            y1: 1,
            line: {
              color: 'rgba(0,102,204,0.8)',
              width: 2,
              dash: modeIndex === 0 ? 'solid' : 'dot'
            }
          });
        }
        return;
      }

      if (markerMode === 'isotropic-plate-free') {
        const nearestRow = getNearestIsotropicPlateFreeRow(getCurrentLxLyValue(), getCurrentPoissonValue());
        if (!nearestRow || !nearestRow.frequencies || nearestRow.frequencies.length === 0) return;

        const firstFrequency = nearestRow.frequencies[0];
        if (!isFinite(firstFrequency) || firstFrequency <= 0) return;

        const dimensionlessRatios = nearestRow.frequencies.map(freq => freq / firstFrequency);
        const ratioIndex = referenceIndex - 1;
        if (ratioIndex < 0 || ratioIndex >= dimensionlessRatios.length) return;

        const referenceRatio = dimensionlessRatios[ratioIndex];
        if (!isFinite(referenceRatio) || referenceRatio <= 0) return;

        const firstModeFreqHz = baseFreqHz / referenceRatio;
        if (!isFinite(firstModeFreqHz) || firstModeFreqHz <= 0) return;

        for (let modeIndex = 0; modeIndex < dimensionlessRatios.length; modeIndex++) {
          const markerFreqHz = firstModeFreqHz * dimensionlessRatios[modeIndex];
          if (markerFreqHz > fMaxPlot) break;
          shapes.push({
            type: 'line',
            xref: 'x',
            yref: 'paper',
            x0: markerFreqHz,
            x1: markerFreqHz,
            y0: 0,
            y1: 1,
            line: {
              color: 'rgba(0,102,204,0.8)',
              width: 2,
              dash: modeIndex === 0 ? 'solid' : 'dot'
            }
          });
        }
      }
    }

    function syncLxLyControlsFromSlider() {
      if (!lxLySlider || !lxLyValueInput) return;
      const sliderValue = parseFloat(lxLySlider.value);
      const lxLyValue = sliderPositionToLxLy(sliderValue);
      lxLyValueInput.value = lxLyValue.toFixed(2);
    }

    function syncLxLyControlsFromInput() {
      if (!lxLySlider || !lxLyValueInput) return;
      const inputValue = clampLxLyValue(parseFloat(lxLyValueInput.value));
      lxLyValueInput.value = inputValue.toFixed(2);
      lxLySlider.value = lxLyToSliderPosition(inputValue).toString();
    }

    if (tabIdentification) {
      tabIdentification.addEventListener('click', () => {
        setLeftToolPanel('identification');
      });
    }
    if (tabAnalyse) {
      tabAnalyse.addEventListener('click', () => {
        setLeftToolPanel('analyse');
      });
    }
    if (lxLySlider) {
      lxLySlider.addEventListener('input', () => {
        syncLxLyControlsFromSlider();
        plotSpectrumPlotly(freqAxis, spectrumMag);
      });
    }
    if (lxLyValueInput) {
      lxLyValueInput.addEventListener('input', () => {
        syncLxLyControlsFromInput();
        plotSpectrumPlotly(freqAxis, spectrumMag);
      });
      lxLyValueInput.addEventListener('change', () => {
        syncLxLyControlsFromInput();
        plotSpectrumPlotly(freqAxis, spectrumMag);
      });
    }
    if (poissonSlider) {
      poissonSlider.addEventListener('input', () => {
        syncPoissonControls();
        plotSpectrumPlotly(freqAxis, spectrumMag);
      });
      poissonSlider.addEventListener('change', () => {
        syncPoissonControls();
        plotSpectrumPlotly(freqAxis, spectrumMag);
      });
    }
    if (poissonValueInput) {
      poissonValueInput.addEventListener('input', () => {
        syncPoissonControlsFromInput();
        plotSpectrumPlotly(freqAxis, spectrumMag);
      });
      poissonValueInput.addEventListener('change', () => {
        syncPoissonControlsFromInput();
        plotSpectrumPlotly(freqAxis, spectrumMag);
      });
    }
    if (analysisMarkersSelect) {
      analysisMarkersSelect.addEventListener('change', async () => {
        syncAnalysisControlVisibility();
        if (getSelectedAnalysisMarkerMode() === 'isotropic-plate-free') {
          await ensureIsotropicPlateFreeDataLoaded();
        }
        plotSpectrumPlotly(freqAxis, spectrumMag);
      });
    }
    if (analysisMarkerIndexInput) {
      analysisMarkerIndexInput.addEventListener('input', () => {
        getAnalysisMarkerReferenceIndex();
        plotSpectrumPlotly(freqAxis, spectrumMag);
      });
      analysisMarkerIndexInput.addEventListener('change', () => {
        getAnalysisMarkerReferenceIndex();
        plotSpectrumPlotly(freqAxis, spectrumMag);
      });
    }
    setLeftToolPanel('identification');
    syncLxLyControlsFromInput();
    syncPoissonControls();
    syncAnalysisControlVisibility();
    ensureIsotropicPlateFreeDataLoaded();

    updatePlaySelectedToggleState();

    function clamp01(value) {
      return Math.min(Math.max(value, 0), 1);
    }

    function stopRefineProgressAnimation() {
      if (refineProgressAnimFrame !== null &&
          typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(refineProgressAnimFrame);
      }
      refineProgressAnimFrame = null;
    }

    function setRefineProgressWidth(ratio) {
      const clamped = clamp01(ratio);
      refineProgressCurrentRatio = clamped;
      if (refineProgressBar) {
        refineProgressBar.style.width = (clamped * 100).toFixed(1) + '%';
      }
    }

    function animateRefineProgressTo(targetRatio) {
      const finalRatio = clamp01(targetRatio);
      setRefineProgressWidth(finalRatio);
    }

    function showRefineProgress(message = '') {
      if (refineProgressContainer) {
        refineProgressContainer.classList.add('visible');
      }
      stopRefineProgressAnimation();
      setRefineProgressWidth(0);
      if (refineProgressText) {
        refineProgressText.textContent = message || 'Refine en cours...';
      }
    }

    function hideRefineProgress() {
      stopRefineProgressAnimation();
      setRefineProgressWidth(0);
      if (refineProgressContainer) {
        refineProgressContainer.classList.remove('visible');
      }
    }

    function updateRecordingProgressDisplay() {
      if (!recordingProgressStartTime) return;
      const elapsed = performance.now() - recordingProgressStartTime;
      const ratio = recordDurationMs > 0 ? Math.min(elapsed / recordDurationMs, 1) : 1;
      setRefineProgressWidth(ratio);
      if (refineProgressText) {
        const secondsElapsed = (elapsed / 1000).toFixed(1);
        const totalSeconds = (recordDurationMs / 1000).toFixed(1);
        refineProgressText.textContent = `Recording ${secondsElapsed} / ${totalSeconds} s`;
      }
    }

    function startRecordingProgressDisplay() {
      if (!refineProgressContainer) return;
      if (recordingProgressIntervalId !== null) {
        clearInterval(recordingProgressIntervalId);
      }
      recordingProgressStartTime = performance.now();
      refineProgressContainer.classList.add('visible');
      setRefineProgressWidth(0);
      updateRecordingProgressDisplay();
      recordingProgressIntervalId = setInterval(updateRecordingProgressDisplay, 100);
    }

    function stopRecordingProgressDisplay() {
      if (recordingProgressIntervalId !== null) {
        clearInterval(recordingProgressIntervalId);
        recordingProgressIntervalId = null;
      }
      recordingProgressStartTime = null;
      if (refineProgressContainer) {
        refineProgressContainer.classList.remove('visible');
      }
      setRefineProgressWidth(0);
    }

    function positionCursorAddButton(pageX, pageY) {
      if (!cursorAddButton) return;
      cursorAddButton.style.left = `${pageX}px`;
      cursorAddButton.style.top = `${pageY}px`;
    }

    function showCursorAddButtonAt(pageX, pageY) {
      if (!cursorAddButton) return;
      cursorAddOrigin = { x: pageX, y: pageY };
      positionCursorAddButton(pageX, pageY + CURSOR_ADD_VERTICAL_OFFSET_PX);
      cursorAddButton.classList.remove('hidden');
      cursorAddButtonVisible = true;
    }

    function hideCursorAddButton() {
      if (!cursorAddButton || !cursorAddButtonVisible) return;
      cursorAddButtonVisible = false;
      cursorAddButton.classList.add('hidden');
    }

    function positionCursorSetStartButton(pageX, pageY) {
      if (!cursorSetStartButton) return;
      cursorSetStartButton.style.left = `${pageX}px`;
      cursorSetStartButton.style.top = `${pageY}px`;
    }

    function showCursorSetStartButtonAt(pageX, pageY) {
      if (!cursorSetStartButton) return;
      cursorSetStartOrigin = { x: pageX, y: pageY };
      positionCursorSetStartButton(pageX, pageY + CURSOR_ADD_VERTICAL_OFFSET_PX);
      cursorSetStartButton.classList.remove('hidden');
      cursorSetStartButtonVisible = true;
    }

    function hideCursorSetStartButton() {
      if (!cursorSetStartButton || !cursorSetStartButtonVisible) return;
      cursorSetStartButtonVisible = false;
      cursorSetStartButton.classList.add('hidden');
      pendingTimeStartValue = null;
      clickCursorTime = null;
      plotTimeSignalPlotly(timeAxis, timeData);
    }

    function pointerEventToPageCoords(event) {
      if (!event) {
        return { x: 0, y: 0 };
      }
      const pageX = typeof event.pageX === 'number'
        ? event.pageX
        : (typeof event.clientX === 'number' ? event.clientX + window.scrollX : 0);
      const pageY = typeof event.pageY === 'number'
        ? event.pageY
        : (typeof event.clientY === 'number' ? event.clientY + window.scrollY : 0);
      return { x: pageX, y: pageY };
    }

    function handleGlobalPointerMove(event) {
      const { x, y } = pointerEventToPageCoords(event);
      if (cursorAddButtonVisible) {
        const dx = x - cursorAddOrigin.x;
        const dy = y - cursorAddOrigin.y;
        if (dx * dx + dy * dy > CURSOR_ADD_HIDE_DISTANCE_PX * CURSOR_ADD_HIDE_DISTANCE_PX) {
          hideCursorAddButton();
        }
      }
      if (cursorSetStartButtonVisible) {
        const dx = x - cursorSetStartOrigin.x;
        const dy = y - cursorSetStartOrigin.y;
        if (dx * dx + dy * dy > CURSOR_ADD_HIDE_DISTANCE_PX * CURSOR_ADD_HIDE_DISTANCE_PX) {
          hideCursorSetStartButton();
        }
      }
    }

    function isParametersModalOpen() {
      return parametersModal && !parametersModal.classList.contains('hidden');
    }

    function syncParametersModalControls() {
      if (recordDurationInput) {
        recordDurationInput.value = (recordDurationMs / 1000).toString();
      }
      if (recordSampleRateSelect) {
        recordSampleRateSelect.value = sanitizeRecordSampleRate(recordSampleRate).toString();
      }
      if (recordChannelInputs && recordChannelInputs.length) {
        recordChannelInputs.forEach(input => {
          input.checked = (input.value === recordChannelPreference);
        });
      }
    }

    function openParametersModal() {
      if (!parametersModal) return;
      syncParametersModalControls();
      parametersModal.classList.remove('hidden');
    }

    function closeParametersModal() {
      if (!parametersModal) return;
      parametersModal.classList.add('hidden');
    }

    function openAboutModal() {
      if (!aboutModal) return;
      aboutModal.classList.remove('hidden');
    }

    function closeAboutModal() {
      if (!aboutModal) return;
      aboutModal.classList.add('hidden');
    }

    function openYoungModulusModal() {
      if (!youngModulusModal) return;
      syncYoungModulusModalComputedFields();
      youngModulusModal.classList.remove('hidden');
    }

    function closeYoungModulusModal() {
      if (!youngModulusModal) return;
      youngModulusModal.classList.add('hidden');
    }

    function saveParametersFromModal() {
      if (recordDurationInput) {
        let durationSec = parseFloat(recordDurationInput.value);
        if (!isFinite(durationSec)) {
          durationSec = DEFAULT_RECORD_DURATION_MS / 1000;
        }
        const newDurationMs = clampRecordDurationMs(durationSec * 1000);
        recordDurationMs = newDurationMs;
      }
      if (recordSampleRateSelect) {
        recordSampleRate = sanitizeRecordSampleRate(recordSampleRateSelect.value);
      }
      if (recordChannelInputs && recordChannelInputs.length) {
        recordChannelInputs.forEach(input => {
          if (input.checked) {
            recordChannelPreference = input.value === 'right' ? 'right' : 'left';
          }
        });
      }
      closeParametersModal();
    }

    function updateRefineProgressBar(current, total, message = '') {
      const ratio = total > 0 ? clamp01(current / total) : 0;
      animateRefineProgressTo(ratio);
      if (refineProgressText) {
        refineProgressText.textContent = message || `Refine ${Math.round(ratio * 100)} %`;
      }
    }

    function waitNextFrame() {
      return new Promise(resolve => {
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => resolve());
        } else {
          setTimeout(resolve, 0);
        }
      });
    }

    function setRefineHighlight(modeIndex) {
      let omegaValue = null;
      if (typeof modeIndex === 'number' &&
          modeIndex >= 0 &&
          modeIndex < omega_n.length) {
        omegaValue = omega_n[modeIndex];
      }
      if (currentRefineHighlightOmega === omegaValue) {
        return;
      }
      currentRefineHighlightOmega = omegaValue;
      plotSpectrumPlotly(freqAxis, spectrumMag);
    }

    function clearRefineHighlight() {
      if (currentRefineHighlightOmega === null) {
        return;
      }
      currentRefineHighlightOmega = null;
      plotSpectrumPlotly(freqAxis, spectrumMag);
    }

    btnAdd.addEventListener('click', () => {
      if (!wavData || !wavSampleRate) {
        alert("Load a WAV file before adding modes.");
        return;
      }
      if (clickCursorFreq === null) {
        alert("Click the spectrum first to pick a frequency (red line).");
        return;
      }

      const selectedFreq = clickCursorFreq;
      clickCursorFreq = null;
      hideCursorAddButton();
      plotSpectrumPlotly(freqAxis, spectrumMag);

      const omega = hzToRadPerSec(selectedFreq);
      const xi = 0.01;                  
      const A = 1.0;
      const B = 1.0;

      omega_n.push(omega);
      xi_n.push(xi);
      A_n.push(A);
      B_n.push(B);

      const insertedIndex = omega_n.length - 1;

      let windowData = null;
      if (wavTimeAxis && wavData && wavTimeAxis.length > 0 && wavData.length > 0) {
        windowData = extractWavWindowData();
      }
      if (windowData) {
        optimizeModeAtIndex(insertedIndex, windowData);
        fitAmplitudesOnWav(windowData);
      }

      sortModesByFrequency();
      redrawAll();
    });

    btnRemove.addEventListener('click', () => {
      const selectedIndex = peakList.selectedIndex;
      if (selectedIndex === -1) {
        alert("Select a row to delete first.");
        return;
      }

      omega_n.splice(selectedIndex, 1);
      xi_n.splice(selectedIndex, 1);
      A_n.splice(selectedIndex, 1);
      B_n.splice(selectedIndex, 1);

      sortModesByFrequency();

      let windowData = null;
      if (wavTimeAxis && wavData && wavTimeAxis.length > 0 && wavData.length > 0) {
        windowData = extractWavWindowData();
      }
      if (windowData) {
        fitAmplitudesOnWav(windowData);
      }

      redrawAll();
      highlightSelectedMode();
    });

    btnRefine.addEventListener('click', async () => {
      if (!omega_n || omega_n.length === 0) {
        alert('No mode defined.');
        return;
      }

      if (clickCursorFreq !== null) {
        clickCursorFreq = null;
        hideCursorAddButton();
        plotSpectrumPlotly(freqAxis, spectrumMag);
      }

      const windowData = extractWavWindowData();
      if (!windowData) return;

      const total = omega_n.length;
      let refinedCount = 0;
      showRefineProgress('Initialisation...');
      clearRefineHighlight();
      setRefineWorkingIndex(null);
      await waitNextFrame();
      try {
        for (let i = 0; i < total; i++) {
          const progressLabel = `${i + 1} / ${total}`;
          updateRefineProgressBar(i, total, progressLabel);
          setRefineHighlight(i);
          setRefineWorkingIndex(i);
          await waitNextFrame();
          const didRefine = optimizeModeAtIndex(i, windowData);
          if (didRefine) {
            refinedCount++;
          }
          applyRefineWorkingStateToPeakList();
          setRefineHighlight(i);
          updateRefineProgressBar(i + 1, total, progressLabel);
          await waitNextFrame();
        }
        clearRefineHighlight();
        setRefineWorkingIndex(null);
        updateRefineProgressBar(total, total, `${total} / ${total}`);
        await waitNextFrame();

        if (refinedCount === 0) {
          alert("Failed to refine modes (see console).");
          return;
        }

        fitAmplitudesOnWav(windowData);
      } finally {
        setRefineWorkingIndex(null);
        hideRefineProgress();
        highlightSelectedMode();
      }
    });

    btnPlaySynth.addEventListener('click', () => {
      playSynth();
    });

    if (btnSave) {
      btnSave.addEventListener('click', () => {
        saveSessionFiles();
      });
    }

    btnPlayOriginal.addEventListener('click', () => {
      playOriginal();
    });

    if (playSelectedToggle) {
      playSelectedToggle.addEventListener('change', () => {
        playSelectedModeActive = playSelectedToggle.checked;
        updatePlaySelectedToggleState();
        if (playSelectedModeActive) {
          maybeAutoPlaySelectedMode();
        }
      });
    }

    if (cursorAddButton) {
      cursorAddButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (btnAdd && typeof btnAdd.click === 'function') {
          btnAdd.click();
        }
      });
    }
    if (cursorSetStartButton) {
      cursorSetStartButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!t0Input || pendingTimeStartValue === null) return;
        const safeValue = Math.max(0, pendingTimeStartValue);
        t0Input.value = safeValue.toFixed(4);
        handleIdentificationWindowChange();
        hideCursorSetStartButton();
      });
    }

    btnLoad.addEventListener('click', () => {
      fileWavInput.value = '';
      fileWavInput.click();
    });

    if (btnRecord) {
      btnRecord.addEventListener('click', () => {
        startMicrophoneRecording();
      });
    }

    if (btnCut) {
      btnCut.addEventListener('click', () => {
        cutWavSignalToCurrentView();
      });
    }
    if (btnNormalize) {
      btnNormalize.addEventListener('click', () => {
        normalizeWavSignal();
      });
    }

    fileWavInput.addEventListener('change', handleWavFile);

    if (btnParameters) {
      btnParameters.addEventListener('click', () => {
        openParametersModal();
      });
    }
    if (btnParametersSave) {
      btnParametersSave.addEventListener('click', (event) => {
        event.preventDefault();
        saveParametersFromModal();
      });
    }
    if (btnParametersCancel) {
      btnParametersCancel.addEventListener('click', (event) => {
        event.preventDefault();
        closeParametersModal();
      });
    }
    if (btnAboutOpen) {
      btnAboutOpen.addEventListener('click', () => {
        openAboutModal();
      });
    }
    if (btnYoungModulus) {
      btnYoungModulus.addEventListener('click', async () => {
        if (getSelectedAnalysisMarkerMode() === 'isotropic-plate-free') {
          await ensureIsotropicPlateFreeDataLoaded();
        }
        openYoungModulusModal();
      });
    }
    if (youngModulusLxInput) {
      youngModulusLxInput.addEventListener('input', () => {
        syncYoungModulusModalComputedFields();
      });
      youngModulusLxInput.addEventListener('change', () => {
        syncYoungModulusModalComputedFields();
      });
    }
    if (youngModulusThicknessInput) {
      youngModulusThicknessInput.addEventListener('input', () => {
        updateYoungModulusResultField();
      });
      youngModulusThicknessInput.addEventListener('change', () => {
        updateYoungModulusResultField();
      });
    }
    if (youngModulusMassInput) {
      youngModulusMassInput.addEventListener('input', () => {
        updateYoungModulusResultField();
      });
      youngModulusMassInput.addEventListener('change', () => {
        updateYoungModulusResultField();
      });
    }
    if (youngModulusLyInput) {
      youngModulusLyInput.addEventListener('input', () => {
        updateYoungModulusResultField();
      });
      youngModulusLyInput.addEventListener('change', () => {
        updateYoungModulusResultField();
      });
    }
    if (btnAboutAgree) {
      btnAboutAgree.addEventListener('click', closeAboutModal);
    }
    if (btnAboutClose) {
      btnAboutClose.addEventListener('click', () => {
        closeAboutModal();
      });
    }
    if (btnYoungModulusClose) {
      btnYoungModulusClose.addEventListener('click', () => {
        closeYoungModulusModal();
      });
    }
    if (btnParametersClose) {
      btnParametersClose.addEventListener('click', (event) => {
        event.preventDefault();
        closeParametersModal();
      });
    }
    if (parametersModal) {
      parametersModal.addEventListener('click', (event) => {
        if (event.target === parametersModal) {
          closeParametersModal();
        }
      });
    }
    if (youngModulusModal) {
      youngModulusModal.addEventListener('click', (event) => {
        if (event.target === youngModulusModal) {
          closeYoungModulusModal();
        }
      });
    }
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isParametersModalOpen()) {
        closeParametersModal();
      }
      if (event.key === 'Escape' && youngModulusModal && !youngModulusModal.classList.contains('hidden')) {
        closeYoungModulusModal();
      }
    });

    (function runTests() {

      const fTest = 440;
      const wTest = hzToRadPerSec(fTest);
      const fBack = radPerSecToHz(wTest);
      if (Math.abs(fBack - fTest) > 1e-9) {
        console.error('Conversion Hz <-> rad/s failed', fTest, fBack);
      } else {
        console.log('Conversion Hz <-> rad/s OK');
      }

      const Mtest = [
        [2, 1],
        [1, 3]
      ];
      const btest = [1, 2];
      const xtest = solveLinearSystem(Mtest, btest);
      if (!xtest || xtest.length !== 2 ||
          Math.abs(xtest[0] - 0.2) > 1e-6 ||
          Math.abs(xtest[1] - 0.6) > 1e-6) {
        console.error('solveLinearSystem failed', xtest);
      } else {
        console.log('solveLinearSystem OK');
      }
    })();
