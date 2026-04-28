const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const volumeSlider = document.getElementById("volumeSlider");
const timerDisplay = document.getElementById("timer");
const modeButtons = document.querySelectorAll(".mode-button");
const modeLabel = document.getElementById("modeLabel");

const presets = {
    focus: {
        label: "Focus mode",
        master: {
            gain: 0.12,
            fadeInSeconds: 4,
            compressor: {
                threshold: -24,
                knee: 18,
                ratio: 2,
                attack: 0.08,
                release: 0.8,
            },
        },
        noiseBed: {
            gain: [0.035, 0.075],
            lowpass: [500, 900],
            highpass: [120, 220],
            pan: [-0.05, 0.05],
            modulationInterval: [90, 240],
        },
        tonalBody: {
            startDelaySeconds: 30,
            fadeInSeconds: 60,
            rootFrequency: [120, 220],
            intervals: [1, 1.2],
            waveform: "sine",
            detuneCents: [-2, 2],
            lowpass: [500, 900],
            modulationInterval: [90, 240],
            firstGain: [0.00003, 0.0001],
            secondGain: [0.00001, 0.00004],
        },
        microMovement: {
            eventGap: [15, 35],
            // eventProbability: 0.5,
            duration: [5, 12],
            //  gain: [0.002, 0.008],
            // bandpassFrequency: [350, 1400],
            q: [0.4, 1.0],
            pan: [-0.18, 0.18],
            attack: [2.5, 5],
            release: [4, 9],
        },
    },

    calm: {
        label: "Calm mode",
        master: {
            gain: 0.1,
            fadeInSeconds: 8,
            compressor: {
                threshold: -26,
                knee: 20,
                ratio: 1.8,
                attack: 0.1,
                release: 1.0,
            },
        },
        noiseBed: {
            gain: [0.025, 0.055],
            lowpass: [500, 950],
            highpass: [90, 180],
            pan: [-0.035, 0.035],
            modulationInterval: [70, 160],
        },
        tonalBody: {
            startDelaySeconds: 45,
            fadeInSeconds: 90,
            rootFrequency: [260, 380],
            intervals: [1, 1.31],
            waveform: "sine",
            detuneCents: [-3, 3],
            lowpass: [420, 800],
            modulationInterval: [180, 360],
            firstGain: [0.00004, 0.00012],
            secondGain: [0.000015, 0.00005],
        },
        microMovement: {
            eventGap: [25, 60],
            eventProbability: 0.35,
            duration: [8, 18],
            gain: [0.001, 0.004],
            bandpassFrequency: [250, 900],
            q: [0.3, 0.8],
            pan: [-0.12, 0.12],
            attack: [4, 9],
            release: [6, 14],
        },
    },
};

let selectedMode = "focus";
let currentPreset = presets[selectedMode];

let audioContext = null;
let masterGain = null;
let compressor = null;

let noiseSource = null;
let noiseGain = null;
let noiseLowpass = null;
let noiseHighpass = null;
let noisePan = null;

let tonalOscillators = [];
let tonalGains = [];
let tonalFilters = [];

let timers = [];
let cleanupTimer = null;

let sessionStartTime = null;
let sessionTimer = null;
let isRunning = false;
let isStopping = false;

function createSeededRandom(seed) {
    let value = seed % 2147483647;
    if (value <= 0) value += 2147483646;

    return function random() {
        value = (value * 16807) % 2147483647;
        return (value - 1) / 2147483646;
    };
}

let random = createSeededRandom(Date.now());

function randomBetween(min, max) {
    return min + random() * (max - min);
}

function chance(probability) {
    return random() < probability;
}

function secondsRange(range) {
    return randomBetween(range[0], range[1]);
}

function setSmooth(param, value, seconds = 1) {
    const now = audioContext.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + seconds);
}

function addTimer(timerId) {
    timers.push(timerId);
}

function clearAllTimers() {
    timers.forEach(clearTimeout);
    timers = [];

    if (sessionTimer) {
        clearInterval(sessionTimer);
        sessionTimer = null;
    }

    if (cleanupTimer) {
        clearTimeout(cleanupTimer);
        cleanupTimer = null;
    }
}

function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function updateTimer() {
    if (!sessionStartTime) return;

    const elapsedSeconds = Math.floor((Date.now() - sessionStartTime) / 1000);
    timerDisplay.textContent = formatTime(elapsedSeconds);
}

function createAudioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    return new AudioContextClass();
}

function getTargetMasterGain() {
    return Number(volumeSlider.value) * currentPreset.master.gain;
}

function createImpulseResponse(context, duration = 3, decay = 2) {
    const sampleRate = context.sampleRate;
    const length = sampleRate * duration;
    const impulse = context.createBuffer(2, length, sampleRate);

    for (let channel = 0; channel < 2; channel++) {
        const data = impulse.getChannelData(channel);
        for (let i = 0; i < length; i++) {
            data[i] =
                (Math.random() * 2 - 1) *
                Math.pow(1 - i / length, decay);
        }
    }

    return impulse;
}

function chooseNewEnvironmentPhase() {
    if (!isRunning || !audioContext) return;

    // Slightly shift noise bed
    if (noiseGain && noiseLowpass && noiseHighpass && noisePan) {
        const duration = secondsRange([180, 360]); // 3–6 minute transition

        setSmooth(noiseGain.gain, secondsRange(currentPreset.noiseBed.gain), duration);
        setSmooth(noiseLowpass.frequency, secondsRange(currentPreset.noiseBed.lowpass), duration);
        setSmooth(noiseHighpass.frequency, secondsRange(currentPreset.noiseBed.highpass), duration);
        setSmooth(noisePan.pan, secondsRange([-0.025, 0.025]), duration);
    }

    // Slightly shift tonal layer
    tonalGains.forEach((gain, index) => {
        const duration = secondsRange([180, 420]);

        const targetGain =
            index === 0
                ? secondsRange(currentPreset.tonalBody.firstGain)
                : secondsRange(currentPreset.tonalBody.secondGain);

        setSmooth(gain.gain, targetGain, duration);
    });

    tonalFilters.forEach((filter) => {
        const duration = secondsRange([180, 420]);
        setSmooth(filter.frequency, secondsRange(currentPreset.tonalBody.lowpass), duration);
    });

    tonalOscillators.forEach((oscillator) => {
        const duration = secondsRange([180, 420]);
        setSmooth(oscillator.detune, secondsRange(currentPreset.tonalBody.detuneCents), duration);
    });

    // Schedule next phase shift: every 5–10 minutes
    const nextDelay = secondsRange([300, 600]) * 1000;

    addTimer(setTimeout(chooseNewEnvironmentPhase, nextDelay));
}

function createMasterChain(context) {
    masterGain = context.createGain();
    masterGain.gain.value = 0;

    compressor = context.createDynamicsCompressor();
    compressor.threshold.value = currentPreset.master.compressor.threshold;
    compressor.knee.value = currentPreset.master.compressor.knee;
    compressor.ratio.value = currentPreset.master.compressor.ratio;
    compressor.attack.value = currentPreset.master.compressor.attack;
    compressor.release.value = currentPreset.master.compressor.release;

    const reverb = context.createConvolver();
    const reverbGain = context.createGain();

    // subtle mix
    reverbGain.gain.value = 0.08; // 5–10% is ideal

    // routing
    masterGain.connect(reverb);
    reverb.connect(reverbGain);
    reverbGain.connect(compressor);
    reverb.buffer = createImpulseResponse(context, 3, 2);

    // dry signal still goes through
    masterGain.connect(compressor);
    compressor.connect(context.destination);
}

function createNoiseBuffer(context, durationSeconds = 90) {
    const sampleRate = context.sampleRate;
    const frameCount = sampleRate * durationSeconds;
    const buffer = context.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < frameCount; i++) {
        data[i] = randomBetween(-1, 1);
    }

    return buffer;
}

function startNoiseBed(context) {
    noiseSource = context.createBufferSource();
    noiseSource.buffer = createNoiseBuffer(context);
    noiseSource.loop = true;

    noiseHighpass = context.createBiquadFilter();
    noiseHighpass.type = "highpass";
    noiseHighpass.frequency.value = secondsRange(currentPreset.noiseBed.highpass);
    noiseHighpass.Q.value = 0.4;

    noiseLowpass = context.createBiquadFilter();
    noiseLowpass.type = "lowpass";
    noiseLowpass.frequency.value = secondsRange(currentPreset.noiseBed.lowpass);
    noiseLowpass.Q.value = 0.4;

    noiseGain = context.createGain();

    const targetNoiseGain = secondsRange(currentPreset.noiseBed.gain);
    noiseGain.gain.value = 0;
    noiseGain.gain.linearRampToValueAtTime(targetNoiseGain, context.currentTime + 8);

    noisePan = context.createStereoPanner();
    noisePan.pan.value = secondsRange(currentPreset.noiseBed.pan);

    noiseSource.connect(noiseHighpass);
    noiseHighpass.connect(noiseLowpass);
    noiseLowpass.connect(noiseGain);
    noiseGain.connect(noisePan);
    noisePan.connect(masterGain);

    noiseSource.start();
}

function modulateNoiseBed() {
    if (!isRunning || !audioContext || !noiseGain) return;

    const duration = secondsRange([60, 140]);

    setSmooth(noiseGain.gain,
        secondsRange(currentPreset.noiseBed.gain) * randomBetween(0.9, 1.1),
        duration
    );
    setSmooth(noiseLowpass.frequency, secondsRange(currentPreset.noiseBed.lowpass), duration);
    setSmooth(noiseHighpass.frequency, secondsRange(currentPreset.noiseBed.highpass), duration);
    setSmooth(noisePan.pan, randomBetween(-0.03, 0.03), duration);

    const nextDelay = secondsRange(currentPreset.noiseBed.modulationInterval) * 1000;
    addTimer(setTimeout(modulateNoiseBed, nextDelay));
}

function startTonalBody(context) {
    const root = secondsRange(currentPreset.tonalBody.rootFrequency);

    currentPreset.tonalBody.intervals.forEach((interval, index) => {
        const oscillator = context.createOscillator();
        oscillator.type = currentPreset.tonalBody.waveform;
        oscillator.frequency.value = root * interval;
        oscillator.detune.value = secondsRange(currentPreset.tonalBody.detuneCents);

        const filter = context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = secondsRange(currentPreset.tonalBody.lowpass);
        filter.Q.value = 0.3;

        const gain = context.createGain();

        const targetGain =
            index === 0
                ? secondsRange(currentPreset.tonalBody.firstGain)
                : secondsRange(currentPreset.tonalBody.secondGain);

        gain.gain.value = 0;
        gain.gain.linearRampToValueAtTime(
            targetGain,
            context.currentTime + currentPreset.tonalBody.fadeInSeconds
        );

        oscillator.connect(filter);
        filter.connect(gain);
        gain.connect(masterGain);

        oscillator.start();

        tonalOscillators.push(oscillator);
        tonalGains.push(gain);
        tonalFilters.push(filter);
    });
}

function modulateTonalBody() {
    if (!isRunning || !audioContext || tonalGains.length === 0) return;

    tonalGains.forEach((gain, index) => {
        const duration = secondsRange([45, 100]);

        const targetGain =
            index === 0
                ? secondsRange(currentPreset.tonalBody.firstGain)
                : secondsRange(currentPreset.tonalBody.secondGain);

        setSmooth(gain.gain, targetGain, duration);
    });

    tonalFilters.forEach((filter) => {
        const duration = secondsRange([50, 120]);
        setSmooth(filter.frequency, secondsRange(currentPreset.tonalBody.lowpass), duration);
    });

    tonalOscillators.forEach((oscillator) => {
        const duration = secondsRange([60, 150]);
        setSmooth(oscillator.detune, secondsRange(currentPreset.tonalBody.detuneCents), duration);
    });

    const nextDelay = secondsRange(currentPreset.tonalBody.modulationInterval) * 1000;
    addTimer(setTimeout(modulateTonalBody, nextDelay));
}

function triggerMicroMovement() {
    if (!isRunning || !audioContext) return;
    if (!chance(currentPreset.microMovement.eventProbability)) return;

    const now = audioContext.currentTime;

    const duration = secondsRange(currentPreset.microMovement.duration);
    const attack = Math.min(secondsRange(currentPreset.microMovement.attack), duration * 0.45);

    const oscillator = audioContext.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = secondsRange(currentPreset.microMovement.bandpassFrequency);

    const filter = audioContext.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = secondsRange(currentPreset.microMovement.bandpassFrequency);
    filter.Q.value = secondsRange(currentPreset.microMovement.q);

    const gain = audioContext.createGain();
    gain.gain.setValueAtTime(0, now);

    gain.gain.linearRampToValueAtTime(
        secondsRange(currentPreset.microMovement.gain),
        now + attack
    );

    gain.gain.linearRampToValueAtTime(0, now + duration);

    const pan = audioContext.createStereoPanner();
    pan.pan.value = secondsRange(currentPreset.microMovement.pan);

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(pan);
    pan.connect(masterGain);

    oscillator.start(now);
    oscillator.stop(now + duration + 0.2);
}

function scheduleMicroMovement() {
    if (!isRunning) return;

    const delay = secondsRange(currentPreset.microMovement.eventGap) * 1000;

    addTimer(
        setTimeout(() => {
            triggerMicroMovement();
            scheduleMicroMovement();
        }, delay)
    );
}

function updateModeButtons() {
    modeButtons.forEach((button) => {
        button.classList.toggle("active", button.dataset.mode === selectedMode);
    });
}

async function startEngine() {
    if (isRunning || isStopping) return;

    currentPreset = presets[selectedMode];
    modeLabel.textContent = currentPreset.label;

    random = createSeededRandom(Date.now());

    audioContext = createAudioContext();
    createMasterChain(audioContext);

    await audioContext.resume();

    isRunning = true;

    startNoiseBed(audioContext);

    addTimer(
        setTimeout(() => {
            if (isRunning && audioContext) {
                startTonalBody(audioContext);

                addTimer(
                    setTimeout(() => {
                        if (isRunning && audioContext) {
                            modulateTonalBody();
                        }
                    }, currentPreset.tonalBody.fadeInSeconds * 1000)
                );
            }
        }, currentPreset.tonalBody.startDelaySeconds * 1000)
    );

    const now = audioContext.currentTime;

    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(
        getTargetMasterGain(),
        now + currentPreset.master.fadeInSeconds
    );

    modulateNoiseBed();
    scheduleMicroMovement();
    chooseNewEnvironmentPhase();

    sessionStartTime = Date.now();
    timerDisplay.textContent = "00:00";
    sessionTimer = setInterval(updateTimer, 1000);

    startButton.disabled = true;
    stopButton.disabled = false;

    modeButtons.forEach((button) => {
        button.disabled = true;
    });
}

function stopEngine() {
    if (!isRunning || isStopping) return;

    isRunning = false;
    isStopping = true;
    clearAllTimers();

    if (!audioContext || !masterGain) {
        isStopping = false;
        return;
    }

    const now = audioContext.currentTime;

    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(0, now + 1.5);

    cleanupTimer = setTimeout(() => {
        try {
            if (noiseSource) noiseSource.stop();
        } catch (error) { }

        tonalOscillators.forEach((oscillator) => {
            try {
                oscillator.stop();
            } catch (error) { }
        });

        if (audioContext) {
            audioContext.close();
        }

        audioContext = null;
        masterGain = null;
        compressor = null;

        noiseSource = null;
        noiseGain = null;
        noiseLowpass = null;
        noiseHighpass = null;
        noisePan = null;

        tonalOscillators = [];
        tonalGains = [];
        tonalFilters = [];

        sessionStartTime = null;
        cleanupTimer = null;
        isStopping = false;

        startButton.disabled = false;
        stopButton.disabled = true;

        modeButtons.forEach((button) => {
            button.disabled = false;
        });
    }, 1600);
}

volumeSlider.addEventListener("input", () => {
    if (!masterGain || !audioContext) return;

    const now = audioContext.currentTime;

    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(getTargetMasterGain(), now + 0.25);
});

modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
        if (isRunning || isStopping) return;

        selectedMode = button.dataset.mode;
        currentPreset = presets[selectedMode];
        modeLabel.textContent = currentPreset.label;
        updateModeButtons();
    });
});

startButton.addEventListener("click", startEngine);
stopButton.addEventListener("click", stopEngine);

updateModeButtons();
modeLabel.textContent = currentPreset.label;
