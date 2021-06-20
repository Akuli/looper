let bpm = 120;
let beatsPerLoop = 4;
let loopDuration = beatsPerLoop / (bpm/60);
let ctx = null;
let loopAudioBuffer = null;
let chanCounter = 0;

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

function sampleShit() {
  // One channel, two seconds
  const audioBuffer = ctx.createBuffer(1, ctx.sampleRate * loopDuration, ctx.sampleRate);

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
    float32array[i] = 0.05*Math.sin(2*Math.PI*110*Math.pow(2, note/12)*i/ctx.sampleRate);
  }

  return audioBuffer;
}

function connectMultiChannelToSpeaker(source) {
  const splitter = ctx.createChannelSplitter(32);
  source.connect(splitter);

  const merger = ctx.createChannelMerger(2);
  for (let chanNumber = 0; chanNumber < 32; chanNumber++) {
    // Every channel goes to left and right
    splitter.connect(merger, chanNumber, 0);
    splitter.connect(merger, chanNumber, 1);
  }
  merger.connect(ctx.destination);
}

async function main() {
  const recordButton = document.getElementById('record');
  const stopButton = document.getElementById('stop');

  const userMedia = await navigator.mediaDevices.getUserMedia({audio: true});
  ctx = new AudioContext({ sampleRate: 44100 });
  loopAudioBuffer = new AudioBuffer({ length: 2*ctx.sampleRate, sampleRate: ctx.sampleRate, numberOfChannels: 32 });
  for (let i = 0; i < 32; i++) {
    loopAudioBuffer.getChannelData(i).fill(0);
  }

  const streamDestination = ctx.createMediaStreamDestination();
  const microphone = ctx.createMediaStreamSource(userMedia);
  microphone.connect(streamDestination);

  let mediaRecorder;
  const bufSource = ctx.createBufferSource();
  bufSource.channelCount = 32;
  bufSource.buffer = loopAudioBuffer;
  bufSource.loop = true;
  connectMultiChannelToSpeaker(bufSource);
  bufSource.start();

  recordButton.addEventListener('click', () => {
    mediaRecorder = new MediaRecorder(streamDestination.stream)
    const chunks = [];
    mediaRecorder.ondataavailable = event => chunks.push(event.data);
    mediaRecorder.onstop = async () => {
      const audioBuffer = await arrayBufferToAudioBuffer(
        await blobToArrayBuffer(
          new Blob(chunks, { type: 'audio/ogg; codecs=opus' })
        )
      );
      const i = chanCounter++;
      console.log("Writing to channel " + i);
      // TODO: overlap when too long to fit
      loopAudioBuffer.getChannelData(i).set(audioBuffer.getChannelData(0), 0);
    };
    mediaRecorder.start();
  });

  stopButton.addEventListener('click', () => {
    mediaRecorder.requestData();
    mediaRecorder.stop();
  });

  document.getElementById("foo").addEventListener("click", () => {
    const i = chanCounter++;
    console.log("Sample shit goes to channel " + i);
    loopAudioBuffer.getChannelData(i).set(sampleShit().getChannelData(0), 0);
  });

  // TODO: ctx.currentTime for layer placement
  // TODO: latency adjuster scaler adjustmenter: use ctx.baseLatency if available (experimental)
}
main()
