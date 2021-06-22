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

async function downloadBinaryFileAsArrayBuffer(fileUrl) {
  const xhr = new XMLHttpRequest();
  xhr.open("GET", fileUrl);
  xhr.responseType = 'arraybuffer';

  await new Promise(resolve => {
    xhr.onload = () => resolve();
    xhr.send();
  });
  return xhr.response;
}

// returns array of GainNodes for adjusting volume
function connectMultiChannelToSpeaker(ctx, source) {
  const splitter = ctx.createChannelSplitter(MAX_TRACKS);
  source.connect(splitter);

  const gainNodes = [];

  const merger = ctx.createChannelMerger(2);
  for (let chanNumber = 0; chanNumber < MAX_TRACKS; chanNumber++) {
    const gainNode = ctx.createGain();
    gainNodes.push(gainNode);

    // Channel goes to channel 0 of gain node
    splitter.connect(gainNode, chanNumber, 0);

    // Then it goes to both channels of merger
    gainNode.connect(merger, 0, 0);
    gainNode.connect(merger, 0, 1);
  }
  merger.connect(ctx.destination);

  return gainNodes;
}

// Handles wrapping over the end
function copyAndWrap(startTime, sourceData, destData) {
  startTime -= (+document.getElementById("lagCompensationSlider").value) / 1000;
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

function sliderToGain(sliderPosBetween0And1) {
  /*
  Our ears hear things logarithmically. To make volume slider feel natural,
  we need to compensate that with exponent function.

  Requirements:
    GainNode does nothing when slider is in middle: sliderToGain(0.5) == 1
    It can be made completely silent: sliderToGain(0) == 0

  But we still want some kinda exponential. This is the first mathematical
  hack I came up with. It seems to work fine.
  */
  const f = (x => Math.exp(x));
  return (f(sliderPosBetween0And1) - f(0)) / (f(0.5) - f(0));
}

export class AudioManager {
  constructor(userMedia, beatsPerMinute, beatsPerLoop) {
    const beatsPerSecond = beatsPerMinute / 60;
    this._samplesPerBeat = Math.round(SAMPLE_RATE / beatsPerSecond);
    this._beatsPerLoop = beatsPerLoop

    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.loopAudioBuffer = new AudioBuffer({
      length: this._samplesPerBeat * beatsPerLoop,
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
    this.gainNodes = connectMultiChannelToSpeaker(this.ctx, bufSource);
    bufSource.start();

    this.micStreamDestination = this.ctx.createMediaStreamDestination();
    const microphone = this.ctx.createMediaStreamSource(userMedia);
    microphone.connect(this.micStreamDestination);
  }

  async addMetronome() {
    const arrayBuffer = await downloadBinaryFileAsArrayBuffer('/metronome.flac');
    const audioBuffer = await arrayBufferToAudioBuffer(this.ctx, arrayBuffer);

    const track = this._addTrack("Metronome");
    const targetArray = this.loopAudioBuffer.getChannelData(track.channelNum);

    const chunkSize = this._samplesPerBeat;
    for (let beatNumber = 0; beatNumber < this._beatsPerLoop; beatNumber++) {
      targetArray.set(audioBuffer.getChannelData(0).slice(0, chunkSize), beatNumber*chunkSize);
    }
  }

  _addTrack(...args) {
    const usedNums = this.tracks.map(track => track.channelNum);
    for (let channelNum = 0; channelNum < MAX_TRACKS; channelNum++) {
      if (!usedNums.includes(channelNum)) {
        const track = new Track(channelNum, ...args);
        track.deleteButton.addEventListener('click', () => this._deleteTrack(track));
        track.volumeSlider.addEventListener('input', () => {
          const value = +track.div.querySelector('.volumeSlider').value;
          this.gainNodes[channelNum].gain.value = sliderToGain(value);
          track.deleteButton.disabled = (value > 0);
        });
        this.tracks.push(track);
        return track;
      }
    }
    throw new Error(`more than ${MAX_TRACKS} tracks`)
  }

  _deleteTrack(track) {
    this.loopAudioBuffer.getChannelData(track.channelNum).fill(0);
    const index = this.tracks.indexOf(track);
    if (index === -1) {
      throw new Error("this shouldn't happen");
    }
    this.tracks.splice(index, 1);
    track.div.remove();
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
