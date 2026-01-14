const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const transcribeBtn = document.getElementById('transcribeBtn');
const statusEl = document.getElementById('status');
const transcriptEl = document.getElementById('transcript');
const playbackEl = document.getElementById('playback');

const API_BASE = 'https://speech-to-text-homework.onrender.com/';

let mediaRecorder;
let audioChunks = [];
let audioBlob;
let activeStream;

function setStatus(message) {
  statusEl.textContent = message;
}

function setTranscript(message) {
  transcriptEl.textContent = message;
}

function resetRecorder() {
  audioChunks = [];
  audioBlob = null;
  playbackEl.removeAttribute('src');
  transcribeBtn.disabled = true;
}

async function startRecording() {
  resetRecorder();
  setTranscript('Recording in progress...');

  activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(activeStream);

  mediaRecorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) {
      audioChunks.push(event.data);
    }
  });

  mediaRecorder.addEventListener('stop', () => {
    const mimeType = mediaRecorder.mimeType || 'audio/webm';
    audioBlob = new Blob(audioChunks, { type: mimeType });
    playbackEl.src = URL.createObjectURL(audioBlob);
    transcribeBtn.disabled = false;
    setStatus('Recording ready. Click transcribe when ready.');
  });

  mediaRecorder.start();
  startBtn.disabled = true;
  stopBtn.disabled = false;
  setStatus('Recording...');
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  if (activeStream) {
    activeStream.getTracks().forEach((track) => track.stop());
  }
  startBtn.disabled = false;
  stopBtn.disabled = true;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Failed to read audio data.'));
        return;
      }
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read audio data.'));
    reader.readAsDataURL(blob);
  });
}

async function transcribeAudio() {
  if (!audioBlob) {
    setStatus('No audio to send.');
    return;
  }

  setStatus('Uploading audio...');
  transcribeBtn.disabled = true;

  try {
    const base64 = await blobToBase64(audioBlob);

    const response = await fetch(`${API_BASE}/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        audioBase64: base64,
        mimeType: audioBlob.type,
        fileName: 'recording.webm'
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Transcription failed.');
    }

    const result = await response.json();
    setTranscript(result.text || 'No transcript returned.');
    setStatus('Transcription complete.');
  } catch (err) {
    setTranscript('Transcription failed.');
    setStatus(err.message || 'Something went wrong.');
  } finally {
    transcribeBtn.disabled = false;
  }
}

startBtn.addEventListener('click', () => {
  startRecording().catch((err) => {
    setStatus('Microphone access denied.');
    console.error(err);
  });
});

stopBtn.addEventListener('click', stopRecording);
transcribeBtn.addEventListener('click', transcribeAudio);

