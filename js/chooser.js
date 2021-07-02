let tapTimes = [];  // milliseconds

function isPositiveInteger(value) {
  return isFinite(value) && value > 0 && value === Math.round(value);
}

function updateStartButton() {
  const bpm = +document.getElementById('bpmEntry').value;
  const beatCount = +document.getElementById('beatCountEntry').value;
  document.getElementById('startButton').disabled = !(isPositiveInteger(bpm) && isPositiveInteger(beatCount));
}

function handleTap(event) {
  if (tapTimes.length === 0 || event.timeStamp - tapTimes.slice(-1)[0] > 2000) {
    // It's been more than 2 seconds since the previous tap. Start over.
    tapTimes = [event.timeStamp]
    document.getElementById('bpmEntry').value = "";
  } else {
    // We have enough tap times to calculate average bpm
    tapTimes.push(event.timeStamp);
    const deltaList = tapTimes.slice(0, -1).map((time, index) => tapTimes[index+1] - time);
    const averageDelta = deltaList.reduce((x, y) => x+y) / deltaList.length;
    document.getElementById('bpmEntry').value = Math.round(60000 / averageDelta);
  }

  document.getElementById('beatCountEntry').value = tapTimes.length;
  updateStartButton();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('bpmButton').addEventListener('click', handleTap);
  document.body.addEventListener('keypress', event => {
    if (! ["input", "button"].includes(event.target.nodeName.toLowerCase())) {
      handleTap(event);
    }
  });

  for (const input of document.querySelectorAll('#inputDiv > input')) {
    input.addEventListener('input', updateStartButton);
  }

  document.getElementById('startButton').addEventListener('click', () => {
    const bpm = +document.getElementById('bpmEntry').value;
    const beatCount = +document.getElementById('beatCountEntry').value;
    window.location.href = `${window.location.origin}/looper.html#${bpm},${beatCount}`;
  });
});