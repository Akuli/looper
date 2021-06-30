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

class FloatArrayCopier {
  constructor(sourceData, destData, initialDestOffset) {
    this.sourceData = sourceData;
    this.destData = destData;
    this.sourceOffset = 0;
    this.destOffset = initialDestOffset % destData.length;
  }

  copyChunk(canOverlapPreviousLayers) {
    const leftInSource = this.sourceData.length - this.sourceOffset;
    const fitsInDest = this.destData.length - this.destOffset;
    const fitsInDestWithOneLayer = this.destData.length - this.sourceOffset;

    let howMuchToCopy;
    if (canOverlapPreviousLayers) {
      howMuchToCopy = Math.min(leftInSource, fitsInDest);
    } else {
      howMuchToCopy = Math.min(leftInSource, fitsInDest, fitsInDestWithOneLayer);
    }

    if (howMuchToCopy <= 0) {
      return false;
    }

    if (canOverlapPreviousLayers) {
      for (let n = 0; n < howMuchToCopy; n++) {
        this.destData[this.destOffset + n] += this.sourceData[this.sourceOffset + n];
      }
    } else {
      this.destData.set(this.sourceData.slice(this.sourceOffset, this.sourceOffset + howMuchToCopy), this.destOffset);
    }

    this.sourceOffset += howMuchToCopy;
    this.destOffset = (this.destOffset + howMuchToCopy) % this.destData.length;
    return true;
  }

  copyAll() {
    while (this.copyChunk(false)) { }   // Faster
    while (this.copyChunk(true)) { }    // Works even when source is longer than dest
  }
}

// Handles wrapping over the end
function copyAndWrap(startTime, sourceData, destData) {
  startTime -= (+document.getElementById("lagCompensationSlider").value) / 1000;
  const copier = new FloatArrayCopier(sourceData, destData, Math.round(startTime*SAMPLE_RATE));
  copier.copyAll();
}

function asciiToArrayBuffer(asciiString) {
  return new Uint8Array([...asciiString].map(c => c.charCodeAt(0))).buffer;
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

    const bufSource = this.ctx.createBufferSource();
    bufSource.channelCount = MAX_TRACKS;
    bufSource.buffer = this.loopAudioBuffer;
    bufSource.loop = true;
    const gainNodes = connectMultiChannelToSpeaker(this.ctx, bufSource);
    bufSource.start();

    this.tracks = [];
    this.freeChannels = gainNodes.map((node, index) => ({
      gainNode: node,
      num: index,  // TODO: still needed?
      floatArray: this.loopAudioBuffer.getChannelData(index),
    })).reverse();

    this.micStreamDestination = this.ctx.createMediaStreamDestination();
    const microphone = this.ctx.createMediaStreamSource(userMedia);
    microphone.connect(this.micStreamDestination);
    this._showPlayIndicator();
  }

  async addMetronome() {
    const arrayBuffer = await downloadBinaryFileAsArrayBuffer('/metronome.flac');
    const audioBuffer = await arrayBufferToAudioBuffer(this.ctx, arrayBuffer);
    const track = this._addTrack("Metronome");

    const chunkSize = this._samplesPerBeat;
    for (let beatNumber = 0; beatNumber < this._beatsPerLoop; beatNumber++) {
      track.channel.floatArray.set(audioBuffer.getChannelData(0).slice(0, chunkSize), beatNumber*chunkSize);
    }
    track.redrawCanvas();
  }

  _addTrack(...args) {
    const channel = this.freeChannels.pop();
    if (channel === undefined) {
      throw new Error("no more free channels");
    }

    const track = new Track(channel, this._beatsPerLoop, ...args);
    track.deleteButton.addEventListener('click', () => this._deleteTrack(track));
    this.tracks.push(track);
    return track;
  }

  _deleteTrack(track) {
    const index = this.tracks.indexOf(track);
    if (index === -1) {
      throw new Error("this shouldn't happen");
    }
    this.tracks.splice(index, 1);

    track.channel.floatArray.fill(0);
    track.channel.gainNode.gain.value = 1;
    this.freeChannels.push(track.channel);

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
      copyAndWrap(startTime, audioBuffer.getChannelData(0), track.channel.floatArray);
      track.redrawCanvas();
    };
    this.mediaRecorder.start();
  }

  stopRecording() {
    this.mediaRecorder.requestData();
    this.mediaRecorder.stop();
  }

  _showPlayIndicator() {
    const indicator = document.getElementById('playIndicator');
    if (this.tracks.length === 0) {
      indicator.classList.add("hidden");
    } else {
      indicator.classList.remove("hidden");

      const trackDiv = document.getElementById('tracks');
      const canvas = this.tracks[0].canvas;

      // I also tried css variables and calc(), consumed more cpu that way
      const ratio = (this.ctx.currentTime / this.loopAudioBuffer.duration) % 1;
      indicator.style.left = `${canvas.offsetLeft + canvas.offsetWidth*ratio}px`;
      indicator.style.top = `${trackDiv.offsetTop}px`;
      indicator.style.height = `${trackDiv.offsetHeight}px`;
    }

    window.requestAnimationFrame(() => this._showPlayIndicator());
  }

  getWavBlob() {
    const n = this.loopAudioBuffer.length
    const combinedArray = new Float32Array(n);

    for (const track of this.tracks) {
      const gain = track.channel.gainNode.gain.value;
      const sourceArray = track.channel.floatArray;
      console.log(gain);
      for (let i = 0; i < n; i++) {
        combinedArray[i] += gain*sourceArray[i];
      }
    }

    const audioDataInt16 = new Int16Array(combinedArray.map(value => {
      if (value > 1) {
        value = 1;
      }
      if (value < -1) {
        value = -1;
      }
      return Math.round(0x7fff * value);
    }));

    // Based on source code of Python's wave module
    const chunks = [
      asciiToArrayBuffer("RIFF"),
      new Uint32Array([36 + 2*n]).buffer,
      asciiToArrayBuffer("WAVEfmt "),
      new Uint32Array([16]).buffer,
      new Uint16Array([1]).buffer,
      new Uint16Array([1]).buffer,
      new Uint32Array([SAMPLE_RATE]).buffer,
      new Uint32Array([2*SAMPLE_RATE]).buffer,
      new Uint16Array([2]).buffer,
      new Uint16Array([16]).buffer,
      asciiToArrayBuffer("data"),
      new Uint16Array([2*n]).buffer,
      audioDataInt16.buffer,
    ];
    return new Blob(chunks, { type: 'audio/wav' });
  }
}
