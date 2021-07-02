/*
Firebase is initialized in looper.html
Most helpful docs I found so far: https://firebase.google.com/docs/firestore/data-model
The rules I use:

  rules_version = '2';
  service cloud.firestore {
    match /databases/{database}/documents {
      match /loops/{loop} {
        allow read: if true;
        allow write: if false;
        allow create: if true;
      }
      match /loops/{loop}/tracks/{track} {
        allow read: if true;
        allow update, delete: if request.auth != null && request.auth.uid == resource.data.creator;
        allow create: if request.auth != null && request.auth.uid == request.resource.data.creator;
      }
    }
  }
*/

const firestore = firebase.firestore();
const auth = firebase.auth();
const loopsCollection = firestore.collection("/loops");
let loopDocument;

export async function init() {
  // Need to enable anonymous auth to have uids
  // https://firebase.google.com/docs/auth/web/anonymous-auth#before-you-begin
  await auth.signInAnonymously();
  console.log("Signed in, uid=" + auth.getUid());

  // Can't use query params because changing them causes a reload
  let bpm, beatCount;
  const createdNewLoop = window.location.hash.includes(",");
  if (createdNewLoop) {
    [bpm, beatCount] = window.location.hash.replace("#", "").split(",").map(val => +val);
    loopDocument = await loopsCollection.add({ bpm, beatCount });
    window.location.hash = '#' + loopDocument.id;
  } else {
    // Use existing loop
    loopDocument = await loopsCollection.doc(window.location.hash.replace("#", ""));
    // Somehow nice unpacking syntax doesn't work
    const data = (await loopDocument.get()).data()
    bpm = data.bpm;
    beatCount = data.beatCount;
  }

  return { bpm, beatCount, createdNewLoop };
}

export async function addTrack(track) {
  if (track.firestoreId !== null) {
    throw new Error("can't add track, already added?");
  }

  const trackDocument = await loopDocument.collection('tracks').add({
    name: track.nameInput.value,
    audioBlob: firebase.firestore.Blob.fromUint8Array(new Uint8Array(track.channel.floatArray.buffer)),
    createTime: track.createTime,
    creator: auth.getUid(),
  });
  track.firestoreId = trackDocument.id;
  console.log("Added track: " + trackDocument.id);
}

export async function onNameChanged(track, name) {
  if (track.firestoreId === null) {
    throw new Error("omg");
  }
  await loopDocument.collection('tracks').doc(track.firestoreId).update({ name });
  console.log(`${track.firestoreId} is now known as ${name}`);
}

export async function deleteTrack(track) {
  if (track.firestoreId === null) {
    throw new Error("can't delete track without knowing id");
  }
  await loopDocument.collection('tracks').doc(track.firestoreId).delete()
  console.log(`Deleted ${track.firestoreId}`);
}

export function addTracksChangedCallback(changeCallback) {
  loopDocument.collection('tracks').onSnapshot(snapshot => {
    // This attempts to check whether the change event was created by current browser tab or not
    // https://firebase.google.com/docs/firestore/query-data/listen#events-local-changes
    if (!snapshot.hasPendingWrites) {
      console.log("Received change events");
      changeCallback(snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          floatArray: new Float32Array(data.audioBlob.toUint8Array().buffer),
          name: data.name,
          createTime: data.createTime,
          createdByCurrentUser: data.creator === auth.getUid(),
        };
      }));
    }
  });
}
