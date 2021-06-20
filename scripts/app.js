let ctx = null;

async function blobToArrayBuffer(blob) {
  // https://stackoverflow.com/a/40364457
  const fileReader = new FileReader();
  await new Promise(resolve => {
    fileReader.onloadend = resolve;
    fileReader.readAsArrayBuffer(blob);
  });
  return fileReader.result;
}

async function arrayBufferToAudioBuffer(arrayBuffer) {
  return await new Promise(resolve => ctx.decodeAudioData(arrayBuffer, resolve));
}

function createTestAudioBuffer() {
  // One channel, two seconds
  const audioBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);

  const float32array = audioBuffer.getChannelData(0);
  for (let i = 0; i < audioBuffer.length; i++) {
    let note;
    if (i % ctx.sampleRate < 0.25*ctx.sampleRate) {
      note = 7;
    } else if (i % ctx.sampleRate < 0.5*ctx.sampleRate) {
      note = 10;
    } else if (i % ctx.sampleRate < 0.75*ctx.sampleRate) {
      note = 15;
    } else {
      note = 19;
    }
    float32array[i] = Math.sin(2*Math.PI*110*Math.pow(2, note/12)*i/ctx.sampleRate);
  }

  return audioBuffer;
}

async function main() {
  const recordButton = document.getElementById('record');
  const stopButton = document.getElementById('stop');

  const userMedia = await navigator.mediaDevices.getUserMedia({audio: true});
  ctx = new AudioContext();

  const streamDestination = ctx.createMediaStreamDestination();
  const microphone = ctx.createMediaStreamSource(userMedia);
  microphone.connect(streamDestination);

  var gainNode = ctx.createGain();
  gainNode.gain.value = 1;
  gainNode.connect(ctx.destination)

  let mediaRecorder;

  recordButton.addEventListener('click', () => {
    mediaRecorder = new MediaRecorder(streamDestination.stream)
    const chunks = [];
    mediaRecorder.ondataavailable = event => chunks.push(event.data);
    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunks, { type: 'audio/ogg; codecs=opus' });
      console.log(blob);
/*      const url = URL.createObjectURL(blob);
      console.log(url);
      document.body.innerHTML += `<audio controls src="${url}"></iframe>`*/

      var bufSource = ctx.createBufferSource();
      bufSource.buffer = await arrayBufferToAudioBuffer(await blobToArrayBuffer(blob));
      bufSource.loop = true;
      bufSource.connect(gainNode);
      bufSource.start();
    };
    mediaRecorder.start();
  });

  stopButton.addEventListener('click', () => {
    mediaRecorder.requestData();
    mediaRecorder.stop();
  });
}
main()
