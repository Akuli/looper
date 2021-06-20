const BEATS_PER_MINUTE = 120;  // user input, to be used only once

const BEATS_PER_LOOP = 4;
const SAMPLE_RATE = 44100;
const SAMPLES_PER_BEAT = Math.round(SAMPLE_RATE / (BEATS_PER_MINUTE/60));
const SAMPLES_PER_LOOP = SAMPLES_PER_BEAT * BEATS_PER_LOOP;

let loopDuration = SAMPLES_PER_BEAT;
let ctx = null;
let loopAudioBuffer = null;
let chanCounter = 0;

async function blobToArrayBuffer(blob) {
  // https://stackoverflow.com/a/40364457
  const fileReader = new FileReader();
  await new Promise(resolve => {
    fileReader.onloadend = resolve;
    fileReader.readAsArrayBuffer(blob);
  });
  return fileReader.result;
}

async function arrayBufferToAudioBuffer(arrayBuffer) {
  return await new Promise(resolve => ctx.decodeAudioData(arrayBuffer, resolve));
}

function sampleShit(targetArray) {
  const notes = [0, 2, 4, 5, 7, 9, 11, 12];
  for (let i = 0; i < targetArray.length; i++) {
    const note = notes[Math.floor(i / (0.25*SAMPLE_RATE))]
    targetArray[i] = 0.05*Math.sin(2*Math.PI*110*Math.pow(2, note/12)*i/SAMPLE_RATE);
  }
}

function connectMultiChannelToSpeaker(source) {
  const splitter = ctx.createChannelSplitter(32);
  source.connect(splitter);

  const merger = ctx.createChannelMerger(2);
  for (let chanNumber = 0; chanNumber < 32; chanNumber++) {
    // Every channel goes to left and right
    splitter.connect(merger, chanNumber, 0);
    splitter.connect(merger, chanNumber, 1);
  }
  merger.connect(ctx.destination);
}

// Handles wrapping over the end
function saveTrack(startTime, sourceData, destData) {
  startTime -= 0.12;  // Compensate for lag. There's much more lag than ctx.baseLatency says.
  let sourceOffset = 0;
  let destinationOffset = Math.round(startTime*SAMPLE_RATE) % destData.length;

  while (sourceOffset < sourceData.length) {
    const dataLeftToCopy = sourceData.length - sourceOffset;
    const roomForData = destData.length - destinationOffset;
    const howMuchToCopy = Math.min(dataLeftToCopy, roomForData);
    destData.set(sourceData.slice(sourceOffset, sourceOffset + howMuchToCopy), destinationOffset);
    sourceOffset += howMuchToCopy;
    destinationOffset += howMuchToCopy;
    destinationOffset %= destData.length;
  }
}

async function main() {
  const recordButton = document.getElementById('record');
  const stopButton = document.getElementById('stop');

  const userMedia = await navigator.mediaDevices.getUserMedia({ audio: true });
  ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  loopAudioBuffer = new AudioBuffer({
    length: SAMPLES_PER_LOOP,
    sampleRate: SAMPLE_RATE,
    numberOfChannels: 32
  });
  for (let i = 0; i < 32; i++) {
    loopAudioBuffer.getChannelData(i).fill(0);
  }

  const streamDestination = ctx.createMediaStreamDestination();
  const microphone = ctx.createMediaStreamSource(userMedia);
  microphone.connect(streamDestination);

  let mediaRecorder;
  const bufSource = ctx.createBufferSource();
  bufSource.channelCount = 32;
  bufSource.buffer = loopAudioBuffer;
  bufSource.loop = true;
  connectMultiChannelToSpeaker(bufSource);
  bufSource.start();

  recordButton.addEventListener('click', () => {
    startTime = ctx.currentTime;
    mediaRecorder = new MediaRecorder(streamDestination.stream)
    const chunks = [];
    mediaRecorder.ondataavailable = event => chunks.push(event.data);
    mediaRecorder.onstop = async () => {
      const audioBuffer = await arrayBufferToAudioBuffer(
        await blobToArrayBuffer(
          new Blob(chunks, { type: 'audio/ogg; codecs=opus' })
        )
      );
      saveTrack(startTime, audioBuffer.getChannelData(0), loopAudioBuffer.getChannelData(chanCounter++));
    };
    mediaRecorder.start();
  });

  stopButton.addEventListener('click', () => {
    mediaRecorder.requestData();
    mediaRecorder.stop();
  });

  document.getElementById("foo").addEventListener("click", () => {
    sampleShit(loopAudioBuffer.getChannelData(chanCounter++));
  });

  // TODO: ctx.currentTime for layer placement
  // TODO: latency adjuster scaler adjustmenter: use ctx.baseLatency if available (experimental)
}

document.addEventListener('DOMContentLoaded', main);
