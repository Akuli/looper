import * as firestore from './firestore.js';
import { AudioManager } from './audioManager.js';
import { TrackManager } from './track.js';
import { translate } from './translate.js';


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
    console.log("getUserMedia starting");
    userMedia = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log("getUserMedia success");
  } catch (e) {
    // Can't record, but can listen to what other people recorded
    console.log(e);
  }

  const trackManager = new TrackManager(new AudioManager(userMedia, bpm, beatCount))

  recordOrStopButton.addEventListener('click', () => {
    if (recordOrStopButton.textContent === translate("Record")) {
      trackManager.startRecording();
      recordOrStopButton.textContent = translate("Stop recording");
    } else {
      // You have to click "Stop" little bit after you are done with recording.
      // Otherwise it truncates the end.
      // I tried setting 100ms timeout here but then click sound gets recorded.
      trackManager.stopRecording();
      recordOrStopButton.textContent = translate("Record");
    }
  });

  document.getElementById('wavButton').addEventListener('click', () => {
    const downloadLink = document.createElement("a");
    downloadLink.classList.add("hidden");
    document.body.appendChild(downloadLink);
    downloadLink.href = URL.createObjectURL(trackManager.getWavBlob());
    downloadLink.download = "loop.wav";
    downloadLink.click();
  });

  return {
    trackManager,
    canRecord: userMedia !== null,
  };
}

document.addEventListener('DOMContentLoaded', async() => {
  initLagCompensation();
  let firestoreInitResult;
  try {
    firestoreInitResult = await firestore.init();
  } catch(e) {
    if (e.name === "FirebaseError" && e.code === "unavailable") {
      document.body.innerHTML = `
      <h3 style="text-align: center;">No internet connection :(</h3>
      <div class="centerer">
        <button class="big" onclick="window.location.reload()">Refresh</button>
      </div>
      `;
      return;
    }
    throw e;
  }

  const { bpm, beatCount, createdNewLoop } = firestoreInitResult;
  const { canRecord, trackManager } = await initAudioManager(bpm, beatCount);
  if (createdNewLoop) {
    trackManager.addMetronome();
  }

  // Must be after all other initialization, so that user can't record before ready
  document.getElementById('wavButton').disabled = false;
  if (canRecord) {
    document.getElementById('recordOrStop').disabled = false;
  } else {
    // leave it disabled
    recordOrStopButton.title = "No microphone detected";
  }
});
