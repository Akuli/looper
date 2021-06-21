import { AudioManager } from './audioManager.js';

function initLagCompensation() {
  const slider = document.getElementById("lagCompensationSlider");
  const entry = document.getElementById("lagCompensationEntry");

  function saveAndSyncValue(value) {
    slider.value = value;
    entry.value = value;
    window.localStorage.lagCompensation = value;
  }

  lagCompensationSlider.addEventListener('input', event => saveAndSyncValue(event.target.value));
  lagCompensationEntry.addEventListener('input', event => saveAndSyncValue(event.target.value));

  const valueOnMySystem = 130;
  saveAndSyncValue(+(window.localStorage.lagCompensation || valueOnMySystem));
}

async function initAudioManagerButtons() {
  const userMedia = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audioManager = new AudioManager(userMedia, 120, 4);
  await audioManager.addMetronome();

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
}

document.addEventListener('DOMContentLoaded', async() => {
  initLagCompensation();
  await initAudioManagerButtons();
});
