export class Track {
  constructor(channelNum, label) {
    this.channelNum = channelNum;

    this.div = document.createElement('div');
    this.div.innerHTML = `
    <div>
      <span class="trackLabel"></span>
      <div>
        <label for="track${channelNum}_volume">Volume:</label>
        <input
          type="range"
          class="volumeSlider"
          id="track${channelNum}_volume"
          min="0" max="1" value="0.5" step="0.01"
        >
      </div>
    </div>
    <button class="deleteButton">Delete</button>
    `
    this.div.querySelector(".trackLabel").textContent = label || (`Track ${channelNum}`);
    document.getElementById('tracks').appendChild(this.div);
  }
}
