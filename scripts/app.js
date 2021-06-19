async function main() {
  const record = document.getElementById('record');
  const stop = document.getElementById('stop');
  stop.disabled = true;

  userMedia = await navigator.mediaDevices.getUserMedia({audio: true});

  /*
  const mediaRecorder = new MediaRecorder(userMedia);
  const looperState = {
    chunks: [],
    blob: null,
  };

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
    document.body.appendChild(looperState.audio);

    looperState.blob = new Blob(looperState.chunks, { type: 'audio/ogg; codecs=opus' });
    looperState.audio.src = window.URL.createObjectURL(looperState.blob);
    looperState.audio.loop = true;
    looperState.audio.play();
  }

  mediaRecorder.ondataavailable = (e => looperState.chunks.push(e.data));
  */

  const ctx = new AudioContext();
  const microphone = ctx.createMediaStreamSource(userMedia);
  microphone.connect(ctx.destination);

  const oscillator = ctx.createOscillator();
  oscillator.frequency.setValueAtTime(110*Math.pow(2,2/12), ctx.currentTime);

  var gainNode = ctx.createGain();
  gainNode.gain.value = 0.01;

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination)
  oscillator.start();

  // TODO https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode

  // One channel, two seconds
  const audioBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  console.log(audioBuffer);

  const float32array = audioBuffer.getChannelData(0);
  for (let i = 0; i < audioBuffer.length; i++) {
    let note;
    if (i % ctx.sampleRate < 0.25*ctx.sampleRate) {
      note = 6;
    } else if (i % ctx.sampleRate < 0.5*ctx.sampleRate) {
      note = 9;
    } else if (i % ctx.sampleRate < 0.75*ctx.sampleRate) {
      note = 14;
    } else {
      note = 18;
    }
    float32array[i] = Math.sin(2*Math.PI*110*Math.pow(2, note/12)*i/ctx.sampleRate);
  }

  var bufSource = ctx.createBufferSource();
  bufSource.buffer = audioBuffer;
  bufSource.loop = true;
  bufSource.connect(gainNode);
  bufSource.start();
}
main()
