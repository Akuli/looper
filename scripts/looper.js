import { AudioManager } from './audioManager.js';

function initLagCompensation() {
  const slider = document.getElementById("lagCompensationSlider");
  const entry = document.getElementById("lagCompensationEntry");

  function saveAndSyncValue(value) {
    slider.value = value;
    entry.value = value;
    window.localStorage.lagCompensation = value;
  }

  lagCompensationSlider.addEventListener('input', event => saveAndSyncValue(+event.target.value));
  lagCompensationEntry.addEventListener('input', event => saveAndSyncValue(+event.target.value));

  const valueOnMySystem = 130;
  saveAndSyncValue(+(window.localStorage.lagCompensation || valueOnMySystem));
}

async function initAudioManagerButtons() {
  const urlParams = new URLSearchParams(window.location.search);

  const userMedia = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audioManager = new AudioManager(userMedia, +urlParams.get("bpm"), +urlParams.get("beatCount"));
  await audioManager.addMetronome();

  const recordButton = document.getElementById('record');
  const stopButton = document.getElementById('stop');

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
}

document.addEventListener('DOMContentLoaded', async() => {
  initLagCompensation();
  await initAudioManagerButtons();
});
