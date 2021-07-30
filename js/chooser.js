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
    document.getElementById('bpmEntry').value = '';
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
    if (event.target.nodeName.toLowerCase() === 'button') {
      // When button is focused, you should be able to click it by pressing spacebar or enter
      // Therefore "press any key" actually means "any key except space or return"
      if (event.code !== "Space" && event.code !== "Enter") {
        handleTap(event);
      }
    } else if (event.target.nodeName.toLowerCase() === 'input') {
      // Do nothing, pressing keys in text input doesn't count as "press any key"
    } else {
      handleTap(event);
    }
  });

  for (const input of document.querySelectorAll('#inputDiv > input')) {
    input.addEventListener('input', updateStartButton);
  }

  document.getElementById('startButton').addEventListener('click', () => {
    const bpm = +document.getElementById('bpmEntry').value;
    const beatCount = +document.getElementById('beatCountEntry').value;
    const rootPath = window.location.pathname.replace(/\/chooser.html$/, '');
    window.location.href = `${window.location.origin}${rootPath}/looper.html#${bpm},${beatCount}`;
  });
});
