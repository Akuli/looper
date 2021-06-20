import { Track } from './track.js';

const SAMPLE_RATE = 44100;

// I read somewhere that some spec requires 32 channels to work. Don't remember where. Sorry.
const MAX_TRACKS = 32;

async function blobToArrayBuffer(blob) {
  // https://stackoverflow.com/a/40364457
  const fileReader = new FileReader();
  await new Promise(resolve => {
    fileReader.onloadend = resolve;
    fileReader.readAsArrayBuffer(blob);
  });
  return fileReader.result;
}

async function arrayBufferToAudioBuffer(ctx, arrayBuffer) {
  return await new Promise(resolve => ctx.decodeAudioData(arrayBuffer, resolve));
}

function connectMultiChannelToSpeaker(ctx, source) {
  const splitter = ctx.createChannelSplitter(MAX_TRACKS);
  source.connect(splitter);

  const merger = ctx.createChannelMerger(2);
  for (let chanNumber = 0; chanNumber < MAX_TRACKS; chanNumber++) {
    // Every channel goes to left and right
    splitter.connect(merger, chanNumber, 0);
    splitter.connect(merger, chanNumber, 1);
  }
  merger.connect(ctx.destination);
}

// Handles wrapping over the end
function copyAndWrap(startTime, sourceData, destData) {
  startTime -= 0.12;  // Compensate for lag. There's much more lag than this.ctx.baseLatency says.
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

export class AudioManager {
  constructor(userMedia, beatsPerMinute, beatsPerLoop) {
    const beatsPerSecond = beatsPerMinute / 60;
    const samplesPerBeat = Math.round(SAMPLE_RATE / beatsPerSecond);

    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.loopAudioBuffer = new AudioBuffer({
      length: samplesPerBeat * beatsPerLoop,
      sampleRate: SAMPLE_RATE,
      numberOfChannels: MAX_TRACKS,
    });

    this.tracks = [];
    for (let i = 0; i < MAX_TRACKS; i++) {
      this.loopAudioBuffer.getChannelData(i).fill(0);
    }

    const bufSource = this.ctx.createBufferSource();
    bufSource.channelCount = MAX_TRACKS;
    bufSource.buffer = this.loopAudioBuffer;
    bufSource.loop = true;
    connectMultiChannelToSpeaker(this.ctx, bufSource);
    bufSource.start();

    this.micStreamDestination = this.ctx.createMediaStreamDestination();
    const microphone = this.ctx.createMediaStreamSource(userMedia);
    microphone.connect(this.micStreamDestination);
  }

  _addTrack(...args) {
    const usedNums = this.tracks.map(track => track.channelNum);
    for (let i = 0; i < MAX_TRACKS; i++) {
      if (!usedNums.includes(i)) {
        const track = new Track(i, ...args);
        this.tracks.push(track);
        return track;
      }
    }
    throw new Error(`more than ${MAX_TRACKS} tracks`)
  }

  addSampleShit() {
    const track = this._addTrack("Sample shit");
    const targetArray = this.loopAudioBuffer.getChannelData(track.channelNum);
    const notes = [0, 2, 4, 5, 7, 9, 11, 12];
    for (let i = 0; i < targetArray.length; i++) {
      const note = notes[Math.floor(i / (0.25*SAMPLE_RATE))]
      targetArray[i] = 0.05*Math.sin(2*Math.PI*110*Math.pow(2, note/12)*i/SAMPLE_RATE);
    }
  }

  startRecording() {
    const startTime = this.ctx.currentTime;
    this.mediaRecorder = new MediaRecorder(this.micStreamDestination.stream)
    const chunks = [];
    this.mediaRecorder.ondataavailable = event => chunks.push(event.data);
    this.mediaRecorder.onstop = async () => {
      const blob = new Blob(chunks, { type: 'audio/ogg; codecs=opus' });
      const arrayBuffer = await blobToArrayBuffer(blob);
      const audioBuffer = await arrayBufferToAudioBuffer(this.ctx, arrayBuffer);
      const track = this._addTrack();
      copyAndWrap(startTime, audioBuffer.getChannelData(0), this.loopAudioBuffer.getChannelData(track.channelNum));
    };
    this.mediaRecorder.start();
  }

  stopRecording() {
    this.mediaRecorder.requestData();
    this.mediaRecorder.stop();
  }
}
