export function translate(string) {
  const fi = {
    "Delete": "Poista",
    "Metronome": "Metronomi",
    "Record": "Äänitä",
    "Recording...": "Äänitetään...",
    "Set volume to zero first": "Aseta ensin volyymi nollaan",
    "Stop recording": "Lopeta äänitys",
    "Track": "Raita",
    "Volume": "Volyymi",
    "You can't delete this track because you didn't create it": "Voit poistaa vain itse tekemiäsi raitoja",
  };
  if (document.body.parentElement.lang === "fi" && fi[string] !== undefined) {
    return fi[string];
  }
  return string;
}
