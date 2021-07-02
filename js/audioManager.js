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
  xhr.open('GET', fileUrl);
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
    this._ctx = new AudioContext({ sampleRate: 44100 });
    this._recordState = null;

    this._samplesPerBeat = Math.round(this._ctx.sampleRate / (bpm/60));
    this.beatsPerLoop = beatsPerLoop

    this._loopAudioBuffer = new AudioBuffer({
      length: this._samplesPerBeat * beatsPerLoop,
      sampleRate: this._ctx.sampleRate,
      numberOfChannels: MAX_TRACKS,
    });

    const bufSource = this._ctx.createBufferSource();
    bufSource.channelCount = MAX_TRACKS;
    bufSource.buffer = this._loopAudioBuffer;
    bufSource.loop = true;
    const gainNodes = connectMultiChannelToSpeaker(this._ctx, bufSource);
    bufSource.start();

    this.freeChannels = gainNodes.map((node, index) => ({
      gainNode: node,
      num: index,
      floatArray: this._loopAudioBuffer.getChannelData(index),
    })).reverse();

    if (userMedia !== null) {
      this.micStreamDestination = this._ctx.createMediaStreamDestination();
      const microphone = this._ctx.createMediaStreamSource(userMedia);
      microphone.connect(this.micStreamDestination);
    } else {
      this.micStreamDestination = null;
    }
  }

  async addMetronomeTicks(track) {
    const baseUrl = window.location.pathname.replace(/[^\/]*\/looper.html$/, '');
    const arrayBuffer = await downloadBinaryFileAsArrayBuffer(baseUrl + 'metronome.flac');
    const audioBuffer = await arrayBufferToAudioBuffer(this._ctx, arrayBuffer);
    const tick = audioBuffer.getChannelData(0).slice(0, this._samplesPerBeat);

    for (let offset = 0; offset < track.channel.floatArray.length; offset += this._samplesPerBeat) {
      track.channel.floatArray.set(tick, offset);
    }
    track.redrawCanvas();
  }

  startRecording(track) {
    if (this._recordState !== null) {
      throw new Error("already recording");
    }

    const startTime = this._ctx.currentTime - 0.001*+document.getElementById('lagCompensationSlider').value;
    const copyOffset = Math.round(startTime*this._loopAudioBuffer.sampleRate);

    this._recordState = {
      track,
      mediaRecorder: new MediaRecorder(this.micStreamDestination.stream),
    };

    const chunks = [];  // contains blobs
    this._recordState.mediaRecorder.ondataavailable = async(event) => {
      chunks.push(event.data);

      // Two reasons to update the channel here:
      //    * It gets visualized right away
      //    * You can hear it right away, useful when you record longer than one loop length
      //
      // You can't use only the latest chunk, because audio data format needs previous chunks too.
      const arrayBuffer = await blobToArrayBuffer(new Blob(chunks));
      const audioBuffer = await arrayBufferToAudioBuffer(this._ctx, arrayBuffer);
      track.channel.floatArray.fill(0);
      new FloatArrayCopier(audioBuffer.getChannelData(0), track.channel.floatArray, copyOffset).copyAll();
      track.redrawCanvas();
    };

    // Occationally flush audio to chunks array (and to the channel)
    const flushInterval = window.setInterval(() => this._recordState.mediaRecorder.requestData(), 200);
    this._recordState.mediaRecorder.onstop = () => window.clearInterval(flushInterval);

    this._recordState.mediaRecorder.start();
  }

  stopRecording() {
    const track = this._recordState.track;
    this._recordState.mediaRecorder.requestData();
    this._recordState.mediaRecorder.stop();
    this._recordState = null;
    return track;
  }

  getPlayIndicatorPosition() {
    return (this._ctx.currentTime / this._loopAudioBuffer.duration) % 1;
  }

  getWavBlob(allTracks) {
    const n = this._loopAudioBuffer.length;
    const combinedArray = new Float32Array(n);

    for (const track of allTracks) {
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
      asciiToArrayBuffer('RIFF'),
      new Uint32Array([36 + 2*n]).buffer,
      asciiToArrayBuffer('WAVEfmt '),
      new Uint32Array([16]).buffer,
      new Uint16Array([1]).buffer,
      new Uint16Array([1]).buffer,
      new Uint32Array([this._loopAudioBuffer.sampleRate]).buffer,
      new Uint32Array([2*this._loopAudioBuffer.sampleRate]).buffer,
      new Uint16Array([2]).buffer,
      new Uint16Array([16]).buffer,
      asciiToArrayBuffer('data'),
      new Uint16Array([2*n]).buffer,  // TODO: is this correct? usually 2*n doesn't fit in 16 bits
      audioDataInt16.buffer,
    ];
    return new Blob(chunks, { type: 'audio/wav' });
  }
}
