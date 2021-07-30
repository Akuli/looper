/*
Firebase is initialized in looper.html
Most helpful docs I found so far: https://firebase.google.com/docs/firestore/data-model
The rules I use:

  rules_version = '2';
  service cloud.firestore {
    match /databases/{database}/documents {
      match /loops/{loop} {
        allow read: if request.auth != null;
        allow write: if false;
        allow create: if request.auth != null;
      }
      match /loops/{loop}/tracks/{track} {
        allow read: if request.auth != null;
        allow update, delete: if request.auth != null && request.auth.uid == resource.data.creator;
        allow create: if request.auth != null && request.auth.uid == request.resource.data.creator;
      }
      match /blobs/{blob} {
        allow read: if request.auth != null;
        allow write: if false;
        allow create: if request.auth != null && request.auth.uid == request.resource.data.creator;
      }
    }
  }
*/

firebase.initializeApp({
  apiKey: "AIzaSyC9NZ0cMPeQnQXYC9yfUz4YYs-5cRqs9bM",
  authDomain: "looper-6b9c2.firebaseapp.com",
  projectId: "looper-6b9c2",
  storageBucket: "looper-6b9c2.appspot.com",
  messagingSenderId: "571407035019",
  appId: "1:571407035019:web:8e2f0f83db9a074874428e"
});

const firestore = firebase.firestore();
const auth = firebase.auth();
const blobsCollection = firestore.collection('/blobs');
const loopsCollection = firestore.collection('/loops');
let loopDocument;

export async function init() {
  // Need to enable anonymous auth to have uids
  // https://firebase.google.com/docs/auth/web/anonymous-auth#before-you-begin
  await auth.signInAnonymously();
  console.log("Signed in, uid=" + auth.getUid());

  // Can't use query params because changing them causes a reload
  let bpm, beatCount;
  const createdNewLoop = window.location.hash.includes(',');
  if (createdNewLoop) {
    [bpm, beatCount] = window.location.hash.replace('#', '').split(',').map(val => +val);
    loopDocument = await loopsCollection.add({ bpm, beatCount });
    window.location.hash = '#' + loopDocument.id;
  } else {
    // Use existing loop
    loopDocument = await loopsCollection.doc(window.location.hash.replace('#', ''));
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

  console.log(`Adding track (${track.channel.floatArray.buffer.byteLength} bytes)`);

  // Firestore documents are limited to 1MB, sounds can easily be 3MB
  const chunkSize = 999000;
  const uintArray = new Uint8Array(track.channel.floatArray.buffer);

  const blobIds = [];
  for (let i = 0; i*chunkSize < uintArray.length; i++) {
    console.log(`Uploading blob ${i}`);
    const blobDocument = await blobsCollection.add({
      blob: firebase.firestore.Blob.fromUint8Array(uintArray.slice(i*chunkSize, (i+1)*chunkSize)),
      creator: auth.getUid(),
    });
    blobIds.push(blobDocument.id);
  }

  const value = {
    name: track.nameInput.value,
    blobIds: blobIds.join("|"),  // nested values are apparently harder to validate in firestore
    createTime: track.createTime,
    creator: auth.getUid(),
  };
  const trackDocument = await loopDocument.collection('tracks').add(value);
  track.firestoreId = trackDocument.id;
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

async function getAudioDataFromFirestore(data) {
  if (data.blobIds === undefined) {
    // legacy loop
    return data.audioBlob.toUint8Array();
  }

  const blobDocuments = await Promise.all(data.blobIds.split("|").map(id => blobsCollection.doc(id).get()));
  const blobObjects = blobDocuments.map(doc => doc.data());
  if (!blobObjects.every(b => b.creator === data.creator)) {
    throw new Error("creator mismatch");
  }
  const arrayChunks = blobObjects.map(blob => blob.blob.toUint8Array());

  const result = new Uint8Array(arrayChunks.map(arr => arr.length).reduce((a,b) => a+b));
  let start = 0;
  for (const arr of arrayChunks) {
    result.set(arr, start);
    start += arr.length;
  }
  return result;
}

export function addTracksChangedCallback(changeCallback) {
  const queue = [];
  loopDocument.collection('tracks').onSnapshot(snapshot => {
    // This attempts to check whether the change event was created by current browser tab or not
    // https://firebase.google.com/docs/firestore/query-data/listen#events-local-changes
    if (!snapshot.hasPendingWrites) {
      queue.push(snapshot);
    }
  });

  // TODO: is it fine to have async callback for onSnapshot?
  async function poller() {
    while(true) {
      if (queue.length === 0) {
        await new Promise(resolve => window.setTimeout(resolve, 50));
        continue;
      }

      console.log("Received change event");
      const snapshot = queue.shift();
      const cleanDocs = await Promise.all(snapshot.docs.map(async doc => {
        const data = doc.data();
        return {
          id: doc.id,
          floatArray: new Float32Array((await getAudioDataFromFirestore(data)).buffer),
          name: data.name,
          createTime: data.createTime,
          createdByCurrentUser: data.creator === auth.getUid(),
        };
      }));

      changeCallback(cleanDocs);
    }
  }

  poller();
}
