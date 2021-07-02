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
function connectMultiChannelToSpeaker(ctx) {
  const splitter = ctx.createChannelSplitter(MAX_TRACKS);
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

  return { gainNodes, splitter };
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

class Channel {
  constructor(audioManager, num, gainNode) {
    this._audioManager = audioManager;
    this.num = num;
    this.gainNode = gainNode;
  }

  // Always returns same thing on chromium, sometimes changes on firefox. Don't know why.
  getFloatArray() {
    return this._audioManager.loopAudioBuffer.getChannelData(this.num);
  }

  setFloatArray(floatArray) {
    const target = this.getFloatArray();
    if (target.length !== floatArray.length) {
      throw new Error("lengths don't match");
    }
    if (target !== floatArray) {
      target.set(floatArray, 0);
    }
    this._audioManager.audioDataChanged();
  }
}

export class AudioManager {
  constructor(userMedia, bpm, beatsPerLoop) {
    this._ctx = new AudioContext({ sampleRate: 44100 });
    this._recordState = null;

    this._samplesPerBeat = Math.round(this._ctx.sampleRate / (bpm/60));
    this.beatsPerLoop = beatsPerLoop

    this.loopAudioBuffer = new AudioBuffer({
      length: this._samplesPerBeat * beatsPerLoop,
      sampleRate: this._ctx.sampleRate,
      numberOfChannels: MAX_TRACKS,
    });

    const connectResult = connectMultiChannelToSpeaker(this._ctx);
    this._connectBufSourceHere = connectResult.splitter;
    this._bufSource = null;
    this.audioDataChanged();

    this.freeChannels = connectResult.gainNodes.map(
      (node, index) => new Channel(this, index, node)
    ).reverse();

    if (userMedia !== null) {
      this.micStreamDestination = this._ctx.createMediaStreamDestination();
      const microphone = this._ctx.createMediaStreamSource(userMedia);
      microphone.connect(this.micStreamDestination);
    } else {
      this.micStreamDestination = null;
    }
  }

  // Called after changing something in this.loopAudioBuffer
  audioDataChanged() {
    if (this._bufSource !== null) {
      this._bufSource.stop();
      this._bufSource.disconnect();
    }

    this._bufSource = this._ctx.createBufferSource();
    this._bufSource.channelCount = MAX_TRACKS;
    this._bufSource.buffer = this.loopAudioBuffer;
    this._bufSource.loop = true;
    this._bufSource.connect(this._connectBufSourceHere);
    this._bufSource.start(0, this._ctx.currentTime % this.loopAudioBuffer.duration);
  }

  async addMetronomeTicks(track) {
    // wav seems to be quite cross-browser, works on firefox and chromium
    const baseUrl = window.location.pathname.replace(/[^\/]*\/looper.html$/, '');
    const arrayBuffer = await downloadBinaryFileAsArrayBuffer(baseUrl + 'metronome.wav');
    const audioBuffer = await arrayBufferToAudioBuffer(this._ctx, arrayBuffer);
    const tick = audioBuffer.getChannelData(0).slice(0, this._samplesPerBeat);

    const target = track.channel.getFloatArray();
    for (let offset = 0; offset < target.length; offset += this._samplesPerBeat) {
      target.set(tick, offset);
    }
    track.channel.setFloatArray(target);
    track.redrawCanvas();
  }

  startRecording(track) {
    if (this._recordState !== null) {
      throw new Error("already recording");
    }

    const startTime = this._ctx.currentTime - 0.001*+document.getElementById('lagCompensationSlider').value;
    const copyOffset = Math.round(startTime*this.loopAudioBuffer.sampleRate);

    this._recordState = {
      track,
      mediaRecorder: new MediaRecorder(this.micStreamDestination.stream),
    };

    const chunks = [];  // contains blobs
    this._recordState.mediaRecorder.ondataavailable = async(event) => {
      console.log(event.data);
      chunks.push(event.data);

      // First time creates error in firefox
      if (chunks.length !== 1) {
        const arrayBuffer = await blobToArrayBuffer(new Blob(chunks, {type: "audio/ogg; codecs=opus"}));
        const audioBuffer = await arrayBufferToAudioBuffer(this._ctx, arrayBuffer);

        // Two reasons to update the channel here:
        //    * It gets visualized right away
        //    * You can hear it right away, useful when you record longer than one loop length
        //
        // You can't use only the latest chunk, because audio data format needs previous chunks too.
        const target = track.channel.getFloatArray();
        target.fill(0);
        new FloatArrayCopier(audioBuffer.getChannelData(0), target, copyOffset).copyAll();
        track.channel.setFloatArray(target);
        track.redrawCanvas();
      }
    };

    // Occationally flush audio to chunks array (and to the channel)
    const flushInterval = window.setInterval(() => {
      // Null check needed on firefox, not necessary on chromium
      if (this._recordState !== null) {
        this._recordState.mediaRecorder.requestData();
      }
    }, 200);
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
    return (this._ctx.currentTime / this.loopAudioBuffer.duration) % 1;
  }

  getWavBlob(allTracks) {
    const n = this.loopAudioBuffer.length;
    const combinedArray = new Float32Array(n);

    for (const track of allTracks) {
      const gain = track.channel.gainNode.gain.value;
      const sourceArray = track.channel.getFloatArray();
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
      new Uint32Array([this.loopAudioBuffer.sampleRate]).buffer,
      new Uint32Array([2*this.loopAudioBuffer.sampleRate]).buffer,
      new Uint16Array([2]).buffer,
      new Uint16Array([16]).buffer,
      asciiToArrayBuffer('data'),
      new Uint16Array([2*n]).buffer,  // TODO: is this correct? usually 2*n doesn't fit in 16 bits
      audioDataInt16.buffer,
    ];
    return new Blob(chunks, { type: 'audio/wav' });
  }
}
