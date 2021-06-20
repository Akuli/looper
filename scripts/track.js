export class Track {
  constructor(channelNum, label) {
    this.channelNum = channelNum;

    this.div = document.createElement('div');
    this.div.innerHTML = `
    <span class="trackLabel"></span>
    <button class="deleteButton">Delete track</button>
    `
    this.div.querySelector(".trackLabel").textContent = label || (`Track ${channelNum}`);
    document.getElementById('tracks').appendChild(this.div);
  }
}
