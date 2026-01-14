const http = require('http');

const https = require('https');

const crypto = require('crypto');

const fs = require('fs');

const path = require('path');

const { URL } = require('url');



const PORT = process.env.PORT || 3000;

const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

const ENV_PATH = path.join(__dirname, '.env');



loadEnv(ENV_PATH);



const API_KEY = process.env.GOOGLE_API_KEY || process.env.OPENAI_API_KEY;



const MIME_TYPES = {

  '.html': 'text/html; charset=utf-8',

  '.css': 'text/css; charset=utf-8',

  '.js': 'text/javascript; charset=utf-8',

  '.json': 'application/json; charset=utf-8',

  '.png': 'image/png',

  '.jpg': 'image/jpeg',

  '.jpeg': 'image/jpeg',

  '.svg': 'image/svg+xml'

};



function loadEnv(filePath) {

  if (!fs.existsSync(filePath)) {

    return;

  }



  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);

  for (const line of lines) {

    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {

      continue;

    }



    const equalsIndex = trimmed.indexOf('=');

    if (equalsIndex === -1) {

      continue;

    }



    const key = trimmed.slice(0, equalsIndex).trim();

    let value = trimmed.slice(equalsIndex + 1).trim();



    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {

      value = value.slice(1, -1);

    }



    if (!process.env[key]) {

      process.env[key] = value;

    }

  }

}



function sendJson(res, statusCode, payload) {

  const body = JSON.stringify(payload);

  res.writeHead(statusCode, {

    'Content-Type': 'application/json; charset=utf-8',

    'Content-Length': Buffer.byteLength(body)

  });

  res.end(body);

}



function sendText(res, statusCode, text) {

  res.writeHead(statusCode, {

    'Content-Type': 'text/plain; charset=utf-8',

    'Content-Length': Buffer.byteLength(text)

  });

  res.end(text);

}



function getExtensionFromMime(mimeType) {

  if (!mimeType) {

    return 'webm';

  }

  if (mimeType.includes('webm')) return 'webm';

  if (mimeType.includes('wav')) return 'wav';

  if (mimeType.includes('mpeg')) return 'mp3';

  if (mimeType.includes('mp4')) return 'm4a';

  return 'webm';

}



function readJsonBody(req, maxBytes = 25 * 1024 * 1024) {

  return new Promise((resolve, reject) => {

    let data = '';



    req.on('data', (chunk) => {

      data += chunk;

      if (data.length > maxBytes) {

        reject(new Error('Payload too large'));

        req.destroy();

      }

    });



    req.on('end', () => {

      if (!data) {

        resolve({});

        return;

      }

      try {

        resolve(JSON.parse(data));

      } catch (err) {

        reject(new Error('Invalid JSON'));

      }

    });



    req.on('error', reject);

  });

}



function serveStatic(req, res, pathname) {

  let filePath = pathname === '/' ? '/index.html' : pathname;

  filePath = decodeURIComponent(filePath);



  const resolvedPath = path.normalize(path.join(FRONTEND_DIR, filePath));

  if (!resolvedPath.startsWith(FRONTEND_DIR)) {

    sendText(res, 403, 'Forbidden');

    return;

  }



  if (!fs.existsSync(resolvedPath) || fs.statSync(resolvedPath).isDirectory()) {

    sendText(res, 404, 'Not Found');

    return;

  }



  const ext = path.extname(resolvedPath).toLowerCase();

  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  const buffer = fs.readFileSync(resolvedPath);



  res.writeHead(200, {

    'Content-Type': contentType,

    'Content-Length': buffer.length

  });

  res.end(buffer);

}



async function handleTranscribe(req, res) {

  if (!API_KEY) {

    sendJson(res, 500, { error: 'GOOGLE_API_KEY is missing in backend/.env.' });

    return;

  }



  let body;

  try {

    body = await readJsonBody(req);

  } catch (err) {

    sendJson(res, 400, { error: err.message });

    return;

  }



  const audioBase64 = body.audioBase64;

  const mimeType = body.mimeType || 'audio/webm';

  const fileName = body.fileName || `recording.${getExtensionFromMime(mimeType)}`;



  if (!audioBase64) {

    sendJson(res, 400, { error: 'audioBase64 is required.' });

    return;

  }



  const buffer = Buffer.from(audioBase64, 'base64');
  const payload = buildGeminiPayload(buffer, mimeType);

  let result;
  try {
    result = await postToGemini(payload);
  } catch (err) {
    sendJson(res, 502, { error: err.message || 'Transcription failed.' });
    return;
  }

  const textOut =
    result && result.candidates && result.candidates[0] && result.candidates[0].content
      ? result.candidates[0].content.parts.map((part) => part.text || '').join('')
      : '';

  sendJson(res, 200, { text: textOut || '' });



}





function buildMultipartFormData(boundary, fileBuffer, { fileName, mimeType, fields }) {

  const chunks = [];

  const pushText = (text) => chunks.push(Buffer.from(text, 'utf8'));

  const dashBoundary = `--${boundary}`;



  for (const [key, value] of Object.entries(fields || {})) {

    pushText(`${dashBoundary}



`);

    pushText(`Content-Disposition: form-data; name="${key}"







`);

    pushText(`${value}



`);

  }



  pushText(`${dashBoundary}



`);

  pushText(

    `Content-Disposition: form-data; name="file"; filename="${fileName}"



Content-Type: ${mimeType}







`

  );

  chunks.push(fileBuffer);

  pushText(`



${dashBoundary}--



`);



  return Buffer.concat(chunks);

}



function postToOpenAi(boundary, bodyBuffer) {

  return new Promise((resolve, reject) => {

    const req = https.request(

      {

        method: 'POST',

        host: 'api.openai.com',

        path: '/v1/audio/transcriptions',

        headers: {

          Authorization: `Bearer ${API_KEY}`,

          'Content-Type': `multipart/form-data; boundary=${boundary}`,

          'Content-Length': bodyBuffer.length

        }

      },

      (res) => {

        let data = '';

        res.setEncoding('utf8');

        res.on('data', (chunk) => {

          data += chunk;

        });

        res.on('end', () => {

          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {

            reject(new Error(data || 'Transcription failed.'));

            return;

          }

          try {

            resolve(JSON.parse(data));

          } catch (err) {

            reject(new Error('Invalid response from transcription service.'));

          }

        });

      }

    );



    req.on('error', (err) => reject(err));

    req.write(bodyBuffer);

    req.end();

  });

}






function buildGeminiPayload(buffer, mimeType) {
  return {
    contents: [
      {
        role: 'user',
        parts: [
          { text: 'Transcribe the following audio.' },
          {
            inline_data: {
              mime_type: mimeType,
              data: buffer.toString('base64')
            }
          }
        ]
      }
    ]
  };
}

function postToGemini(payload) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = https.request(
      {
        method: 'POST',
        host: 'generativelanguage.googleapis.com',
        path: `/v1/models/gemini-2.0-flash:generateContent?key=${API_KEY}`,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': body.length
        }
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(data || 'Transcription failed.'));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error('Invalid response from transcription service.'));
          }
        });
      }
    );

    req.on('error', (err) => reject(err));
    req.write(body);
    req.end();
  });
}

const server = http.createServer((req, res) => {

  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);



  res.setHeader('Access-Control-Allow-Origin', '*');

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');



  if (req.method === 'OPTIONS') {

    res.writeHead(204);

    res.end();

    return;

  }



  if (req.method === 'POST' && parsedUrl.pathname === '/transcribe') {

    handleTranscribe(req, res).catch((err) => {

      console.error(err);

      sendJson(res, 500, { error: 'Server error.' });

    });

    return;

  }



  if (req.method !== 'GET') {

    sendText(res, 405, 'Method Not Allowed');

    return;

  }



  serveStatic(req, res, parsedUrl.pathname);

});



server.listen(PORT, () => {

  console.log(`Server running at http://localhost:${PORT}`);

});

