import { AudioManager } from './audioManager.js';
import * as firestore from './firestore.js';

function initLagCompensation() {
  const slider = document.getElementById("lagCompensationSlider");
  const entry = document.getElementById("lagCompensationEntry");

  function saveAndSyncValue(value) {
    slider.value = value;
    entry.value = value;
    window.localStorage.lagCompensation = value;
  }

  const valueOnMySystem = 130;
  saveAndSyncValue(+(window.localStorage.lagCompensation || valueOnMySystem));

  // Must be after setting value, otherwise can reset to zero in some rare situations
  lagCompensationSlider.addEventListener('input', event => saveAndSyncValue(+event.target.value));
  lagCompensationEntry.addEventListener('input', event => saveAndSyncValue(+event.target.value));
}

async function initAudioManager(bpm, beatCount) {
  const recordOrStopButton = document.getElementById('recordOrStop');

  let userMedia = null;
  try {
    userMedia = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    console.log(e);
  }

  const audioManager = new AudioManager(userMedia, bpm, beatCount);
  await audioManager.addMetronome();

  recordOrStopButton.addEventListener('click', () => {
    if (recordOrStopButton.textContent === "Record") {
      audioManager.startRecording();
      recordOrStopButton.textContent = "Stop recording";
    } else {
      // You have to click "Stop" little bit after you are done with recording.
      // Otherwise it truncates the end.
      // I tried setting 100ms timeout here but then click sound gets recorded.
      audioManager.stopRecording();
      recordOrStopButton.textContent = "Record";
    }
  });

  document.getElementById('wavButton').addEventListener('click', () => {
    const downloadLink = document.createElement("a");
    downloadLink.classList.add("hidden");
    document.body.appendChild(downloadLink);
    downloadLink.href = URL.createObjectURL(audioManager.getWavBlob());
    downloadLink.download = "loop.wav";
    downloadLink.click();
  });

  return (userMedia !== null);
}

document.addEventListener('DOMContentLoaded', async() => {
  initLagCompensation();
  const { bpm, beatCount } = await firestore.init();
  const canRecord = await initAudioManager(bpm, beatCount);

  // Must be after all other initialization, so that user can't record before ready
  document.getElementById('wavButton').disabled = false;
  if (canRecord) {
    document.getElementById('recordOrStop').disabled = false;
  } else {
    // leave it disabled
    recordOrStopButton.title = "No microphone detected";
  }
});
