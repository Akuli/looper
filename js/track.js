import * as firestore from './firestore.js';


export class Track {
  constructor(channel, beatCount, createdByCurrentUser) {
    this.channel = channel;
    this.createdByCurrentUser = createdByCurrentUser;
    this.firestoreId = null;

    // Metronome looks a lot better if width is multiple of beatCount
    const canvasWidth = Math.ceil(1000 / beatCount) * beatCount;
    const canvasHeight = 60;

    this.div = document.createElement('div');
    this.div.classList.add("track");
    this.div.innerHTML = `
    <div class="trackControls">
      <input
        class="trackName"
        onclick="event.target.select()"
        onkeypress="if(event.key === 'Enter') event.target.blur();"
      ></input>
      <div class="trackVolumeContainer">
        <label for="track${channel.num}_volume">Volume:</label>
        <input
          type="range"
          class="volumeSlider"
          id="track${channel.num}_volume"
          min="0" max="1" value="0.5" step="0.01"
        >
      </div>
    </div>
    <canvas width="${canvasWidth}" height="${canvasHeight}" style="height: ${canvasHeight}px;"></canvas>
    <button class="deleteTrackButton">Delete</button>
    `;

    this.nameInput = this.div.querySelector('input.trackName');
    this.volumeSlider = this.div.querySelector('.volumeSlider');
    this.deleteButton = this.div.querySelector('.deleteTrackButton');

    // change triggers less often than input, only when cursor lifts up
    this.volumeSlider.addEventListener('change', () => this.redrawCanvas());  // too slow for 'input'
    this.volumeSlider.addEventListener('input', () => {
      const gain = this._getGain();
      this.channel.gainNode.gain.value = gain;
      this._updateDeleteButton();
    });
    this._updateDeleteButton();

    this.canvas = this.div.querySelector('canvas');
    this._canvasCtx = this.canvas.getContext('2d');
    this._canvasCtx.strokeStyle = '#00cc00';

    document.getElementById('tracks').appendChild(this.div);
  }

  _updateDeleteButton() {
    if (!this.createdByCurrentUser) {
      this.deleteButton.title = "You can't delete this track because you didn't create it";
    } else if (this._getGain() > 0) {
      this.deleteButton.title = "Set volume to zero first";
    } else {
      this.deleteButton.title = "";
    }

    this.deleteButton.disabled = !!this.deleteButton.title;
  }

  _getGain() {
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
    return (f(+this.volumeSlider.value) - f(0)) / (f(0.5) - f(0));
  }

  // It's also fine to access visualizer directly outside this class
  redrawCanvas() {
    this._canvasCtx.clearRect(0, 0, 100000, 100000);

    this._canvasCtx.lineWidth = 1;
    this._canvasCtx.beginPath();
    this._canvasCtx.moveTo(0, this.canvas.height / 2);
    this._canvasCtx.lineTo(this.canvas.width, this.canvas.height / 2);
    this._canvasCtx.stroke();

    this._canvasCtx.lineWidth = 4;  // it can be very squeezed horizontally

    const gain = this._getGain();
    const allSamples = this.channel.floatArray;

    this._canvasCtx.beginPath();
    for (let x = 0; x < this.canvas.width; x++) {
      const sliceStart = Math.floor(allSamples.length * x/this.canvas.width);
      const sliceEnd = Math.floor(allSamples.length * (x+1)/this.canvas.width);
      const relevantSamples = allSamples.slice(sliceStart, sliceEnd);

      // rms is like average, but describes audio volume better
      // https://en.wikipedia.org/wiki/Root_mean_square
      const rms = Math.sqrt(relevantSamples.map(a => a*a).reduce((a, b) => a+b) / relevantSamples.length);
      const volume = gain*rms;

      this._canvasCtx.moveTo(x, (1 - volume)*this.canvas.height/2);
      this._canvasCtx.lineTo(x, (1 + volume)*this.canvas.height/2);
    }
    this._canvasCtx.stroke();
  }
}


export class TrackManager {
  constructor(audioManager) {
    this.audioManager = audioManager;
    this.tracks = [];
    firestore.addTracksChangedCallback(trackInfos => {
      for (const info of trackInfos) {
        // When recording stops, this runs with a track that has no firestore id yet
        let track = this.tracks.find(track => track.firestoreId === null || track.firestoreId === info.id);
        if (track === undefined) {
          // New track in firestore
          track = this._addTrack(info.name, info.createdByCurrentUser);
          track.firestoreId = info.id;
          if (track.channel.floatArray.length !== info.floatArray.length) {
            throw new Error("lengths don't match");
          }
          track.channel.floatArray.set(info.floatArray, 0);
          track.redrawCanvas();
        } else {
          track.nameInput.value = info.name;
        }
      }
    });
    this._showPlayIndicator();
  }

  _addTrack(name, createdByCurrentUser) {
    const channel = this.audioManager.freeChannels.pop();
    if (channel === undefined) {
      throw new Error("no more free channels");
    }

    const track = new Track(channel, this.audioManager.beatsPerLoop, createdByCurrentUser);
    track.nameInput.value = name;
    track.nameInput.addEventListener('blur', () => firestore.onNameChanged(track, track.nameInput.value));
    track.deleteButton.addEventListener('click', () => this.deleteTrack(track));
    this.tracks.push(track);
    return track;
  }

  async deleteTrack(track) {
    const index = this.tracks.indexOf(track);
    if (index === -1) {
      throw new Error("this shouldn't happen");
    }
    this.tracks.splice(index, 1);

    track.channel.floatArray.fill(0);
    track.channel.gainNode.gain.value = 1;
    this.audioManager.freeChannels.push(track.channel);

    track.div.remove();
    await firestore.deleteTrack(track);
  }

  startRecording() {
    const track = this._addTrack("Recording...", true);
    track.div.classList.add("recording");
    this.audioManager.startRecording(track);
  }

  async stopRecording() {
    const track = this.audioManager.stopRecording();
    track.nameInput.value = `Track ${track.channel.num}`;
    track.div.classList.remove("recording");
    await firestore.addTrack(track);
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
      const ratio = this.audioManager.getPlayIndicatorPosition();
      indicator.style.left = `${canvas.offsetLeft + canvas.offsetWidth*ratio}px`;
      indicator.style.top = `${trackDiv.offsetTop}px`;
      indicator.style.height = `${trackDiv.offsetHeight}px`;
    }

    window.requestAnimationFrame(() => this._showPlayIndicator());
  }

  async addMetronome() {
    const track = this._addTrack("Metronome", true);
    await this.audioManager.addMetronomeTicks(track);
    await firestore.addTrack(track);
  }

  getWavBlob() {
    return this.audioManager.getWavBlob(this.tracks);
  }
}
