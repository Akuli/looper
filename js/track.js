// TODO: clean up, no need for class
class Visualizer {
  constructor(canvas, sampleCount) {
    this.canvas = canvas;
    this._canvasCtx = canvas.getContext('2d');
    this._canvasCtx.strokeStyle = '#00cc00';
    this._sampleCount = sampleCount;
    this._sampleOffset = null;
    this._gain = null;
  }

  draw(initialOffset, sampleArray, gain) {
    this._canvasCtx.clearRect(0, 0, 100000, 100000);

    this._canvasCtx.lineWidth = 1;
    this._canvasCtx.beginPath();
    this._canvasCtx.moveTo(0, this.canvas.height / 2);
    this._canvasCtx.lineTo(this.canvas.width, this.canvas.height / 2);
    this._canvasCtx.stroke();

    this._canvasCtx.lineWidth = 4;  // it can be very squeezed horizontally
    this._sampleOffset = initialOffset;

    const xMin = Math.floor((this._sampleOffset / this._sampleCount) * this.canvas.width);
    this._sampleOffset += sampleArray.length;
    const xMax = Math.floor((this._sampleOffset / this._sampleCount) * this.canvas.width);
    const chunkWidth = xMax - xMin;

    this._canvasCtx.beginPath();
    for (let x = 0; x < chunkWidth; x++) {
      const sliceStart = Math.floor(this._sampleCount * x/this.canvas.width);
      const sliceEnd = Math.floor(this._sampleCount * (x+1)/this.canvas.width);
      const samples = sampleArray.slice(sliceStart, sliceEnd);

      // rms is like average, but describes audio volume better
      // https://en.wikipedia.org/wiki/Root_mean_square
      const rms = Math.sqrt(samples.map(a => a*a).reduce((a, b) => a+b) / samples.length);
      const volume = gain*rms;

      const xCanvas = (xMin + x) % this.canvas.width;
      this._canvasCtx.moveTo(xCanvas, (1 - volume)*this.canvas.height/2);
      this._canvasCtx.lineTo(xCanvas, (1 + volume)*this.canvas.height/2);
    }
    this._canvasCtx.stroke();
  }
}

export class Track {
  constructor(channel, beatCount, label) {
    this.channel = channel;

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
    `

    this.nameInput = this.div.querySelector('input.trackName');
    this.volumeSlider = this.div.querySelector('.volumeSlider');
    this.deleteButton = this.div.querySelector('.deleteTrackButton');

    this.nameInput.value = label;

    // change triggers less often than input, only when cursor lifts up
    this.volumeSlider.addEventListener('change', () => this.redrawCanvas());  // too slow for 'input'
    this.volumeSlider.addEventListener('input', () => {
      const gain = this._getGain();
      this.channel.gainNode.gain.value = gain;
      this._updateDeleteButton();
    });
    this._updateDeleteButton();

    this.visualizer = new Visualizer(this.div.querySelector('canvas'), this.channel.floatArray.length);

    document.getElementById('tracks').appendChild(this.div);
  }

  _updateDeleteButton() {
    if (this._getGain() > 0) {
      this.deleteButton.disabled = true;
      this.deleteButton.title = "Set volume to zero first";
    } else {
      this.deleteButton.disabled = false;
      this.deleteButton.title = "";
    }
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
    this.visualizer.draw(0, this.channel.floatArray, this._getGain());
  }
}
