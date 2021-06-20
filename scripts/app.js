import { AudioManager } from './audioManager.js';

document.addEventListener('DOMContentLoaded', async() => {
  const userMedia = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audioManager = new AudioManager(userMedia, 120, 4);

  document.getElementById('record').addEventListener('click', () => audioManager.startRecording());
  document.getElementById('stop').addEventListener('click', () => audioManager.stopRecording());
  document.getElementById('sampleShit').addEventListener('click', () => audioManager.addSampleShit());
});
