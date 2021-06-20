import { AudioManager } from './audioManager.js';

document.addEventListener('DOMContentLoaded', async() => {
  const userMedia = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audioManager = new AudioManager(userMedia, 120, 4);

  const recordButton = document.getElementById('record');
  const stopButton = document.getElementById('stop');
  const sampleShitButton = document.getElementById('sampleShit');

  recordButton.addEventListener('click', () => {
    audioManager.startRecording();
    recordButton.disabled = true;
    stopButton.disabled = false;
  });
  stopButton.addEventListener('click', () => {
    audioManager.stopRecording();
    recordButton.disabled = false;
    stopButton.disabled = true;
  });
  sampleShitButton.addEventListener('click', () => audioManager.addSampleShit());
});
