looperState = {
  chunks: [],
  blob: null,
};

async function main() {
  const record = document.querySelector('.record');
  const stop = document.querySelector('.stop');
  const soundClips = document.querySelector('.sound-clips');
  const mainSection = document.querySelector('.main-controls');
  stop.disabled = true;

  userMedia = await navigator.mediaDevices.getUserMedia({audio: true});

  const mediaRecorder = new MediaRecorder(userMedia);

  record.onclick = function() {
    mediaRecorder.start();
    stop.disabled = false;
    record.disabled = true;
  }

  stop.onclick = function() {
    mediaRecorder.stop();
    stop.disabled = true;
    record.disabled = false;
  }

  mediaRecorder.onstop = function(e) {
    looperState.audio = document.createElement('audio');
    soundClips.appendChild(looperState.audio);

    looperState.blob = new Blob(looperState.chunks, { type: 'audio/ogg; codecs=opus' });
    looperState.audio.src = window.URL.createObjectURL(looperState.blob);
    looperState.audio.loop = true;
    looperState.audio.play();
  }

  mediaRecorder.ondataavailable = (e => looperState.chunks.push(e.data));
}
main()
