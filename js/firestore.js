// Initialized in looper.html

// Most helpful docs I found so far: https://firebase.google.com/docs/firestore/data-model
const firestore = firebase.firestore();
const auth = firebase.auth();
const loopsCollection = firestore.collection("/loops");
let loopDocument;

export async function init() {
  // Needs anonymous auth enabled
  // https://firebase.google.com/docs/auth/web/anonymous-auth#before-you-begin
  await auth.signInAnonymously();

  // Can't use query params because changing them causes a reload
  if (window.location.hash.includes(",")) {
    // Create new loop
    const [bpm, beatCount] = window.location.hash.replace("#", "").split(",").map(val => +val);
    loopDocument = await loopsCollection.add({ bpm, beatCount });
    window.location.hash = '#' + loopDocument.id;
  } else {
    // Use existing loop
    loopDocument = await loopsCollection.doc(window.location.hash.replace("#", ""));
  }

  // Has bpm and beatCount attributes
  return (await loopDocument.get()).data();
}

// TODO: take audio from track.channel instead of separate arg
export async function addTrack(track) {
  if (track.firestoreId !== null) {
    throw new Error("can't add track to db, already added?");
  }

  const trackDocument = await loopDocument.collection('tracks').add({
    name: track.nameInput.value,
    audioBlob: firebase.firestore.Blob.fromUint8Array(new Uint8Array(track.channel.floatArray.buffer)),
    creator: auth.getUid(),
  });
  console.log("Added track: " + trackDocument.id);

  track.nameInput.addEventListener('input', () => trackDocument.update({ name: track.nameInput.value }));
  track.firestoreId = trackDocument.id;
}

export async function deleteTrack(track) {
  await loopDocument.collection('tracks').doc(track.firestoreId).delete()
}
