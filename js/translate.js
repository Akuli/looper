export function translate(string) {
  const fi = {
    "Delete": "Poista",
    "Firefox is not supported": "Firefoxia ei tueta",
    "Looper doesn't support Firefox yet. See issue #2.": "Luupperi ei vielä tue Firefoxia. Katso GitHub-issue #2.",
    "Metronome": "Metronomi",
    "No internet connection": "Nettiyhteyttä ei ole",
    "Record": "Äänitä",
    "Recording...": "Äänitetään...",
    "Refresh": "Päivitä",
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
