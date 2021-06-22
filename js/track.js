export class Track {
  constructor(channelNum, label) {
    this.channelNum = channelNum;

    this.div = document.createElement('div');
    this.div.innerHTML = `
    <div class="trackControls">
      <input
        class="trackName"
        onclick="event.target.select()"
        onkeypress="if(event.key === 'Enter') event.target.blur();"
      ></input>
      <div class="trackVolumeContainer">
        <label for="track${channelNum}_volume">Volume:</label>
        <input
          type="range"
          class="volumeSlider"
          id="track${channelNum}_volume"
          min="0" max="1" value="0.5" step="0.01"
        >
      </div>
    </div>
    <canvas width="1" height="1"></canvas>
    <button class="deleteTrackButton" disabled>Delete</button>
    `

    this.volumeSlider = this.div.querySelector('.volumeSlider');
    this.deleteButton = this.div.querySelector('.deleteTrackButton');
    this.div.querySelector('input.trackName').value = label || `Track ${channelNum}`;
    document.getElementById('tracks').appendChild(this.div);
  }
}
