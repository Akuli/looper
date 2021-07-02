import { Track } from './track.js';
import * as firestore from './firestore.js';

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

// Handles overlapping when source is longer than destination
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

function asciiToArrayBuffer(asciiString) {
  return new Uint8Array([...asciiString].map(c => c.charCodeAt(0))).buffer;
}

export class AudioManager {
  constructor(userMedia, bpm, beatsPerLoop) {
    this.ctx = new AudioContext({ sampleRate: 44100 });

    this._samplesPerBeat = Math.round(this.ctx.sampleRate / (bpm/60));
    this._beatsPerLoop = beatsPerLoop

    this.loopAudioBuffer = new AudioBuffer({
      length: this._samplesPerBeat * beatsPerLoop,
      sampleRate: this.ctx.sampleRate,
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
      num: index,
      floatArray: this.loopAudioBuffer.getChannelData(index),
    })).reverse();

    if (userMedia !== null) {
      this.micStreamDestination = this.ctx.createMediaStreamDestination();
      const microphone = this.ctx.createMediaStreamSource(userMedia);
      microphone.connect(this.micStreamDestination);
    } else {
      this.micStreamDestination = null;
    }

    this._showPlayIndicator();
  }

  async addMetronome() {
    const arrayBuffer = await downloadBinaryFileAsArrayBuffer('/metronome.flac');
    const audioBuffer = await arrayBufferToAudioBuffer(this.ctx, arrayBuffer);
    const tick = audioBuffer.getChannelData(0).slice(0, this._samplesPerBeat);

    const track = this._addTrack("Metronome");
    for (let offset = 0; offset < track.channel.floatArray.length; offset += this._samplesPerBeat) {
      track.channel.floatArray.set(tick, offset);
    }
    track.redrawCanvas();
    await firestore.addTrack(track);
  }

  _addTrack(name) {
    const channel = this.freeChannels.pop();
    if (channel === undefined) {
      throw new Error("no more free channels");
    }

    const track = new Track(channel, this._beatsPerLoop, true);
    track.nameInput.value = name;
    track.deleteButton.addEventListener('click', () => this._deleteTrack(track));
    this.tracks.push(track);
    return track;
  }

  async _deleteTrack(track) {
    const index = this.tracks.indexOf(track);
    if (index === -1) {
      throw new Error("this shouldn't happen");
    }
    this.tracks.splice(index, 1);

    track.channel.floatArray.fill(0);
    track.channel.gainNode.gain.value = 1;
    this.freeChannels.push(track.channel);

    track.div.remove();
    await firestore.deleteTrack(track);
  }

  startRecording() {
    const track = this._addTrack("Recording...");
    track.div.classList.add("recording");

    const startTime = this.ctx.currentTime - 0.001*+document.getElementById("lagCompensationSlider").value;
    const copyOffset = Math.round(startTime*this.loopAudioBuffer.sampleRate);

    this.mediaRecorder = new MediaRecorder(this.micStreamDestination.stream);

    const chunks = [];  // contains blobs
    this.mediaRecorder.ondataavailable = async(event) => {
      chunks.push(event.data);

      // Two reasons to update the channel here:
      //    * It gets visualized right away
      //    * You can hear it right away, useful when you record longer than one loop length
      //
      // You can't use only the latest chunk, because audio data format needs previous chunks too.
      const arrayBuffer = await blobToArrayBuffer(new Blob(chunks));
      const audioBuffer = await arrayBufferToAudioBuffer(this.ctx, arrayBuffer);
      track.channel.floatArray.fill(0);
      new FloatArrayCopier(audioBuffer.getChannelData(0), track.channel.floatArray, copyOffset).copyAll();
      track.redrawCanvas();
    };

    // Occationally flush audio to chunks array (and to the channel)
    const flushInterval = window.setInterval(() => this.mediaRecorder.requestData(), 200);

    this.mediaRecorder.onstop = async () => {
      window.clearInterval(flushInterval);
      track.nameInput.value = `Track ${track.channel.num}`;
      track.div.classList.remove("recording");
      await firestore.addTrack(track);
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
      const canvas = this.tracks[0].canvas;  // Only x coordinates used, assume lined up

      // I also tried css variables and calc(), consumed more cpu that way
      const ratio = (this.ctx.currentTime / this.loopAudioBuffer.duration) % 1;
      indicator.style.left = `${canvas.offsetLeft + canvas.offsetWidth*ratio}px`;
      indicator.style.top = `${trackDiv.offsetTop}px`;
      indicator.style.height = `${trackDiv.offsetHeight}px`;
    }

    window.requestAnimationFrame(() => this._showPlayIndicator());
  }

  getWavBlob() {
    const n = this.loopAudioBuffer.length;
    const combinedArray = new Float32Array(n);

    for (const track of this.tracks) {
      const gain = track.channel.gainNode.gain.value;
      const sourceArray = track.channel.floatArray;
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
      new Uint32Array([this.loopAudioBuffer.sampleRate]).buffer,
      new Uint32Array([2*this.loopAudioBuffer.sampleRate]).buffer,
      new Uint16Array([2]).buffer,
      new Uint16Array([16]).buffer,
      asciiToArrayBuffer("data"),
      new Uint16Array([2*n]).buffer,
      audioDataInt16.buffer,
    ];
    return new Blob(chunks, { type: 'audio/wav' });
  }
}
