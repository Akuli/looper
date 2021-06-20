export class Track {
  constructor(channelNum, label) {
    this.channelNum = channelNum;

    const div = document.createElement('div');
    div.textContent = label || (`Track ${channelNum}`);
    document.getElementById('tracks').appendChild(div);
  }
}
